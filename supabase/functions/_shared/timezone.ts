// Timezone helpers. The BFF stores cohort_date in UTC (a `date`, no time), but
// every request/response is bucketed in the org's reporting_timezone. This
// means a "day" the user asked for gets translated to the UTC date-range that
// covers that day in the org's tz — including on DST boundaries.
//
// Pure implementation using Intl.DateTimeFormat so the same file works in both
// Node (Vitest) and Deno (Edge Functions).

/**
 * Given an ISO date string ("YYYY-MM-DD") interpreted as *midnight in `tz`*,
 * return the corresponding UTC `Date` instant. Handles DST correctly by
 * re-evaluating the offset at the candidate instant.
 */
export function orgDateStartToUtc(dateIso: string, tz: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if (!m) throw new Error(`orgDateStartToUtc: bad date ${dateIso}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Guess the offset by treating the wall clock as if it were UTC, then correct.
  let utc = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0));
  const off1 = tzOffsetMinutes(tz, utc);
  utc = new Date(utc.getTime() - off1 * 60_000);
  const off2 = tzOffsetMinutes(tz, utc);
  if (off2 !== off1) {
    utc = new Date(new Date(Date.UTC(y, mo - 1, d, 0, 0, 0)).getTime() - off2 * 60_000);
  }
  return utc;
}

/** Same as start, but the exclusive end (midnight of the *next* org-tz day). */
export function orgDateEndExclusiveToUtc(dateIso: string, tz: string): Date {
  const start = orgDateStartToUtc(dateIso, tz);
  // Add 24h then re-anchor to org midnight (handles DST-spring-forward: some
  // days are 23h long, some are 25h). Compute by string arithmetic.
  const next = addOneDay(dateIso);
  return orgDateStartToUtc(next, tz);
}

/**
 * Returns the offset (in minutes) that `tz` observes at the given UTC instant.
 * Positive means `tz` is ahead of UTC.
 */
export function tzOffsetMinutes(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(at)) parts[p.type] = p.value;
  const wall = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (wall - at.getTime()) / 60_000;
}

function addOneDay(dateIso: string): string {
  const [y, m, d] = dateIso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
