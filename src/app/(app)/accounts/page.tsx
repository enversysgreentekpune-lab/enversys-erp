import Link from "next/link";
import { requirePage, can } from "@/lib/auth";
import { q } from "@/lib/db";
import { inr, inrShort, dt, label } from "@/lib/format";
import { PageHeader, Card, Table, Badge, Stat, Tabs, Empty } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { invoiceAction, receiptAction } from "@/app/actions/ops";

export const metadata = { title: "Accounts" };

export default async function Accounts({ searchParams }: { searchParams: Promise<{ tab?: string; kind?: string }> }) {
  const u = await requirePage("finance");
  const sp = await searchParams;
  const tab = sp.tab ?? "projects";
  const projects = await q(`select p.id, p.wo_no, p.title, p.order_kind, p.contract_value, p.billed, p.status, c.name customer,
      coalesce(i.gst,0) gst_billed, coalesce(i.total,0) total_billed, coalesce(r.recd,0) received, coalesce(r.gst_recd,0) gst_received
    from v_wo_pnl p join customer c on c.id=p.customer_id
    left join (select wo_id, sum(gst) gst, sum(total) total from invoice group by wo_id) i on i.wo_id=p.id
    left join (select i.wo_id, sum(r.amount) recd, sum(r.amount * i.gst / nullif(i.total,0)) gst_recd from receipt r join invoice i on i.id=r.invoice_id group by i.wo_id) r on r.wo_id=p.id
    where p.status <> 'CANCELLED' and ($1::text is null or p.order_kind=$1) order by p.wo_no`, [sp.kind ?? null]);
  const t = (k: string) => projects.reduce((a, p) => a + Number(p[k]), 0);
  const contract = t("contract_value"), billed = t("billed"), gst = t("gst_billed"), recd = t("received"), gstRecd = t("gst_received"), total = t("total_billed");
  const tabs = [{ key: "projects", label: "Project-wise billing" }, { key: "invoices", label: "Invoices & receipts" }, { key: "raise", label: "Raise invoice" }];
  return (
    <div>
      <PageHeader title="Accounts" subtitle="Billed and unbilled against each PO / SO, GST billed, received and outstanding" />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Order value (PO + SO)" value={inrShort(contract)} />
        <Stat label="Billed amount" value={inrShort(billed)} sub="excl. GST" />
        <Stat label="Unbilled as per PO/SO" value={inrShort(contract - billed)} tone="amber" />
        <Stat label="GST billed" value={inrShort(gst)} />
        <Stat label="GST received" value={inrShort(gstRecd)} tone="green" />
        <Stat label="GST not received" value={inrShort(gst - gstRecd)} tone={gst - gstRecd > 0 ? "red" : undefined} />
        <Stat label="Received (incl. GST)" value={inrShort(recd)} tone="green" />
        <Stat label="Outstanding" value={inrShort(total - recd)} tone={total - recd > 0 ? "amber" : undefined} href="/accounts?tab=invoices" />
      </div>
      <Tabs tabs={tabs} active={tab} base="/accounts" />
      {tab === "projects" && (
        <>
          <div className="mb-3 flex gap-2 text-sm">{[["", "All"], ["PO", "Projects (PO)"], ["SO", "Service orders (SO)"]].map(([k, l]) => <Link key={k} href={k ? `/accounts?kind=${k}` : "/accounts"} className={`rounded-full border px-3 py-1 ${(sp.kind ?? "") === k ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600"}`}>{l}</Link>)}</div>
          <Card bodyClass="p-0">
            <Table head={["Project code", "Type", "Client", "Order value", "Billed", "Unbilled", "GST billed", "GST received", "GST not received", "Received", "Outstanding"]}>
              {projects.map((p) => (
                <tr key={p.id}><td><Link className="link font-medium" href={`/work-orders/${p.id}`}>{p.wo_no}</Link><div className="max-w-[200px] truncate text-xs text-slate-500">{p.title}</div></td><td><Badge>{p.order_kind}</Badge></td><td>{p.customer}</td>
                  <td className="num">{inr(p.contract_value)}</td><td className="num">{inr(p.billed)}</td><td className="num">{inr(p.contract_value - p.billed)}</td><td className="num">{inr(p.gst_billed)}</td>
                  <td className="num">{inr(p.gst_received)}</td><td className="num">{inr(p.gst_billed - p.gst_received)}</td><td className="num">{inr(p.received)}</td><td className={`num ${p.total_billed - p.received > 1 ? "font-medium" : ""}`}>{inr(p.total_billed - p.received)}</td></tr>
              ))}
              <tr className="font-semibold"><td colSpan={3}>Total</td><td className="num">{inr(contract)}</td><td className="num">{inr(billed)}</td><td className="num">{inr(contract - billed)}</td><td className="num">{inr(gst)}</td><td className="num">{inr(gstRecd)}</td><td className="num">{inr(gst - gstRecd)}</td><td className="num">{inr(recd)}</td><td className="num">{inr(total - recd)}</td></tr>
            </Table>
          </Card>
        </>
      )}
      {tab === "invoices" && <Invoices canCreate={!!can(u, "finance", "create")} />}
      {tab === "raise" && can(u, "finance", "create") && <Raise />}
    </div>
  );
}

