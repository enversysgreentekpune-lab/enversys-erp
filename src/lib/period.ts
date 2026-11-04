// Financial year (April–March) helpers and dashboard time-frames
export const fyStartYear = (d: Date) => (d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1);
/** "26-27" for FY 2026-27 */
export const fyCode = (d: Date = new Date()) => {
  const y = fyStartYear(d);
  return `${String(y).slice(2)}-${String(y + 1).slice(2)}`;
};
export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ymd = (y: number, m: number, day: number) => new Date(y, m, day);

export type Frame = "today" | "week" | "month" | "last_month" | "quarter" | "q1" | "q2" | "q3" | "q4" | "fy" | "last_fy" | "ytd" | "custom";
export const FRAMES: { code: Frame; label: string }[] = [
  { code: "today", label: "Today" }, { code: "week", label: "This Week" }, { code: "month", label: "This Month" },
  { code: "last_month", label: "Last Month" }, { code: "quarter", label: "This Quarter" },
  { code: "q1", label: "Q1 (Apr–Jun)" }, { code: "q2", label: "Q2 (Jul–Sep)" }, { code: "q3", label: "Q3 (Oct–Dec)" }, { code: "q4", label: "Q4 (Jan–Mar)" },
  { code: "fy", label: "This FY (Annual)" }, { code: "last_fy", label: "Last FY" }, { code: "ytd", label: "YTD" }, { code: "custom", label: "Custom range" },
];

export interface Range { from: string; to: string; label: string } // inclusive ISO dates

export function resolveFrame(frame: Frame, now = new Date(), custom?: { from?: string; to?: string }): Range {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const fy = fyStartYear(now);
  const q = (n: number) => { const sm = 3 + (n - 1) * 3; return { from: iso(ymd(fy, sm, 1)), to: iso(ymd(fy, sm + 3, 0)) }; };
  switch (frame) {
    case "today": return { from: iso(now), to: iso(now), label: "Today" };
    case "week": { const dow = (now.getDay() + 6) % 7; return { from: iso(ymd(y, m, d - dow)), to: iso(now), label: "This Week" }; }
    case "month": return { from: iso(ymd(y, m, 1)), to: iso(ymd(y, m + 1, 0)), label: now.toLocaleString("en-IN", { month: "long", year: "numeric" }) };
    case "last_month": { const s = ymd(y, m - 1, 1); return { from: iso(s), to: iso(ymd(y, m, 0)), label: s.toLocaleString("en-IN", { month: "long", year: "numeric" }) }; }
    case "quarter": { const qn = Math.floor(((m - 3 + 12) % 12) / 3) + 1; return { ...q(qn), label: `Q${qn} FY ${fyCode(now)}` }; }
    case "q1": case "q2": case "q3": case "q4": { const n = Number(frame[1]); return { ...q(n), label: `Q${n} FY ${fyCode(now)}` }; }
    case "fy": return { from: iso(ymd(fy, 3, 1)), to: iso(ymd(fy + 1, 2, 31)), label: `FY ${fyCode(now)}` };
    case "last_fy": return { from: iso(ymd(fy - 1, 3, 1)), to: iso(ymd(fy, 2, 31)), label: `FY ${fyCode(ymd(fy - 1, 3, 1))}` };
    case "ytd": return { from: iso(ymd(fy, 3, 1)), to: iso(now), label: `YTD FY ${fyCode(now)}` };
    case "custom": {
      const from = custom?.from || iso(ymd(fy, 3, 1)), to = custom?.to || iso(now);
      return { from, to, label: `${from} → ${to}` };
    }
  }
}

/** Previous comparable period (same length immediately before) or same period last year */
export function compareRange(r: Range, mode: "prev" | "yoy"): Range {
  const f = new Date(r.from + "T00:00:00"), t = new Date(r.to + "T00:00:00");
  if (mode === "yoy") {
    const a = new Date(f); a.setFullYear(a.getFullYear() - 1);
    const b = new Date(t); b.setFullYear(b.getFullYear() - 1);
    return { from: iso(a), to: iso(b), label: "Same period last year" };
  }
  const days = Math.round((t.getTime() - f.getTime()) / 86400000) + 1;
  const b = new Date(f); b.setDate(b.getDate() - 1);
  const a = new Date(b); a.setDate(a.getDate() - days + 1);
  return { from: iso(a), to: iso(b), label: "Previous period" };
}
