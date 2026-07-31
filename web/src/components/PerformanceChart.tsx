import {
  Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import type { PerfRow } from "../lib/api";

/**
 * Bar chart of spend vs revenue per key. Colours the spend bar red where
 * revenue < spend (ROAS < 1) so under-performing rows are visually obvious.
 */
export function PerformanceChart({ rows }: { rows: PerfRow[] }) {
  const data = rows.slice(0, 20).map((r) => ({
    name: Object.values(r.key).join(" / "),
    spend: r.spendUsd,
    revenue: r.revenueUsd,
    roas: r.roas,
  }));
  return (
    <div className="rounded border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Spend vs revenue (top 20 keys, USD)
      </h3>
      <div style={{ width: "100%", height: Math.max(180, data.length * 22 + 60) }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ left: 100, right: 20, top: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
            <Tooltip
              formatter={(v: number, k) => [`$${Number(v).toLocaleString("en-US")}`, String(k)]}
            />
            <Legend />
            <Bar dataKey="spend" name="spend">
              {data.map((d, i) => (
                <Cell key={i} fill={d.roas < 1 ? "#dc2626" : "#94a3b8"} />
              ))}
            </Bar>
            <Bar dataKey="revenue" name="revenue" fill="#10b981" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