async function Invoices({ canCreate }: { canCreate: boolean }) {
  const rows = await q(`select i.*, w.wo_no, w.order_kind, c.name customer, m.name milestone, coalesce((select sum(amount) from receipt r where r.invoice_id=i.id),0) recd
    from invoice i left join work_order w on w.id=i.wo_id join customer c on c.id=i.customer_id left join milestone m on m.id=i.milestone_id order by i.invoice_date desc`);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Card bodyClass="p-0">
      {rows.length ? <Table head={["Invoice", "Date", "Project code", "Client", "Milestone", "Taxable", "GST", "Total", "Received", "Outstanding", "Due", ...(canCreate ? ["Record receipt"] : [])]}>
        {rows.map((i) => {
          const due = Number(i.total) - Number(i.recd);
          return <tr key={i.id}><td className="font-medium">{i.invoice_no}</td><td>{dt(i.invoice_date)}</td><td>{i.wo_no} <span className="text-[10px] text-slate-400">{i.order_kind}</span></td><td>{i.customer}</td><td className="text-xs">{i.milestone ?? "—"}</td>
            <td className="num">{inr(i.taxable)}</td><td className="num">{inr(i.gst)}</td><td className="num">{inr(i.total)}</td><td className="num">{inr(i.recd)}</td><td className="num">{due > 1 ? inr(due) : <Badge tone="green">Paid</Badge>}</td>
            <td className={due > 1 && i.due_date < today ? "text-rose-600" : ""}>{dt(i.due_date)}</td>
            {canCreate && <td>{due > 1 && <ActionForm action={receiptAction} hideSubmit className="flex gap-1"><input type="hidden" name="invoice_id" value={i.id} /><input name="amount" defaultValue={Math.round(due)} className="input w-24 py-1" /><input type="date" name="date" required defaultValue={today} className="input w-36 py-1" /><input type="hidden" name="mode" value="NEFT" /><button className="btn-primary btn-sm">Save</button></ActionForm>}</td>}</tr>;
        })}
      </Table> : <Empty>No invoices yet</Empty>}
    </Card>
  );
}

async function Raise() {
  const ms = await q(`select m.id, m.name, m.amount, m.status, m.due_date, w.id wo_id, w.wo_no, w.order_kind from milestone m join work_order w on w.id=m.wo_id where m.status in ('PENDING','DONE') and w.status <> 'CANCELLED' order by (m.status='DONE') desc, m.due_date`);
  const wos = await q(`select id, wo_no, title from work_order where status not in ('CANCELLED','CLOSED') order by wo_no`);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Bill a milestone" bodyClass="p-0">
        <Table head={["Project code", "Milestone", "Amount", "Due", "Status", ""]}>
          {ms.map((m) => <tr key={m.id}><td>{m.wo_no} <span className="text-[10px] text-slate-400">{m.order_kind}</span></td><td>{m.name}</td><td className="num">{inr(m.amount)}</td><td>{dt(m.due_date)}</td><td>{m.status === "DONE" ? <Badge tone="green">Achieved</Badge> : <Badge>{label(m.status)}</Badge>}</td>
            <td><ActionForm action={invoiceAction} hideSubmit><input type="hidden" name="wo_id" value={m.wo_id} /><input type="hidden" name="milestone_id" value={m.id} /><button className={m.status === "DONE" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>Invoice</button></ActionForm></td></tr>)}
        </Table>
      </Card>
      <Card title="Raise an invoice for any amount">
        <ActionForm action={invoiceAction} reset submitLabel="Raise invoice" className="grid gap-2">
          <select name="wo_id" required className="input">{wos.map((w) => <option key={w.id} value={w.id}>{w.wo_no} · {w.title.slice(0, 40)}</option>)}</select>
          <div className="grid grid-cols-3 gap-2"><input name="taxable" required placeholder="Taxable ₹" className="input" /><input name="gst_pct" defaultValue="18" placeholder="GST %" className="input" /><input type="date" name="date" className="input" aria-label="Invoice date" /></div>
        </ActionForm>
        <p className="mt-2 text-xs text-slate-500">Invoices cannot exceed the PO / SO value. GST e-invoice (IRN) and Tally export are planned.</p>
      </Card>
    </div>
  );
}
