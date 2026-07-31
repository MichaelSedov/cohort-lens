import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ask, type ChatEvent } from "../lib/chat";

type ToolEvent =
  | { kind: "call"; name: string; args: Record<string, unknown> }
  | { kind: "result"; name: string; ms: number; error: boolean; preview?: string };

type Turn = {
  question: string;
  tools: ToolEvent[];
  answer: string;
  error?: string;
  loading: boolean;
};

const SUGGESTIONS = [
  "Which creatives should we scale in Germany?",
  "How did meta perform in April vs March?",
  "Top 5 channels by ROAS in Q1 2026",
  "Any campaigns with a spend anomaly recently?",
];

export function AiChatPanel({ orgId }: { orgId: string | null }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function submit(q: string) {
    if (!orgId) return;
    const question = q.trim();
    if (!question) return;
    setInput("");
    const turn: Turn = { question, tools: [], answer: "", loading: true };
    setTurns((t) => [...t, turn]);

    const patch = (updater: (prev: Turn) => Turn) =>
      setTurns((all) => {
        const copy = [...all];
        copy[copy.length - 1] = updater(copy[copy.length - 1]!);
        return copy;
      });

    const onEvent = (evt: ChatEvent) => {
      if (evt.type === "tool_call") {
        patch((t) => ({ ...t, tools: [...t.tools, { kind: "call", name: evt.name, args: evt.args }] }));
      } else if (evt.type === "tool_result") {
        patch((t) => {
          // Attach preview to the *most recent* call pill for this tool name
          // rather than creating a separate row — cleaner UI.
          const tools = [...t.tools];
          const idx = [...tools].reverse().findIndex((x) => x.kind === "call" && x.name === evt.name);
          if (idx >= 0) {
            const realIdx = tools.length - 1 - idx;
            tools[realIdx] = {
              kind: "result",
              name: evt.name,
              ms: evt.ms,
              error: evt.error,
              ...(evt.preview !== undefined ? { preview: evt.preview } : {}),
            };
          } else {
            tools.push({
              kind: "result",
              name: evt.name,
              ms: evt.ms,
              error: evt.error,
              ...(evt.preview !== undefined ? { preview: evt.preview } : {}),
            });
          }
          return { ...t, tools };
        });
      } else if (evt.type === "text") {
        patch((t) => ({ ...t, answer: evt.text }));
      } else if (evt.type === "error") {
        patch((t) => ({ ...t, error: evt.message, loading: false }));
      } else if (evt.type === "done") {
        patch((t) => ({ ...t, loading: false }));
      }
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 1e9 }));
    };

    try {
      await ask({ orgId, question, onEvent });
    } catch (e) {
      patch((t) => ({ ...t, error: (e as Error).message, loading: false }));
    }
  }

  return (
    <section className="rounded border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">AI assistant</span>
          <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-indigo-700">
            via OpenRouter
          </span>
        </div>
        <button
          type="button"
          className="text-xs text-slate-500 hover:text-slate-700"
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? "expand" : "collapse"}
        </button>
      </div>

      {!collapsed && (
        <>
          <div ref={scrollRef} className="max-h-[36rem] overflow-y-auto px-4 py-3 text-sm">
            {turns.length === 0 && (
              <div className="text-slate-500">
                <p className="mb-2">Ask a question about your data — the model calls the same BFF endpoints you're using in the dashboard. RLS applies, so it never sees another tenant.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
                      onClick={() => submit(s)}
                    >{s}</button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((t, i) => (
              <div key={i} className="mb-6 last:mb-0">
                <div className="mb-2 flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-none bg-indigo-600 px-3 py-2 text-white">
                    {t.question}
                  </div>
                </div>

                {t.tools.length > 0 && (
                  <div className="mb-2 space-y-1">
                    {t.tools.map((tv, j) => <ToolPill key={j} ev={tv} />)}
                  </div>
                )}

                {t.answer && (
                  <div className="max-w-full rounded-2xl rounded-bl-none border border-slate-200 bg-slate-50 px-4 py-3 text-slate-800">
                    <MarkdownBlock text={t.answer} />
                  </div>
                )}
                {t.loading && !t.answer && (
                  <div className="max-w-[60%] rounded-2xl rounded-bl-none border border-slate-200 bg-slate-50 px-3 py-2 text-slate-400">
                    thinking…
                  </div>
                )}
                {t.error && (
                  <div className="max-w-[95%] rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700">
                    {t.error}
                  </div>
                )}
              </div>
            ))}
          </div>

          <form
            className="flex gap-2 border-t border-slate-100 p-3"
            onSubmit={(e) => { e.preventDefault(); submit(input); }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={!orgId}
              placeholder={orgId ? "Ask about ROAS, creatives, channels…" : "pick an org first"}
              className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!orgId || !input.trim()}
              className="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              Ask
            </button>
          </form>
        </>
      )}
    </section>
  );
}

