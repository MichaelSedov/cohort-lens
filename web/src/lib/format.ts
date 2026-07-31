export const fmtInt = new Intl.NumberFormat("en-US");
export const fmtUsd = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 2,
});
export function fmtRatio(x: number): string {
  if (!Number.isFinite(x)) return "—";
  return x.toFixed(3);
}
