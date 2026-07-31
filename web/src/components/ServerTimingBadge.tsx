/**
 * Dev-facing pill that surfaces the BFF's `Server-Timing` header so you can
 * *see* db vs total ms live as you tweak filters. Would not ship to prod as-is
 * — but the equivalent trace lives in OpenTelemetry spans in the roadmap.
 */
export function ServerTimingBadge({ header }: { header: string | null }) {
  if (!header) return null;
  const parts = header.split(",").map((p) => p.trim());
  const parse = (name: string) => {
    const p = parts.find((s) => s.startsWith(`${name};`));
    if (!p) return null;
    const m = /dur=([\d.]+)/.exec(p);
    return m ? Number(m[1]) : null;
  };
  const db = parse("db");
  const total = parse("total");
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 shadow-sm">
      <span className="font-mono">Server-Timing:</span>
      {db !== null && <span>db <b className="text-slate-800">{db}ms</b></span>}
      {total !== null && <span>· total <b className="text-slate-800">{total}ms</b></span>}
    </div>
  );
}
