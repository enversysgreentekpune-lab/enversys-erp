"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { computeCostSheet, COST_CATEGORIES, type CostParams } from "@/lib/costing";
import { saveRevisionAction } from "@/app/actions/proposals";

type Spec = { sl: number; item_code?: string; description: string; specification?: string; make?: string; moc?: string; size_rating?: string; standard?: string; qty: number; uom: string; drawing_ref?: string; remarks?: string; hsn?: string; gst_pct: number; is_fabricated?: boolean };
type Cost = { spec_sl: number | null; category: string; description: string; qty: number; uom?: string; rate: number; rate_source?: string };
type Item = { code: string; description: string; specification: string | null; make: string | null; moc: string | null; uom: string; hsn: string | null; gst_pct: number; last_purchase_rate: number | null; standard_rate: number | null; category: string };

const f2 = (n: number) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const TERMS: [string, string][] = [["price_basis", "Price basis"], ["validity", "Validity"], ["payment", "Payment terms"], ["delivery", "Delivery period"], ["warranty", "Warranty"], ["ld", "LD clause"], ["exclusions", "Exclusions"], ["deviations", "Deviations"]];

export function RevisionEditor({ revisionId, editable, showCost, canEditCost, canMargin, initial, items, section }: {
  revisionId: string; editable: boolean; showCost: boolean; canEditCost: boolean; canMargin: boolean; section: "spec" | "cost" | "terms";
  initial: { spec: Spec[]; cost: Cost[]; params: CostParams; terms: Record<string, string> }; items: Item[];
}) {
  const [spec, setSpec] = useState<Spec[]>(initial.spec);
  const [cost, setCost] = useState<Cost[]>(initial.cost);
  const [params, setParams] = useState<CostParams>(initial.params);
  const [terms, setTerms] = useState<Record<string, string>>(initial.terms);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const totals = useMemo(() => { try { return computeCostSheet(spec.map((s, i) => ({ ...s, sl: i + 1 })), cost, params); } catch { return null; } }, [spec, cost, params]);
  const priced = new Map(totals?.lines.map((l) => [l.sl, l]) ?? []);
  const touch = () => { setDirty(true); setMsg(null); };
  const upSpec = (i: number, k: keyof Spec, v: any) => { const x = [...spec]; (x[i] as any)[k] = v; setSpec(x); touch(); };
  const upCost = (i: number, k: keyof Cost, v: any) => { const x = [...cost]; (x[i] as any)[k] = v; setCost(x); touch(); };
  const pickItem = (i: number, code: string) => {
    const it = items.find((x) => x.code === code);
    const x = [...spec];
    x[i] = { ...x[i], item_code: code, ...(it ? { description: it.description, specification: it.specification ?? "", make: it.make ?? "", moc: it.moc ?? "", uom: it.uom, hsn: it.hsn ?? "", gst_pct: Number(it.gst_pct), is_fabricated: it.category === "FABRICATED" } : {}) };
    setSpec(x); touch();
  };
  const costFromItems = () => {
    const add: Cost[] = [];
    spec.forEach((s, i) => {
      const sl = i + 1;
      if (cost.some((c) => c.spec_sl === sl)) return;
      const it = items.find((x) => x.code === s.item_code);
      const rate = Number(it?.last_purchase_rate ?? it?.standard_rate ?? 0);
      add.push({ spec_sl: sl, category: s.is_fabricated ? "FABRICATION" : it?.category === "RAW_MATERIAL" ? "RAW_MATERIAL" : "BOUGHT_OUT", description: s.description, qty: Number(s.qty), uom: s.uom, rate, rate_source: it?.last_purchase_rate ? "LAST_PO" : it?.standard_rate ? "STANDARD" : "MANUAL" });
    });
    setCost([...cost, ...add]); touch();
  };
  const save = () => start(async () => {
    const r = await saveRevisionAction(revisionId, { spec: spec.map((s, i) => ({ ...s, sl: i + 1, qty: Number(s.qty), gst_pct: Number(s.gst_pct) })), cost: cost.map((c) => ({ ...c, qty: Number(c.qty), rate: Number(c.rate), spec_sl: c.spec_sl ? Number(c.spec_sl) : null })), params, terms });
    setMsg({ ok: !!r?.ok, t: (r?.ok ? r.message : r?.error) ?? "" });
    if (r?.ok) { setDirty(false); router.refresh(); }
  });
  const ro = !editable;
  const inp = "w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-slate-300 focus:border-brand-500 focus:bg-white focus:outline-none dark:focus:bg-slate-900";

  return (
    <div className="space-y-4">
      {editable && (
        <div className="sticky top-14 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white/95 p-2 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
          <button className="btn-primary" disabled={pending || !dirty} onClick={save}>{pending ? "Saving…" : dirty ? "Save revision" : "Saved"}</button>
          {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
          {msg && <span className={`text-sm ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>{msg.t}</span>}
          {totals && <span className="ml-auto text-sm">Net <b>₹{f2(totals.netSelling)}</b>{showCost && <> · Margin <b className={totals.marginPct < 10 ? "text-rose-600" : "text-emerald-600"}>{totals.marginPct}%</b></>}</span>}
        </div>
      )}

      {section === "spec" && (
        <div className="card overflow-x-auto">
          <table className="tbl min-w-[1100px]">
            <thead><tr>{["#", "Item code", "Description", "Technical specification", "Make", "MOC", "Size / rating", "Std", "Qty", "UOM", "Dwg ref", "GST%", "Fab@Markal", "Unit price", "Amount", ""].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {spec.map((s, i) => (
                <tr key={i}>
                  <td className="text-xs text-slate-400">{i + 1}</td>
                  <td className="w-28"><input disabled={ro} className={inp} list="items" value={s.item_code ?? ""} onChange={(e) => pickItem(i, e.target.value)} /></td>
                  <td className="w-48"><input disabled={ro} className={inp} value={s.description} onChange={(e) => upSpec(i, "description", e.target.value)} /></td>
                  <td className="w-64"><textarea disabled={ro} rows={1} className={inp} value={s.specification ?? ""} onChange={(e) => upSpec(i, "specification", e.target.value)} /></td>
                  <td className="w-24"><input disabled={ro} className={inp} value={s.make ?? ""} onChange={(e) => upSpec(i, "make", e.target.value)} /></td>
                  <td className="w-20"><input disabled={ro} className={inp} value={s.moc ?? ""} onChange={(e) => upSpec(i, "moc", e.target.value)} /></td>
                  <td className="w-24"><input disabled={ro} className={inp} value={s.size_rating ?? ""} onChange={(e) => upSpec(i, "size_rating", e.target.value)} /></td>
                  <td className="w-20"><input disabled={ro} className={inp} value={s.standard ?? ""} onChange={(e) => upSpec(i, "standard", e.target.value)} /></td>
                  <td className="w-20"><input disabled={ro} className={`${inp} text-right`} type="number" value={s.qty} onChange={(e) => upSpec(i, "qty", e.target.value)} /></td>
                  <td className="w-16"><input disabled={ro} className={inp} value={s.uom} onChange={(e) => upSpec(i, "uom", e.target.value)} /></td>
                  <td className="w-24"><input disabled={ro} className={inp} value={s.drawing_ref ?? ""} onChange={(e) => upSpec(i, "drawing_ref", e.target.value)} /></td>
                  <td className="w-14"><input disabled={ro} className={`${inp} text-right`} type="number" value={s.gst_pct} onChange={(e) => upSpec(i, "gst_pct", e.target.value)} /></td>
                  <td className="text-center"><input disabled={ro} type="checkbox" checked={!!s.is_fabricated} onChange={(e) => upSpec(i, "is_fabricated", e.target.checked)} /></td>
                  <td className="num text-xs">{f2(priced.get(i + 1)?.unitPrice ?? 0)}</td>
                  <td className="num text-xs font-medium">{f2(priced.get(i + 1)?.amount ?? 0)}</td>
                  <td>{!ro && <button className="text-slate-400 hover:text-rose-600" onClick={() => { setSpec(spec.filter((_, j) => j !== i)); setCost(cost.filter((c) => c.spec_sl !== i + 1).map((c) => (c.spec_sl && c.spec_sl > i + 1 ? { ...c, spec_sl: c.spec_sl - 1 } : c))); touch(); }} aria-label="Remove">✕</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!ro && <div className="flex gap-2 p-2"><button className="btn-secondary btn-sm" onClick={() => { setSpec([...spec, { sl: spec.length + 1, description: "", qty: 1, uom: "NOS", gst_pct: 18 }]); touch(); }}>+ Add line</button>
            {canEditCost && <button className="btn-ghost btn-sm" onClick={costFromItems}>Create cost lines from item master rates</button>}</div>}
          <datalist id="items">{items.map((it) => <option key={it.code} value={it.code}>{it.description}</option>)}</datalist>
        </div>
      )}

      {section === "cost" && showCost && totals && (
        <div className="grid gap-4 2xl:grid-cols-3">
          <div className="card overflow-x-auto 2xl:col-span-2">
            <table className="tbl min-w-[960px]">
              <thead><tr>{["Spec #", "Category", "Description", "Qty", "UOM", "Rate (₹)", "Rate source", "Amount (₹)", ""].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {cost.map((c, i) => {
                  const ro2 = ro || !canEditCost;
                  return (
                    <tr key={i}>
                      <td className="w-36"><select disabled={ro2} className={inp} value={c.spec_sl ?? ""} onChange={(e) => upCost(i, "spec_sl", e.target.value ? Number(e.target.value) : null)}><option value="">Common</option>{spec.map((s, j) => <option key={j} value={j + 1}>{j + 1}. {s.description.slice(0, 18)}</option>)}</select></td>
                      <td className="w-52"><select disabled={ro2} className={inp} value={c.category} onChange={(e) => upCost(i, "category", e.target.value)}>{COST_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                      <td className="min-w-[220px]"><input disabled={ro2} className={inp} value={c.description} onChange={(e) => upCost(i, "description", e.target.value)} /></td>
                      <td className="w-20"><input disabled={ro2} type="number" className={`${inp} text-right`} value={c.qty} onChange={(e) => upCost(i, "qty", e.target.value)} /></td>
                      <td className="w-16"><input disabled={ro2} className={inp} value={c.uom ?? ""} onChange={(e) => upCost(i, "uom", e.target.value)} /></td>
                      <td className="w-32"><input disabled={ro2} type="number" className={`${inp} text-right`} value={c.rate} onChange={(e) => upCost(i, "rate", e.target.value)} /></td>
                      <td className="w-36"><select disabled={ro2} className={inp} value={c.rate_source ?? "MANUAL"} onChange={(e) => upCost(i, "rate_source", e.target.value)}>{["LAST_PO", "VENDOR_QUOTE", "STANDARD", "MANUAL"].map((r) => <option key={r}>{r}</option>)}</select></td>
                      <td className="num">{f2(Number(c.qty) * Number(c.rate))}</td>
                      <td>{!ro2 && <button className="text-slate-400 hover:text-rose-600" onClick={() => { setCost(cost.filter((_, j) => j !== i)); touch(); }} aria-label="Remove">✕</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!ro && canEditCost && <div className="p-2"><button className="btn-secondary btn-sm" onClick={() => { setCost([...cost, { spec_sl: null, category: "OTHER", description: "", qty: 1, rate: 0, rate_source: "MANUAL" }]); touch(); }}>+ Add cost line</button></div>}
          </div>
          <div className="card p-4 text-sm">
            <h3 className="mb-2 font-semibold">Cost build-up & price</h3>
            <dl className="space-y-1">
              {Object.entries(totals.byCategory).map(([k, v]) => <Row key={k} k={COST_CATEGORIES.find((c) => c[0] === k)?.[1] ?? k} v={v} muted />)}
              <Row k="Direct cost" v={totals.direct} bold />
              {([["contingency_pct", "Contingency", totals.contingency], ["overhead_pct", "Overheads", totals.overhead], ["finance_pct", "Finance cost", totals.finance], ["warranty_pct", "Warranty provision", totals.warranty]] as const).map(([k, l, v]) => (
                <div key={k} className="flex items-center justify-between gap-2"><span className="flex items-center gap-1">{l} <PctInput disabled={ro || !canEditCost} value={params[k]} onChange={(x) => { setParams({ ...params, [k]: x }); touch(); }} /></span><span className="tabular-nums">{f2(v)}</span></div>
              ))}
              <Row k="Total cost" v={totals.totalCost} bold />
              <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1">Margin on SP <PctInput disabled={ro || !canMargin} value={params.margin_pct} onChange={(x) => { setParams({ ...params, margin_pct: x }); touch(); }} />{!canMargin && <span className="text-[10px] text-slate-400">(locked)</span>}</span><span className="tabular-nums">{f2(totals.grossSelling)}</span></div>
              <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1">Discount <PctInput disabled={ro || !canEditCost} value={params.discount_pct} onChange={(x) => { setParams({ ...params, discount_pct: x }); touch(); }} /></span><span className="tabular-nums text-rose-600">−{f2(totals.discount)}</span></div>
              <Row k="Net selling price" v={totals.netSelling} bold />
              <div className="flex justify-between"><span>GST</span><select disabled={ro || !canEditCost} className="rounded border border-slate-300 bg-transparent text-xs dark:border-slate-700" value={params.gst_mode} onChange={(e) => { setParams({ ...params, gst_mode: e.target.value as any }); touch(); }}><option value="INTRA">CGST+SGST (intra-state)</option><option value="INTER">IGST (inter-state)</option></select></div>
              {params.gst_mode === "INTRA" ? <><Row k="CGST" v={totals.cgst} muted /><Row k="SGST" v={totals.sgst} muted /></> : <Row k="IGST" v={totals.igst} muted />}
              <Row k="Grand total" v={totals.grandTotal} bold />
              <hr className="my-2 border-slate-200 dark:border-slate-700" />
              <div className="flex justify-between"><span>Gross margin</span><b className={totals.marginPct < 10 ? "text-rose-600" : "text-emerald-600"}>₹{f2(totals.grossMargin)} ({totals.marginPct}%)</b></div>
              <div className="flex justify-between"><span>Contribution</span><span>₹{f2(totals.contribution)} ({totals.contributionPct}%)</span></div>
            </dl>
            <p className="mt-3 text-[11px] text-slate-500">Discount beyond approval limits routes the proposal to Business Head / MD for internal approval.</p>
          </div>
        </div>
      )}

      {section === "terms" && (
        <div className="card grid gap-3 p-4 sm:grid-cols-2">
          {TERMS.map(([k, l]) => (
            <label key={k} className="block"><span className="label">{l}</span>
              <textarea disabled={ro} className="input min-h-16" value={terms[k] ?? ""} onChange={(e) => { setTerms({ ...terms, [k]: e.target.value }); touch(); }} /></label>
          ))}
        </div>
      )}
    </div>
  );
}
function Row({ k, v, bold, muted }: { k: string; v: number; bold?: boolean; muted?: boolean }) {
  return <div className={`flex justify-between ${bold ? "border-t border-slate-100 pt-1 font-semibold dark:border-slate-800" : ""} ${muted ? "text-slate-500" : ""}`}><span>{k}</span><span className="tabular-nums">{f2(v)}</span></div>;
}
function PctInput({ value, onChange, disabled }: { value: number; onChange: (n: number) => void; disabled?: boolean }) {
  return <span className="inline-flex items-center"><input disabled={disabled} type="number" step="0.5" className="w-14 rounded border border-slate-300 bg-transparent px-1 text-right text-xs disabled:border-transparent dark:border-slate-700" value={value} onChange={(e) => onChange(Number(e.target.value))} />%</span>;
}
