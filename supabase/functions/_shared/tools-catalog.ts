// Tool catalog for the /ask endpoint. Each entry declares an OpenAI-format
// function definition (which OpenRouter forwards to whichever LLM) plus an
// `execute` that fetches the corresponding BFF endpoint, forwarding the
// caller's Authorization + X-Org-Id — so tenant isolation is preserved:
// the model can only ever call OUR endpoints, and OUR endpoints only ever
// see the caller's own data.
//
// Descriptions are the LLM-facing contract; keep the semantics (cohort-based,
// USD, pRoas-is-prediction) explicit — same rules as the MCP tool descriptions
// in mcp-server/src/tools/*, deliberately duplicated to keep this file
// self-contained (Deno function has no dep on the mcp-server Node package).

export type ToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: object; // JSON Schema
  };
};

export type ToolImpl = (req: Request, args: Record<string, unknown>) => Promise<unknown>;

export type ToolEntry = { def: ToolDef; execute: ToolImpl };

const BFF_BASE = () =>
  `${Deno.env.get("SUPABASE_URL") ?? "http://kong:8000"}/functions/v1`;

async function callBff(req: Request, path: string, init: RequestInit): Promise<unknown> {
  const headers = new Headers(init.headers ?? {});
  const auth = req.headers.get("Authorization");
  const org = req.headers.get("X-Org-Id");
  if (auth) headers.set("Authorization", auth);
  if (org)  headers.set("X-Org-Id", org);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  const res = await fetch(`${BFF_BASE()}/${path}`, { ...init, headers });
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* keep text */ }
  if (!res.ok) {
    // Return the envelope directly so the LLM sees "org_forbidden" or
    // "bad_request" and can react (e.g., retry with different args).
    return { _bff_error: true, status: res.status, body };
  }
  return body;
}

// -----------------------------------------------------------------------------
// list_campaigns
// -----------------------------------------------------------------------------
const listCampaigns: ToolEntry = {
  def: {
    type: "function",
    function: {
      name: "list_campaigns",
      description:
        "List campaigns visible to the caller (cursor-paginated). Call this FIRST when the user names a campaign without providing an id, or asks a 'which campaigns…' question — the analytics tools expect uuids.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit:   { type: "integer", minimum: 1, maximum: 500, default: 50 },
          cursor:  { type: "string", format: "uuid" },
          channel: { type: "string", enum: ["meta","tiktok","google_ads","asa","snapchat"] },
          country: { type: "string", minLength: 2, maxLength: 2 },
        },
      },
    },
  },
  execute: async (req, args) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(args)) if (v != null) q.set(k, String(v));
    return callBff(req, `campaigns?${q.toString()}`, { method: "GET" });
  },
};

// -----------------------------------------------------------------------------
// get_cohort_performance
// -----------------------------------------------------------------------------
const getCohortPerformance: ToolEntry = {
  def: {
    type: "function",
    function: {
      name: "get_cohort_performance",
      description:
        "Aggregate cohort-based ad performance for a date range and horizon (dayIndex). dayIndex is COHORT-BASED: dayIndex=30 means 'sum revenue attributed to installs' first 30 days after install', NOT 'revenue in the last 30 calendar days'. Money is USD (converted server-side). pROAS is a PREDICTION — surface it as such.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["dateFrom", "dateTo", "groupBy"],
        properties: {
          dateFrom: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          dateTo:   { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          dayIndex: { type: "integer", minimum: 0, maximum: 90, default: 30 },
          groupBy:  {
            type: "array", minItems: 1, maxItems: 3,
            items: { type: "string", enum: ["channel","country","platform","campaign","creative"] },
          },
          filters: {
            type: "object",
            additionalProperties: false,
            properties: {
              channel:  { type: "array", items: { type: "string", enum: ["meta","tiktok","google_ads","asa","snapchat"] } },
              country:  { type: "array", items: { type: "string", minLength: 2, maxLength: 2 } },
              platform: { type: "array", items: { type: "string", enum: ["ios","android","web"] } },
            },
          },
          sort: {
            type: "object",
            additionalProperties: false,
            properties: {
              field: { type: "string", enum: ["installs","spendUsd","revenueUsd","roas"], default: "spendUsd" },
              dir:   { type: "string", enum: ["asc","desc"], default: "desc" },
            },
          },
          page: {
            type: "object",
            additionalProperties: false,
            properties: {
              limit:  { type: "integer", minimum: 1, maximum: 500, default: 50 },
              offset: { type: "integer", minimum: 0, default: 0 },
            },
          },
        },
      },
    },
  },
  execute: (req, args) => callBff(req, "cohort-performance", { method: "POST", body: JSON.stringify(args) }),
};