function ToolPill({ ev }: { ev: ToolEvent }) {
  const [open, setOpen] = useState(false);
  if (ev.kind === "call") {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 font-mono text-[11px] text-slate-700">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
        {ev.name}({fmtArgs(ev.args)})
      </div>
    );
  }
  const canExpand = !!ev.preview;
  return (
    <div>
      <button
        type="button"
        onClick={() => canExpand && setOpen((o) => !o)}
        disabled={!canExpand}
        className={
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] transition-colors " +
          (ev.error
            ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
            : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100") +
          (canExpand ? " cursor-pointer" : " cursor-default")
        }
      >
        {ev.error ? "✕" : "✓"} {ev.name} · {ev.ms}ms
        {canExpand && <span className="ml-1 text-slate-400">{open ? "▾" : "▸"}</span>}
      </button>
      {open && ev.preview && (
        <pre className="mt-1 max-h-64 overflow-auto rounded border border-slate-200 bg-slate-900 p-2 font-mono text-[10.5px] leading-snug text-slate-100">
          {tryPrettyPrint(ev.preview)}
        </pre>
      )}
    </div>
  );
}

/**
 * Markdown block styled to match a chat bubble. `prose` is not available
 * (no @tailwindcss/typography plugin) so we set the essentials by hand —
 * headings, lists, code, and — critically — right-aligned tabular-nums
 * numeric cells so money columns actually line up.
 */
function MarkdownBlock({ text }: { text: string }) {
  return (
    <div className="[&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_code]:rounded [&_code]:bg-slate-200 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[12px] [&_strong]:font-semibold">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: (props) => (
            <div className="my-2 overflow-x-auto">
              <table className="min-w-full border-collapse text-xs" {...props} />
            </div>
          ),
          thead: (props) => <thead className="bg-slate-100 text-slate-600" {...props} />,
          th: (props) => (
            <th className="border-b border-slate-300 px-2 py-1 text-left font-medium" {...props} />
          ),
          td: ({ style, children, ...rest }) => {
            // GFM emits { style: { textAlign: 'right' } } for right-aligned columns.
            const align = (style as { textAlign?: string } | undefined)?.textAlign;
            const isNumeric = align === "right";
            return (
              <td
                {...rest}
                style={style}
                className={
                  "border-b border-slate-200 px-2 py-1 " +
                  (isNumeric ? "text-right font-mono tabular-nums text-slate-800" : "")
                }
              >
                {children}
              </td>
            );
          },
          a: (props) => <a className="text-indigo-600 underline" {...props} />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function fmtArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return "";
  const short = entries
    .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 30)}`)
    .join(", ");
  return short.length > 80 ? short.slice(0, 77) + "…" : short;
}

function tryPrettyPrint(s: string): string {
  const trimmed = s.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return s;
  // Extract the JSON portion (there may be a "…[+N bytes]" trailer).
  const trailerIdx = trimmed.lastIndexOf("…[+");
  const jsonPart = trailerIdx >= 0 ? trimmed.slice(0, trailerIdx) : trimmed;
  const trailer = trailerIdx >= 0 ? trimmed.slice(trailerIdx) : "";
  try {
    return JSON.stringify(JSON.parse(jsonPart), null, 2) + (trailer ? "\n" + trailer : "");
  } catch {
    return s;
  }
}
