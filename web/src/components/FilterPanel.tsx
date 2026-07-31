import type { CohortPerformanceInput } from "../lib/api";

const GROUP_DIMS = ["channel", "country", "platform"] as const;
const CHANNELS   = ["meta", "tiktok", "google_ads", "asa", "snapchat"] as const;
const COUNTRIES  = ["US", "DE", "GB", "FR", "JP", "BR"] as const;

export function FilterPanel({
  value, onChange,
}: {
  value: CohortPerformanceInput;
  onChange: (next: CohortPerformanceInput) => void;
}) {
  const toggleGroup = (d: (typeof GROUP_DIMS)[number]) => {
    const has = value.groupBy.includes(d);
    const next = has ? value.groupBy.filter((x) => x !== d) : [...value.groupBy, d];
    if (next.length === 0 || next.length > 3) return;
    onChange({ ...value, groupBy: next });
  };
  const toggleChannel = (c: (typeof CHANNELS)[number]) => {
    const cur = value.filters?.channel ?? [];
    const has = cur.includes(c);
    const next = has ? cur.filter((x) => x !== c) : [...cur, c];
    const filters = { ...value.filters };
    if (next.length) filters.channel = next; else delete filters.channel;
    onChange({ ...value, filters });
  };
  const toggleCountry = (c: (typeof COUNTRIES)[number]) => {
    const cur = value.filters?.country ?? [];
    const has = cur.includes(c);
    const next = has ? cur.filter((x) => x !== c) : [...cur, c];
    const filters = { ...value.filters };
    if (next.length) filters.country = next; else delete filters.country;
    onChange({ ...value, filters });
  };

  return (
    <section className="rounded border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Filters</h2>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
        <div>
          <label className="block text-xs font-medium text-slate-600">From</label>
          <input
            type="date"            value={value.dateFrom}
            onChange={(e) => onChange({ ...value, dateFrom: e.target.value })}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600">To</label>
          <input
            type="date"            value={value.dateTo}
            onChange={(e) => onChange({ ...value, dateTo: e.target.value })}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600">
            dayIndex (pROAS horizon, 0–90)
          </label>
          <input
            type="number" min={0} max={90}            value={value.dayIndex}
            onChange={(e) => onChange({ ...value, dayIndex: Number(e.target.value) })}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm num"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600">Sort by</label>
          <select
                       value={value.sort?.field ?? "spendUsd"}
            onChange={(e) => onChange({
              ...value,
              sort: { field: e.target.value as "installs" | "spendUsd" | "revenueUsd" | "roas",
                      dir: value.sort?.dir ?? "desc" },
            })}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="spendUsd">spendUsd</option>
            <option value="revenueUsd">revenueUsd</option>
            <option value="installs">installs</option>
            <option value="roas">roas</option>
          </select>
        </div>
      </div>

      <div className="mt-4">
        <span className="block text-xs font-medium text-slate-600">Group by (pick 1–3):</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {GROUP_DIMS.map((d) => (
            <Chip key={d} active={value.groupBy.includes(d)} onClick={() => toggleGroup(d)}>
              {d}
            </Chip>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <span className="block text-xs font-medium text-slate-600">Channels:</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {CHANNELS.map((c) => (
            <Chip key={c} active={(value.filters?.channel ?? []).includes(c)} onClick={() => toggleChannel(c)}>
              {c}
            </Chip>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <span className="block text-xs font-medium text-slate-600">Countries:</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {COUNTRIES.map((c) => (
            <Chip key={c} active={(value.filters?.country ?? []).includes(c)} onClick={() => toggleCountry(c)}>
              {c}
            </Chip>
          ))}
        </div>
      </div>
    </section>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-full border px-3 py-0.5 text-xs " +
        (active
          ? "border-indigo-600 bg-indigo-600 text-white"
          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100")
      }
    >
      {children}
    </button>
  );
}
