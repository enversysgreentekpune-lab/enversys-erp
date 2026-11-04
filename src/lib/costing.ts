// Proposal cost sheet engine — pure functions (unit tested in tests/costing.test.ts)
export const COST_CATEGORIES = [
  ["MATERIAL", "Material (bought-out / standard)"], ["RAW_MATERIAL", "Raw material"], ["BOUGHT_OUT", "Bought-out items"],
  ["FABRICATION", "Fabrication @ Markal (labour + consumables + machine)"], ["ENGINEERING", "Engineering / design"],
  ["PAINTING", "Painting / surface treatment"], ["PACKING", "Packing"], ["FREIGHT", "Freight / transport"],
  ["INSURANCE", "Insurance"], ["IC", "Installation & commissioning"], ["SITE_EXP", "Site expenses (travel, lodging, DA)"],
  ["TESTING", "Testing / third-party inspection"], ["SUBCONTRACT", "Subcontract"], ["OTHER", "Other"],
] as const;

export interface SpecLineIn { sl: number; qty: number; gst_pct: number; description?: string; uom?: string }
export interface CostLineIn { spec_sl: number | null; category: string; qty: number; rate: number }
export interface CostParams {
  contingency_pct: number; overhead_pct: number; finance_pct: number; warranty_pct: number;
  margin_pct: number;   // margin on selling price
  discount_pct: number; // commercial discount on gross selling price
  gst_mode: "INTRA" | "INTER";
}
export const DEFAULT_PARAMS: CostParams = {
  contingency_pct: 3, overhead_pct: 5, finance_pct: 1, warranty_pct: 1, margin_pct: 18, discount_pct: 0, gst_mode: "INTRA",
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface CostTotals {
  direct: number; byCategory: Record<string, number>;
  contingency: number; overhead: number; finance: number; warranty: number; totalCost: number;
  grossSelling: number; discount: number; netSelling: number;
  grossMargin: number; marginPct: number; contribution: number; contributionPct: number;
  cgst: number; sgst: number; igst: number; gst: number; grandTotal: number;
  lines: { sl: number; cost: number; unitPrice: number; amount: number; gst: number }[];
}

export function computeCostSheet(spec: SpecLineIn[], costs: CostLineIn[], p: CostParams): CostTotals {
  if (p.margin_pct >= 100 || p.margin_pct < -100) throw new Error("Margin % must be below 100");
  if (p.discount_pct < 0 || p.discount_pct >= 100) throw new Error("Discount % must be between 0 and 100");
  const byCategory: Record<string, number> = {};
  const lineDirect = new Map<number, number>(spec.map((s) => [s.sl, 0]));
  let direct = 0, common = 0;
  for (const c of costs) {
    const amt = r2((Number(c.qty) || 0) * (Number(c.rate) || 0));
    direct += amt;
    byCategory[c.category] = r2((byCategory[c.category] ?? 0) + amt);
    if (c.spec_sl != null && lineDirect.has(c.spec_sl)) lineDirect.set(c.spec_sl, lineDirect.get(c.spec_sl)! + amt);
    else common += amt;
  }
  direct = r2(direct);
  const contingency = r2(direct * p.contingency_pct / 100);
  const overhead = r2(direct * p.overhead_pct / 100);
  const finance = r2(direct * p.finance_pct / 100);
  const warranty = r2(direct * p.warranty_pct / 100);
  const totalCost = r2(direct + contingency + overhead + finance + warranty);
  const grossSelling = r2(totalCost / (1 - p.margin_pct / 100));
  const targetNet = grossSelling * (1 - p.discount_pct / 100);

  // allocate net selling price to spec lines (common costs spread pro-rata on line cost, else on qty)
  const linked = [...lineDirect.values()].reduce((a, b) => a + b, 0);
  const qtySum = spec.reduce((a, s) => a + (Number(s.qty) || 0), 0) || 1;
  const lines = spec.map((s) => {
    const ld = lineDirect.get(s.sl) ?? 0;
    const share = linked > 0 ? ld / linked : (Number(s.qty) || 0) / qtySum;
    const lineCost = ld + common * share;
    const qty = Number(s.qty) || 1;
    const unitPrice = r2((targetNet * share) / qty);
    const amount = r2(unitPrice * qty);
    return { sl: s.sl, cost: r2(lineCost), unitPrice, amount, gst: r2(amount * (Number(s.gst_pct) || 0) / 100) };
  });
  const netSelling = spec.length ? r2(lines.reduce((a, l) => a + l.amount, 0)) : r2(targetNet);
  const discount = r2(grossSelling - netSelling);
  const gst = spec.length ? r2(lines.reduce((a, l) => a + l.gst, 0)) : r2(netSelling * 0.18);
  const cgst = p.gst_mode === "INTRA" ? r2(gst / 2) : 0;
  const sgst = p.gst_mode === "INTRA" ? r2(gst - cgst) : 0;
  const igst = p.gst_mode === "INTER" ? gst : 0;
  const grossMargin = r2(netSelling - totalCost);
  const contribution = r2(netSelling - direct);
  return {
    direct, byCategory, contingency, overhead, finance, warranty, totalCost,
    grossSelling, discount, netSelling,
    grossMargin, marginPct: netSelling ? r2((grossMargin / netSelling) * 100) : 0,
    contribution, contributionPct: netSelling ? r2((contribution / netSelling) * 100) : 0,
    cgst, sgst, igst, gst, grandTotal: r2(netSelling + gst), lines,
  };
}
