import type { Org } from "../lib/session";

export function OrgSwitcher({
  orgs, selectedId, onChange,
}: {
  orgs: Org[]; selectedId: string | null;
  onChange: (id: string) => void;
}) {
  if (orgs.length === 0) return null;
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-slate-500">Org:</label>
      <select
        value={selectedId ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} ({o.base_currency}, {o.reporting_timezone})
          </option>
        ))}
      </select>
      {orgs.length > 1 && (
        <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
          multi-tenant: {orgs.length} orgs
        </span>
      )}
    </div>
  );
}
