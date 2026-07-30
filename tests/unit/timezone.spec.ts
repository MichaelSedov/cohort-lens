import { describe, expect, it } from "vitest";
import {
  orgDateEndExclusiveToUtc,
  orgDateStartToUtc,
  tzOffsetMinutes,
} from "../../supabase/functions/_shared/timezone.ts";

describe("orgDateStartToUtc", () => {
  it("PST winter: 2026-01-15 midnight is 08:00 UTC", () => {
    const d = orgDateStartToUtc("2026-01-15", "America/Los_Angeles");
    expect(d.toISOString()).toBe("2026-01-15T08:00:00.000Z");
  });
  it("PDT summer (post-DST): 2026-06-15 midnight is 07:00 UTC", () => {
    const d = orgDateStartToUtc("2026-06-15", "America/Los_Angeles");
    expect(d.toISOString()).toBe("2026-06-15T07:00:00.000Z");
  });
  it("DST spring-forward day is 23h long: 2026-03-08 in LA (00:00 local -> 08:00 UTC; next day -> 07:00 UTC)", () => {
    const start = orgDateStartToUtc("2026-03-08", "America/Los_Angeles");
    const end   = orgDateEndExclusiveToUtc("2026-03-08", "America/Los_Angeles");
    expect(start.toISOString()).toBe("2026-03-08T08:00:00.000Z");
    // If we did naive UTC arithmetic we'd get 08:00 UTC on the 9th; correct
    // is 07:00 UTC because the day was 23h long (spring-forward).
    expect(end.toISOString()).toBe("2026-03-09T07:00:00.000Z");
    expect((end.getTime() - start.getTime()) / 3600_000).toBe(23);
  });
});

describe("tzOffsetMinutes", () => {
  it("Berlin is UTC+1 in winter and UTC+2 in summer", () => {
    expect(tzOffsetMinutes("Europe/Berlin", new Date("2026-01-15T12:00:00Z"))).toBe(60);
    expect(tzOffsetMinutes("Europe/Berlin", new Date("2026-07-15T12:00:00Z"))).toBe(120);
  });
});
