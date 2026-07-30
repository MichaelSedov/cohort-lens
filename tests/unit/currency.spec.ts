import { describe, expect, it } from "vitest";
import { microsToUsd } from "../../supabase/functions/_shared/currency.ts";

describe("microsToUsd", () => {
  it("converts an EUR amount using a rate to USD", () => {
    // 50 EUR at 1.08 USD/EUR = 54.00 USD
    expect(microsToUsd(50_000_000n, 1.08)).toBe(54);
  });
  it("handles zero micros without throwing", () => {
    expect(microsToUsd(0, 1.27)).toBe(0);
    expect(microsToUsd(0n, 0.0067)).toBe(0);
  });
  it("rounds to 4 decimal places (~1/100 of a cent)", () => {
    // 1_234_567 micros = 1.234567 USD_local; * 1.0 = 1.2346 after rounding
    expect(microsToUsd(1_234_567n, 1.0)).toBe(1.2346);
  });
  it("throws on a non-positive rate", () => {
    expect(() => microsToUsd(1_000_000n, 0)).toThrow();
    expect(() => microsToUsd(1_000_000n, -1)).toThrow();
  });
  it("throws on negative micros", () => {
    expect(() => microsToUsd(-1n, 1)).toThrow();
  });
});
