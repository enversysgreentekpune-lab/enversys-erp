import { requireUser, can } from "@/lib/auth";
import { q } from "@/lib/db";
import { resolveFrame, type Frame } from "@/lib/period";
import { inr, inrShort, dt, label, pct } from "@/lib/format";
import { adminVsBudget } from "@/lib/queries";
import { PageHeader, Card, Table, Badge, Stat, Tabs, Field, Empty } from "@/components/ui";
import { FrameBar } from "@/components/FrameBar";
import { Bars } from "@/components/charts";
import { ActionForm } from "@/components/ActionForm";
import { addExpenseAction } from "@/app/actions/expenses";
import { OFFICE_HEADS, FACTORY_HEADS } from "@/lib/expenseHeads";

export const metadata = { title: "Admin expenses" };
export default async function Expenses({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const office = can(u, "office_admin", "view"), factory = can(u, "factory_admin", "view");
  const range = resolveFrame((sp.frame as Frame) ?? "fy", new Date(), { from: sp.from, to: sp.to });
  const centre = sp.tab === "factory" && factory ? "FACTORY_ADMIN" : sp.tab === "claims" ? "CLAIMS" : office ? "OFFICE_ADMIN" : factory ? "FACTORY_ADMIN" : "CLAIMS";
  const tabs = [...(office ? [{ key: "office", label: "Office admin (HO)" }] : []), ...(factory ? [{ key: "factory", label: "Factory admin (Markal)" }] : []), { key: "claims", label: "My expense claims" }];
  const wos = await q(`select w.id, w.wo_no, w.title from work_order w where w.status not in ('CLOSED','CANCELLED') order by wo_no`);
  const form = (
    <Card title={centre === "CLAIMS" ? "Submit expense claim" : `New ${centre === "FACTORY_ADMIN" ? "factory" : "office"} admin expense`}>
      <ActionForm action={addExpenseAction} reset submitLabel={centre === "CLAIMS" ? "Submit claim" : "Post expense"} className="space-y-2">
        {centre === "CLAIMS" ? (
          <><input type="hidden" name="claim" value="1" />
            <Field label="Charge to"><select name="centre" className="input"><option value="WO">Work order (project expense)</option><option value="OFFICE_ADMIN">Office admin</option>{factory && <option value="FACTORY_ADMIN">Factory admin</option>}</select></Field>
            <Field label="Work order"><select name="wo_id" className="input"><option value="">—</option>{wos.map((w) => <option key={w.id} value={w.id}>{w.wo_no} – {w.title.slice(0, 30)}</option>)}</select></Field></>
        ) : <input type="hidden" name="centre" value={centre} />}
        <Field label="Expense head"><select name="head" className="input">{(centre === "FACTORY_ADMIN" ? FACTORY_HEADS : centre === "CLAIMS" ? ["TRAVEL", "LODGING", "DA", "LOCAL_CONVEYANCE", "FOOD", "MISC"] : OFFICE_HEADS).map((h) => <option key={h} value={h}>{label(h)}</option>)}</select></Field>
        <input name="description" required placeholder="Description / vendor" className="input" />
        <div className="grid grid-cols-2 gap-2"><input name="amount" required placeholder="Amount ₹" className="input" /><input name="gst" placeholder="GST input ₹" className="input" /></div>
        <input type="date" name="date" className="input" />
        <div><span className="label">Bill photo / PDF</span><input type="file" name="bill" accept="image/*,application/pdf" capture="environment" className="text-sm" /></div>
      </ActionForm>
    </Card>
  );
  if (centre === "CLAIMS") {
    const mine = await q(`select ce.*, w.wo_no from cost_entry ce left join work_order w on w.id=ce.wo_id where ce.created_by=$1 and ce.source_type='EXPENSE_CLAIM' order by ce.created_at desc`, [u.id]);
    return (
      <div>
        <PageHeader title="Expenses" subtitle="Office admin, factory admin and employee claims are kept as separate cost centres" />
        <Tabs tabs={tabs} active="claims" base="/expenses" />
        <div className="grid gap-4 lg:grid-cols-3"><Card title="My claims" className="lg:col-span-2" bodyClass="p-0">{mine.length ? <Table head={["Date", "Charged to", "Head", "Description", "Amount", "Status"]}>{mine.map((c) => <tr key={c.id}><td>{dt(c.entry_date)}</td><td>{c.wo_no ?? label(c.cost_centre)}</td><td>{label(c.expense_head)}</td><td>{c.description}</td><td className="num">{inr(c.amount)}</td><td><Badge status={c.status === "POSTED" ? "APPROVED" : c.status === "PENDING_APPROVAL" ? "PENDING" : c.status} /></td></tr>)}</Table> : <Empty>No claims yet</Empty>}</Card>{form}</div>
      </div>
    );
  }
  const [bva, rows] = await Promise.all([
    adminVsBudget(centre as any, range),
    q(`select ce.*, e.name by_name from cost_entry ce left join employee e on e.id=ce.created_by where cost_centre=$1 and entry_date between $2 and $3 order by entry_date desc limit 300`, [centre, range.from, range.to]),
  ]);
  const actual = bva.reduce((a, x) => a + Number(x.actual), 0), budget = bva.reduce((a, x) => a + Number(x.budget), 0);
  const over = bva.filter((x) => Number(x.budget) > 0 && Number(x.actual) > Number(x.budget) * 1.1);
  return (
    <div>
      <PageHeader title="Expenses" subtitle={`${centre === "FACTORY_ADMIN" ? "Factory admin — Markal" : "Office admin — Head Office"} · reported as ${centre === "FACTORY_ADMIN" ? "factory overheads" : "corporate overheads"}, never mixed with project costs`} />
      <Tabs tabs={tabs} active={centre === "FACTORY_ADMIN" ? "factory" : "office"} base="/expenses" />
      <FrameBar showCompare={false} showUnit={false} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Actual" value={inrShort(actual)} /><Stat label="Budget" value={inrShort(budget)} />
        <Stat label="Variance" value={inrShort(budget - actual)} tone={actual > budget ? "red" : "green"} sub={budget ? pct((actual / budget) * 100, 0) + " used" : ""} />
        <Stat label="Heads > 110% of budget" value={over.length} tone={over.length ? "red" : "green"} sub={over.map((o) => label(o.head)).join(", ")} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Budget vs actual by head" className="lg:col-span-2"><Bars data={bva.map((x) => ({ h: label(x.head), budget: Number(x.budget), actual: Number(x.actual) }))} x="h" bars={[{ key: "budget", label: "Budget", color: "#cbd5e1" }, { key: "actual", label: "Actual" }]} height={300} /></Card>
        {(can(u, centre === "FACTORY_ADMIN" ? "factory_admin" : "office_admin", "create") ?? "own") !== "own" ? form : <Card><p className="text-sm text-slate-500">You can view these expenses. Use “My expense claims” to submit your own.</p></Card>}
        <Card title="Register" className="lg:col-span-3" bodyClass="p-0">
          {rows.length ? <Table head={["Date", "Head", "Description", "Amount", "GST", "Status", "By", "Bill"]}>{rows.map((r) => <tr key={r.id}><td>{dt(r.entry_date)}</td><td>{label(r.expense_head)}</td><td>{r.description}</td><td className="num">{inr(r.amount)}</td><td className="num">{inr(r.gst_amount)}</td><td><Badge status={r.status === "POSTED" ? "DONE" : "PENDING"}>{r.status}</Badge></td><td>{r.by_name}</td><td>{r.bill_attachment_id && <a className="link" href={`/api/files/${r.bill_attachment_id}`}>view</a>}</td></tr>)}</Table> : <Empty>No entries in period</Empty>}
        </Card>
      </div>
      <p className="mt-3 text-xs text-slate-500">Optional allocation of overheads to WOs (configurable % rule) arrives with Finance (Phase 3).</p>
    </div>
  );
}
