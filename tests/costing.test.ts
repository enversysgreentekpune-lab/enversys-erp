import { describe, it, expect } from "vitest";
import { computeCostSheet, DEFAULT_PARAMS } from "@/lib/costing";

const spec = [{ sl: 1, qty: 2, gst_pct: 18 }, { sl: 2, qty: 10, gst_pct: 12 }];
const cost = [
  { spec_sl: 1, category: "BOUGHT_OUT", qty: 2, rate: 100000 },
  { spec_sl: 2, category: "RAW_MATERIAL", qty: 10, rate: 5000 },
  { spec_sl: null, category: "FREIGHT", qty: 1, rate: 25000 },
];

describe("cost sheet engine", () => {
  it("builds cost up from direct cost, provisions and margin on selling price", () => {
    const p = { ...DEFAULT_PARAMS, contingency_pct: 2, overhead_pct: 5, finance_pct: 1, warranty_pct: 1, margin_pct: 20, discount_pct: 0, gst_mode: "INTRA" as const };
    const t = computeCostSheet(spec, cost, p);
    expect(t.direct).toBe(275000);
    expect(t.totalCost).toBe(275000 * 1.09);
    expect(t.grossSelling).toBeCloseTo(t.totalCost / 0.8, 1);
    expect(t.marginPct).toBeCloseTo(20, 1);
    expect(t.byCategory.FREIGHT).toBe(25000);
  });
  it("line amounts sum to net selling price and GST splits CGST/SGST", () => {
    const t = computeCostSheet(spec, cost, { ...DEFAULT_PARAMS, discount_pct: 5 });
    expect(t.lines.reduce((a, l) => a + l.amount, 0)).toBeCloseTo(t.netSelling, 2);
    expect(t.cgst + t.sgst).toBeCloseTo(t.gst, 2);
    expect(t.igst).toBe(0);
    expect(t.discount).toBeGreaterThan(0);
    // common freight is spread pro-rata on line cost
    expect(t.lines[0].cost + t.lines[1].cost).toBeCloseTo(t.direct, 2);
  });
  it("uses IGST for inter-state supply and respects per-line GST %", () => {
    const t = computeCostSheet(spec, cost, { ...DEFAULT_PARAMS, gst_mode: "INTER" });
    expect(t.igst).toBe(t.gst);
    expect(t.lines[1].gst).toBeCloseTo(t.lines[1].amount * 0.12, 1);
  });
  it("discount reduces margin", () => {
    const a = computeCostSheet(spec, cost, { ...DEFAULT_PARAMS, discount_pct: 0 });
    const b = computeCostSheet(spec, cost, { ...DEFAULT_PARAMS, discount_pct: 10 });
    expect(b.marginPct).toBeLessThan(a.marginPct);
    expect(b.netSelling).toBeCloseTo(a.netSelling * 0.9, -1);
  });
  it("rejects invalid parameters", () => {
    expect(() => computeCostSheet(spec, cost, { ...DEFAULT_PARAMS, margin_pct: 100 })).toThrow();
    expect(() => computeCostSheet(spec, cost, { ...DEFAULT_PARAMS, discount_pct: -1 })).toThrow();
  });
});
