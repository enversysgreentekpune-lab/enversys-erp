import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage, can } from "@/lib/auth";
import { q, one } from "@/lib/db";
import { inr, dt, num } from "@/lib/format";
import { grnAction, vendorBillAction, vendorPaymentAction } from "@/app/actions/ops";
import { Table, Empty } from "@/components/ui";
import { PageHeader, Card, Badge, Field } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { savePoAction, submitPoAction } from "@/app/actions/wo";

export default async function PoDetail({ params }: { params: Promise<{ id: string }> }) {
  const u = await requirePage("purchase");
  const { id } = await params;
  const po = await one(`select po.*, w.wo_no, w.id wid, pr.pr_no from purchase_order po join work_order w on w.id=po.wo_id left join purchase_requisition pr on pr.id=po.pr_id where po.id=$1`, [id]);
  if (!po) notFound();
  const [lines, vendors, appr, grns, bills, locs] = await Promise.all([
    q(`select pl.*, coalesce((select sum(qty_accepted) from grn_line gl where gl.po_line_id=pl.id),0) received from po_line pl where po_id=$1 order by description`, [id]),
    q(`select id, name from vendor where is_active order by name`),
    q(`select a.*, e.name dec from approval a left join employee e on e.id=a.decided_by where entity_id=$1 order by created_at desc`, [id]),
    q(`select g.*, (select coalesce(sum(qty_accepted*rate),0) from grn_line gl where gl.grn_id=g.id) value, (select json_agg(json_build_object('id', a.id, 'name', a.file_name)) from attachment a where a.entity='grn' and a.entity_id=g.id) files from grn g where po_id=$1 order by received_date`, [id]),
    q(`select b.*, coalesce((select sum(amount) from vendor_payment p where p.bill_id=b.id),0) paid, (select min(a.id::text) from attachment a where a.entity='vendor_bill' and a.entity_id=b.id) file from vendor_bill b where po_id=$1 order by bill_date`, [id]),
    q(`select id, name from location where is_active and kind in ('HO','FACTORY','SITE') order by kind desc, name`),
  ]);
  const canReceive = ["APPROVED", "SENT", "PARTIAL"].includes(po.status) && (!!can(u, "stores", "create") || !!can(u, "purchase", "create"));
  const canBill = ["APPROVED", "SENT", "PARTIAL", "RECEIVED"].includes(po.status) && (!!can(u, "finance", "create") || !!can(u, "purchase", "edit"));
  const draft = po.status === "DRAFT" && !!can(u, "purchase", "edit");
  const showBudget = !!can(u, "costing", "view");
  const budget = lines.reduce((a, l) => a + l.qty * l.budget_rate, 0);
  return (
    <div>
      <PageHeader back={{ href: "/purchase", label: "Purchase" }} title={po.po_no} subtitle={<span className="flex items-center gap-2">For <Link className="link" href={`/work-orders/${po.wid}`}>{po.wo_no}</Link> · PR {po.pr_no} · <Badge status={po.status} /></span>} />
      <ActionForm action={savePoAction} hideSubmit={!draft} submitLabel="Save draft">
        <input type="hidden" name="id" value={id} />
        <Card title="Header">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Vendor"><select name="vendor_id" disabled={!draft} defaultValue={po.vendor_id ?? ""} className="input"><option value="">— select —</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
            <Field label="Delivery date"><input type="date" name="delivery_date" disabled={!draft} defaultValue={po.delivery_date ?? ""} className="input" /></Field>
            <Field label="Totals"><div className="py-2 text-sm">{inr(po.total)} + GST {inr(po.gst_total)}{showBudget && <span className={po.total > budget ? " text-rose-600" : " text-emerald-600"}> · budget {inr(budget)}</span>}</div></Field>
            <Field label="Terms" className="sm:col-span-3"><textarea name="terms" disabled={!draft} defaultValue={po.terms ?? ""} className="input" /></Field>
          </div>
        </Card>
        <Card title="Lines" className="mt-4" bodyClass="overflow-x-auto p-0">
          <table className="tbl min-w-[800px]"><thead><tr><th>Item</th><th>Description</th><th>Specification</th><th>Qty</th><th>UOM</th><th>Rate ₹</th><th>GST %</th>{showBudget && <th>Budget rate</th>}<th>Amount</th><th>Received</th></tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l.id}><td className="text-xs">{l.item_code}<input type="hidden" name="line_id" value={l.id} /></td><td>{l.description}</td>
                <td><input name="spec" disabled={!draft} defaultValue={l.specification ?? ""} className="input py-1 text-xs" /></td>
                <td className="w-24"><input name="qty" disabled={!draft} defaultValue={l.qty} className="input py-1 text-right" /></td><td>{l.uom}</td>
                <td className="w-32"><input name="rate" disabled={!draft} defaultValue={l.rate} className="input py-1 text-right" /></td>
                <td className="w-20"><input name="gst" disabled={!draft} defaultValue={l.gst_pct} className="input py-1 text-right" /></td>
                {showBudget && <td className={`num ${l.rate > l.budget_rate ? "text-rose-600" : ""}`}>{inr(l.budget_rate)}</td>}<td className="num">{inr(l.qty * l.rate)}</td><td className={`num ${Number(l.received) >= Number(l.qty) ? "text-brand-700" : ""}`}>{num(l.received, 2)} / {num(l.qty, 2)}</td></tr>))}</tbody></table>
        </Card>
      </ActionForm>
      {draft && (
        <Card title="Submit for approval" className="mt-4 max-w-xl">
          <ActionForm action={submitPoAction} submitLabel="Submit for approval"><input type="hidden" name="id" value={id} />
            <label className="text-sm"><input type="checkbox" name="ack_over" value="1" /> Acknowledge budget overrun (if any)</label>
            <p className="mt-1 text-xs text-slate-500">Approver by value: &lt; ₹5 L Purchase Manager · ₹5–25 L Business Head · &gt; ₹25 L MD (editable in Admin → Approval matrix).</p>
          </ActionForm>
        </Card>
      )}
      {appr.length > 0 && <Card title="Approval history" className="mt-4"><ul className="text-sm">{appr.map((a) => <li key={a.id}>{a.approver_role} · <Badge status={a.status} /> {a.dec && `by ${a.dec}`} {a.remarks}</li>)}</ul></Card>}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title={`Material receipts (${grns.length})`} bodyClass="p-0">
          {grns.length ? <Table head={["GRN", "Date", "Challan", "Value", "Evidence"]}>{grns.map((g) => <tr key={g.id}><td>{g.grn_no}</td><td>{dt(g.received_date)}</td><td>{g.challan_no}<div className="text-xs text-slate-500">{dt(g.challan_date)}</div></td><td className="num">{inr(g.value)}</td><td className="text-xs">{(g.files ?? []).map((f: any) => <a key={f.id} className="link mr-2" href={`/api/files/${f.id}`}>{f.name}</a>)}</td></tr>)}</Table> : <Empty>Nothing received yet</Empty>}
          {canReceive && (
            <div className="border-t border-slate-100 p-4 dark:border-slate-800">
              <h3 className="mb-2 text-sm font-semibold">Record material receipt</h3>
              <ActionForm action={grnAction} reset submitLabel="Save receipt (GRN)" className="space-y-2">
                <input type="hidden" name="po_id" value={id} />
                <table className="tbl"><thead><tr><th>Item</th><th>Pending</th><th>Received</th><th>Accepted</th></tr></thead><tbody>
                  {lines.map((l) => <tr key={l.id}><td className="text-xs">{l.description}<input type="hidden" name="po_line_id" value={l.id} /></td><td className="num text-xs">{num(Math.max(0, l.qty - l.received), 2)} {l.uom}</td>
                    <td><input name="received" inputMode="decimal" defaultValue={Math.max(0, l.qty - l.received) || ""} className="input w-24 py-1" /></td><td><input name="accepted" inputMode="decimal" placeholder="= received" className="input w-24 py-1" /></td></tr>)}
                </tbody></table>
                <div className="grid grid-cols-2 gap-2">
                  <select name="location_id" className="input">{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
                  <input type="date" name="date" className="input" aria-label="Received date" />
                  <input name="challan_no" required placeholder="Delivery challan no." className="input" /><input type="date" name="challan_date" className="input" aria-label="Challan date" />
                  <input name="vehicle_no" placeholder="Vehicle no." className="input" /><input name="vendor_invoice_no" placeholder="Vendor invoice no." className="input" />
                </div>
                <input name="remarks" placeholder="Remarks / rejection reason" className="input" />
                <div><span className="label">Challan / material photos</span><input type="file" name="evidence" multiple accept="image/*,application/pdf" className="text-sm" /></div>
              </ActionForm>
            </div>
          )}
        </Card>
        <Card title={`Vendor bills (${bills.length})`} bodyClass="p-0">
          {bills.length ? <Table head={["Bill", "Date", "Total", "Paid", "Unpaid", ""]}>{bills.map((b) => (
            <tr key={b.id}><td>{b.file ? <a className="link" href={`/api/files/${b.file}`}>{b.bill_no}</a> : b.bill_no}</td><td>{dt(b.bill_date)}</td><td className="num">{inr(b.total)}</td><td className="num">{inr(b.paid)}</td><td className="num">{inr(b.total - b.paid)}</td>
              <td>{Number(b.total) - Number(b.paid) > 1 && can(u, "finance", "create") && (
                <ActionForm action={vendorPaymentAction} hideSubmit className="flex gap-1"><input type="hidden" name="bill_id" value={b.id} /><input name="amount" defaultValue={Math.round(b.total - b.paid)} className="input w-24 py-1" /><input type="date" name="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="input w-36 py-1" /><input type="hidden" name="mode" value="NEFT" /><button className="btn-primary btn-sm">Pay</button></ActionForm>)}</td></tr>))}</Table> : <Empty>No bills yet</Empty>}
          {canBill && (
            <div className="border-t border-slate-100 p-4 dark:border-slate-800">
              <h3 className="mb-2 text-sm font-semibold">Enter vendor bill</h3>
              <ActionForm action={vendorBillAction} reset submitLabel="Save bill" className="grid grid-cols-2 gap-2">
                <input type="hidden" name="po_id" value={id} />
                <input name="bill_no" required placeholder="Bill / invoice no." className="input" /><input type="date" name="bill_date" required className="input" aria-label="Bill date" />
                <input name="taxable" required placeholder="Taxable amount ₹" className="input" /><input name="gst" placeholder="GST ₹" className="input" />
                <input type="date" name="due_date" className="input" aria-label="Due date" />
                <select name="grn_id" className="input"><option value="">Against GRN (optional)</option>{grns.map((g) => <option key={g.id} value={g.id}>{g.grn_no}</option>)}</select>
                <div className="col-span-2"><span className="label">Bill copy</span><input type="file" name="bill_file" accept="image/*,application/pdf" className="text-sm" /></div>
              </ActionForm>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
