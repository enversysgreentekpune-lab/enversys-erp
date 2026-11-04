// Indian number & currency formatting
export type Unit = "INR" | "L" | "Cr";

export function inr(n: number | null | undefined, unit: Unit = "INR", digits = 2): string {
  const v = Number(n ?? 0);
  if (unit === "L") return `₹${(v / 1e5).toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits })} L`;
  if (unit === "Cr") return `₹${(v / 1e7).toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits })} Cr`;
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}
/** Compact auto unit: ₹12.5 L / ₹3.20 Cr / ₹45,000 */
export function inrShort(n: number | null | undefined): string {
  const v = Number(n ?? 0), a = Math.abs(v);
  if (a >= 1e7) return inr(v, "Cr");
  if (a >= 1e5) return inr(v, "L");
  return inr(v);
}
export const num = (n: number | null | undefined, d = 0) =>
  Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
export const pct = (n: number | null | undefined, d = 1) => `${Number(n ?? 0).toFixed(d)}%`;
export function dt(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const x = typeof d === "string" ? new Date(d.length === 10 ? d + "T00:00:00" : d) : d;
  return x.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}
export function dtm(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}
export const label = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().split("_").map((w) => (w === "ic" ? "I&C" : w === "om" ? "O&M" : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
