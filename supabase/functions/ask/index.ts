// AI assistant endpoint. Runs an OpenRouter chat-completion loop with our
// four BFF tools; streams SSE events to the browser as tools are called and
// as the final answer arrives.
//
// Tenant isolation: every tool call re-uses the caller's Authorization +
// X-Org-Id — the model never gets a privileged path to the DB, RLS still
// applies for every fetch a tool makes.
//
// SSE event shapes:
//   data: {"type":"tool_call","name":"list_campaigns","args":{...}}
//   data: {"type":"tool_result","name":"list_campaigns","ms":123,"error":false,"preview":<truncated JSON>}
//   data: {"type":"text","text":"...final answer..."}
//   data: {"type":"error","message":"..."}
//   data: {"type":"done"}
//
// `preview` on tool_result carries the actual response (truncated to
// TOOL_PREVIEW_MAX_CHARS) so the FE can render an expandable "what did the
// tool return" section under each pill — great for transparency, and the
// model's ground truth stays visible to the user.

import { requireAuth } from "../_shared/auth.ts";
import { CORS_HEADERS, errorResponse, handleCorsPreflight } from "../_shared/errors.ts";
import { TOOL_DEFS, TOOLS } from "../_shared/tools-catalog.ts";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";
const MAX_ITERATIONS = 8;               // safety net on the tool loop
const TOOL_RESULT_MAX_CHARS = 8000;     // cap what we feed back to the model
const TOOL_PREVIEW_MAX_CHARS = 2500;    // cap what we send to the browser

// The seeded dataset spans 2026-01-01 through 2026-06-29 (180 days from
// START_DATE in supabase/seed/seed.ts). In production this would be an
// authoritative min/max query on cohort_daily — for the prototype we bake
// the known bounds into the prompt so the model doesn't waste tool calls
// scanning empty date ranges.
const DATA_MIN = "2026-01-01";
const DATA_MAX = "2026-06-29";

const SYSTEM_PROMPT = `You are the cohort-lens analytics assistant.

DATASET AVAILABILITY (important — do not guess dates):
  * Cohort data exists ONLY between ${DATA_MIN} and ${DATA_MAX}.
  * If the user says "last month" / "recently" / "this quarter" without a
    date, interpret it as the last full month INSIDE that range
    (e.g. "recently" -> 2026-05-01..2026-05-31).
  * Do not request dates outside ${DATA_MIN}..${DATA_MAX} — you will get
    zero rows and waste a tool call.

TOOL ROUTING (choose deliberately, not by habit):
  * "which creatives should we scale / drop", "creative quality", "rank
    creatives", "best/worst creative in X" -> ALWAYS use score_creatives.
    Never approximate it with get_cohort_performance groupBy=creative — the
    score has weighted components you cannot recompute in your head.
  * "how did meta perform this month vs last", "did X improve" -> use
    compare_periods. Do NOT call get_cohort_performance twice and diff.
  * "which campaigns exist in country X" -> list_campaigns first, then feed
    the ids into score_creatives / get_cohort_performance.
  * General "ROAS / installs / spend by channel/country" -> get_cohort_performance.

WHAT YOU MAY AND MAY NOT SAY:
  * Every number comes from a tool result — do not invent metrics.
  * Money is always USD (converted server-side); do not re-convert.
  * pROAS is a PREDICTION — say "predicted ROAS", never "we earned".
  * dayIndex is COHORT-based: dayIndex=30 means "the cohort's first 30 days
    after install", not "the last 30 calendar days".
  * If compare_periods returns significance="low_volume", drop those rows or
    explicitly say "not enough data".
  * If a tool returns {"_bff_error":true,...}, read the error code and
    either fix the arguments or explain what went wrong (don't retry blindly).

STYLE — markdown-first, human-readable numbers:
  * Be concise. A senior analyst is reading this.
  * When you're presenting >=3 comparable rows, use a MARKDOWN TABLE. Right-
    align numeric columns with the ":---:" / "---:" syntax.
    Example:
      | creative              | score | pROAS | CPI    |
      |-----------------------|------:|------:|-------:|
      | **meta-DE-camp-1-cr-1** |    78 |  1.13 | $2.10 |
  * Money: format as USD with two decimals ($9,566.24), thousands separator.
    Ratios / ROAS: 2 decimals (1.13).
  * Bold creative/campaign names in tables (**name**) — they're the actionable
    identifier.
  * For single-row insights, use a short bullet with the key metrics inline:
    "- **campaign X**: 4,221 installs, spend $11.9K, pROAS 1.09 — scale."
  * Cite the tool inline when it clarifies the source, e.g.
    "(score_creatives, benchmarkWindowDays=30)".
  * Do NOT dump long uuid strings unless the user asked for them. If a name
    is available (from list_campaigns), use the name instead.`;

