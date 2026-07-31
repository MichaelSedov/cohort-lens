import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, BffError, type CohortPerformanceInput } from "../lib/api";
import { fetchOrgs, type Org } from "../lib/session";
import { AiChatPanel } from "../components/AiChatPanel";
import { FilterPanel } from "../components/FilterPanel";
import { OrgSwitcher } from "../components/OrgSwitcher";
import { PerformanceChart } from "../components/PerformanceChart";
import { PerformanceTable } from "../components/PerformanceTable";
import { ServerTimingBadge } from "../components/ServerTimingBadge";

const DEFAULT_INPUT: CohortPerformanceInput = {
  dateFrom: "2026-01-01",
  dateTo: "2026-03-31",
  dayIndex: 30,
  groupBy: ["channel", "country"],
  sort: { field: "spendUsd", dir: "desc" },
  page: { limit: 100, offset: 0 },
};

export function Performance() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [input, setInput] = useState<CohortPerformanceInput>(DEFAULT_INPUT);
  const [orgErr, setOrgErr] = useState<string | null>(null);

  // Load orgs the current session can see. RLS scopes this to memberships.
  useEffect(() => {
    fetchOrgs()
      .then((list) => {
        setOrgs(list);
        setOrgErr(null);
        setOrgId((prev) => (prev && list.some((o) => o.id === prev) ? prev : list[0]?.id ?? null));
      })
      .catch((e) => setOrgErr((e as Error).message));
  }, []);

  const q = useQuery({
    queryKey: ["cohort-performance", orgId, input],
    enabled: !!orgId,
    queryFn: () => api.cohortPerformance(orgId!, input),
    // No cross-request cache in a dashboard where the user is actively
    // tuning filters — keep results fresh.
    staleTime: 0,
    retry: false,
    // Hold the previous response's shape while a new query is in flight so
    // the table + chart don't unmount (which would collapse page height
    // and jump the scroll position mid-interaction).
    placeholderData: (prev) => prev,
  });

  const errorMsg = useMemo(() => {
    if (!q.error) return null;
    if (q.error instanceof BffError) return `[${q.error.code}] ${q.error.message}`;
    return (q.error as Error).message;
  }, [q.error]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <div className="flex items-center justify-between gap-4">
        <OrgSwitcher orgs={orgs} selectedId={orgId} onChange={setOrgId} />
        <ServerTimingBadge header={q.data?.serverTiming ?? null} />
      </div>

      {orgErr && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          failed to load orgs: {orgErr}
        </div>
      )}

      <AiChatPanel orgId={orgId} />

      {/*
        Intentionally NOT passing `disabled={q.isFetching}` — a native
        <input type="date"> closes its open calendar popup the instant it
        becomes disabled, which killed the month arrows mid-click. React
        Query cancels the previous in-flight request when the queryKey
        changes, so back-to-back edits are safe.
      */}
      <FilterPanel value={input} onChange={setInput} />

      {q.isLoading && <div className="text-sm text-slate-500">loading…</div>}
      {errorMsg && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {errorMsg}
        </div>
      )}
      {q.data && (
        <>
          <div className="text-xs text-slate-500">
            {q.data.body.meta.rowCount} keys · timezone {q.data.body.meta.timezone} · query {q.data.body.meta.queryMs}ms
            {q.isFetching && " · refreshing…"}
          </div>
          <PerformanceTable perf={q.data.body} />
          <PerformanceChart rows={q.data.body.rows} />
        </>
      )}
    </div>
  );
}