// -----------------------------------------------------------------------------
// compare_periods
// -----------------------------------------------------------------------------
const comparePeriods: ToolEntry = {
  def: {
    type: "function",
    function: {
      name: "compare_periods",
      description:
        "Compare two cohort periods on the same dimensions. Use this for period-over-period questions — do NOT call get_cohort_performance twice and diff by hand. Rows with significance='low_volume' (either period <100 installs) are noise; drop them or say 'not enough data'.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["periodA", "periodB", "groupBy"],
        properties: {
          periodA: {
            type: "object", additionalProperties: false, required: ["dateFrom","dateTo"],
            properties: {
              dateFrom: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              dateTo:   { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            },
          },
          periodB: {
            type: "object", additionalProperties: false, required: ["dateFrom","dateTo"],
            properties: {
              dateFrom: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              dateTo:   { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            },
          },
          dayIndex: { type: "integer", minimum: 0, maximum: 90, default: 30 },
          groupBy:  {
            type: "array", minItems: 1, maxItems: 3,
            items: { type: "string", enum: ["channel","country","platform","campaign","creative"] },
          },
          filters: {
            type: "object",
            additionalProperties: false,
            properties: {
              channel:  { type: "array", items: { type: "string", enum: ["meta","tiktok","google_ads","asa","snapchat"] } },
              country:  { type: "array", items: { type: "string", minLength: 2, maxLength: 2 } },
              platform: { type: "array", items: { type: "string", enum: ["ios","android","web"] } },
            },
          },
        },
      },
    },
  },
  execute: (req, args) => callBff(req, "cohort-compare", { method: "POST", body: JSON.stringify(args) }),
};

// -----------------------------------------------------------------------------
// score_creatives
// -----------------------------------------------------------------------------
const scoreCreatives: ToolEntry = {
  def: {
    type: "function",
    function: {
      name: "score_creatives",
      description:
        "PREFERRED tool for any 'which creatives should we scale / drop / rank / are best' question. Scores creatives 0-100 on a WEIGHTED composite of pROAS (0.45), retention proxy (0.20), CPI (0.20), and spend confidence (0.15). Provide campaignIds OR creativeIds (at least one). Returns per-creative breakdown with named components — do NOT approximate this by calling get_cohort_performance with groupBy=creative, that gives raw metrics without the weighting. pROAS is a PREDICTION, not a measurement.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          campaignIds: { type: "array", items: { type: "string", format: "uuid" } },
          creativeIds: { type: "array", items: { type: "string", format: "uuid" } },
          dayIndex:    { type: "integer", minimum: 0, maximum: 90, default: 30 },
          benchmarkWindowDays: { type: "integer", minimum: 1, maximum: 365, default: 30 },
        },
      },
    },
  },
  execute: (req, args) => callBff(req, "creative-score", { method: "POST", body: JSON.stringify(args) }),
};

export const TOOLS: Record<string, ToolEntry> = {
  list_campaigns: listCampaigns,
  get_cohort_performance: getCohortPerformance,
  compare_periods: comparePeriods,
  score_creatives: scoreCreatives,
};

export const TOOL_DEFS: ToolDef[] = Object.values(TOOLS).map((t) => t.def);
