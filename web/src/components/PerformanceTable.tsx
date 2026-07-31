import type { Perf } from "../lib/api";
import { fmtInt, fmtRatio, fmtUsd } from "../lib/format";

export function PerformanceTable({ perf }: { perf: Perf }) {
  return (
    <div className="overflow-x-auto rounded border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2">key</th>
            <th className="px-3 py-2 text-right">installs</th>
            <th className="px-3 py-2 text-right">spend</th>
            <th className="px-3 py-2 text-right">revenue</th>
            <th className="px-3 py-2 text-right">ROAS</th>
            <th className="px-3 py-2 text-right">pROAS <sup className="text-[10px] text-amber-600">pred</sup></th>
            <th className="px-3 py-2 text-right">CPI</th>
          </tr>
        </thead>
        <tbody>
          {perf.rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="px-3 py-2 font-mono text-xs">
                {Object.entries(r.key).map(([k, v]) => (
                  <span key={k} className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
                    {k}=<b>{String(v)}</b>
                  </span>
                ))}
              </td>
              <td className="num px-3 py-2 text-right">{fmtInt.format(r.installs)}</td>
              <td className="num px-3 py-2 text-right">{fmtUsd.format(r.spendUsd)}</td>
              <td className="num px-3 py-2 text-right">{fmtUsd.format(r.revenueUsd)}</td>
              <td className={"num px-3 py-2 text-right " + (r.roas >= 1 ? "text-emerald-600" : "text-slate-700")}>
                {fmtRatio(r.roas)}
              </td>
              <td className="num px-3 py-2 text-right text-amber-700">{fmtRatio(r.pRoas)}</td>
              <td className="num px-3 py-2 text-right">{fmtUsd.format(r.cpi)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-slate-200 bg-slate-50">
          <tr>
            <td className="px-3 py-2 text-xs font-semibold uppercase text-slate-500">totals</td>
            <td className="num px-3 py-2 text-right font-semibold">{fmtInt.format(perf.totals.installs)}</td>
            <td className="num px-3 py-2 text-right font-semibold">{fmtUsd.format(perf.totals.spendUsd)}</td>
            <td className="num px-3 py-2 text-right font-semibold">{fmtUsd.format(perf.totals.revenueUsd)}</td>
            <td className={"num px-3 py-2 text-right font-semibold " + (perf.totals.roas >= 1 ? "text-emerald-600" : "text-slate-700")}>
              {fmtRatio(perf.totals.roas)}
            </td>
            <td />
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