type Message =
  | { role: "system" | "user" | "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse("bad_request", "POST only");

  const ctx = await requireAuth(req);
  if (ctx instanceof Response) return ctx;

  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) return errorResponse("internal", "OPENROUTER_API_KEY not configured");
  const model = Deno.env.get("OPENROUTER_MODEL") || DEFAULT_MODEL;

  let body: { question?: string; history?: Message[] };
  try { body = await req.json(); } catch {
    return errorResponse("bad_request", "invalid JSON body");
  }
  if (!body.question || typeof body.question !== "string") {
    return errorResponse("bad_request", "question is required");
  }

  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(body.history ?? []),
    { role: "user", content: body.question },
  ];

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (evt: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(evt)}\n\n`));

      try {
        for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
          const res = await fetch(OPENROUTER_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              // OpenRouter recommends these but they're not required.
              "HTTP-Referer": "http://localhost:5173",
              "X-Title": "cohort-lens",
            },
            body: JSON.stringify({
              model,
              messages,
              tools: TOOL_DEFS,
              tool_choice: "auto",
              temperature: 0.2,
            }),
          });
          if (!res.ok) {
            send({ type: "error", message: `openrouter ${res.status}: ${(await res.text()).slice(0, 400)}` });
            break;
          }
          const data = await res.json() as {
            choices?: Array<{ message: { role: "assistant"; content: string | null; tool_calls?: ToolCall[] } }>;
            error?: { message?: string };
          };
          if (data.error) { send({ type: "error", message: data.error.message ?? "openrouter error" }); break; }
          const msg = data.choices?.[0]?.message;
          if (!msg) { send({ type: "error", message: "openrouter returned no choices" }); break; }

          const asst: Message = { role: "assistant", content: msg.content };
          if (msg.tool_calls?.length) asst.tool_calls = msg.tool_calls;
          messages.push(asst);

          if (msg.tool_calls && msg.tool_calls.length > 0) {
            for (const tc of msg.tool_calls) {
              let parsedArgs: Record<string, unknown> = {};
              try { parsedArgs = JSON.parse(tc.function.arguments || "{}"); } catch { /* keep empty */ }
              send({ type: "tool_call", name: tc.function.name, args: parsedArgs });

              const entry = TOOLS[tc.function.name];
              const t0 = performance.now();
              if (!entry) {
                messages.push({
                  role: "tool", tool_call_id: tc.id,
                  content: JSON.stringify({ error: `unknown tool ${tc.function.name}` }),
                });
                send({ type: "tool_result", name: tc.function.name, ms: 0, error: true });
                continue;
              }
              try {
                const result = await entry.execute(req, parsedArgs);
                const ms = Math.round(performance.now() - t0);
                const serialised = JSON.stringify(result);
                messages.push({
                  role: "tool", tool_call_id: tc.id,
                  content: serialised.length > TOOL_RESULT_MAX_CHARS
                    ? serialised.slice(0, TOOL_RESULT_MAX_CHARS) + `…[truncated from ${serialised.length}]`
                    : serialised,
                });
                const hasBffErr = typeof result === "object" && result !== null && "_bff_error" in result;
                send({
                  type: "tool_result",
                  name: tc.function.name,
                  ms,
                  error: hasBffErr,
                  preview: serialised.length > TOOL_PREVIEW_MAX_CHARS
                    ? serialised.slice(0, TOOL_PREVIEW_MAX_CHARS) + `…[+${serialised.length - TOOL_PREVIEW_MAX_CHARS} bytes]`
                    : serialised,
                });
              } catch (err) {
                const ms = Math.round(performance.now() - t0);
                messages.push({
                  role: "tool", tool_call_id: tc.id,
                  content: JSON.stringify({ error: String(err) }),
                });
                send({ type: "tool_result", name: tc.function.name, ms, error: true, preview: String(err) });
              }
            }
            continue; // next model turn
          }

          // Final assistant answer.
          send({ type: "text", text: msg.content ?? "" });
          send({ type: "done" });
          return;
        }
        // Fell out of the loop without a final answer — surface it as an
        // error rather than a silently hung UI.
        send({
          type: "error",
          message: `hit MAX_ITERATIONS (${MAX_ITERATIONS}) without a final answer — model kept calling tools`,
        });
        send({ type: "done" });
      } catch (err) {
        send({ type: "error", message: String(err) });
        send({ type: "done" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
});
