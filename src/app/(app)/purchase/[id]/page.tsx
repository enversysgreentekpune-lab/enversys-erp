import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage, can } from "@/lib/auth";
import { q, one } from "@/lib/db";
import { inr, dt, num } from "@/lib/format";
import { PageHeader, Card, Badge, Field } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { savePoAction, submitPoAction } from "@/app/actions/wo";

export default async function PoDetail({ params }: { params: Promise<{ id: string }> }) {
  const u = await requirePage("purchase");
  const { id } = await params;
  const po = await one(`select po.*, w.wo_no, w.id wid, pr.pr_no from purchase_order po join work_order w on w.id=po.wo_id left join purchase_requisition pr on pr.id=po.pr_id where po.id=$1`, [id]);
  if (!po) notFound();
  const [lines, vendors, appr] = await Promise.all([q(`select * from po_line where po_id=$1 order by description`, [id]), q(`select id, name from vendor where is_active order by name`), q(`select a.*, e.name dec from approval a left join employee e on e.id=a.decided_by where entity_id=$1 order by created_at desc`, [id])]);
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
          <table className="tbl min-w-[800px]"><thead><tr><th>Item</th><th>Description</th><th>Specification</th><th>Qty</th><th>UOM</th><th>Rate ₹</th><th>GST %</th>{showBudget && <th>Budget rate</th>}<th>Amount</th></tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l.id}><td className="text-xs">{l.item_code}<input type="hidden" name="line_id" value={l.id} /></td><td>{l.description}</td>
                <td><input name="spec" disabled={!draft} defaultValue={l.specification ?? ""} className="input py-1 text-xs" /></td>
                <td className="w-24"><input name="qty" disabled={!draft} defaultValue={l.qty} className="input py-1 text-right" /></td><td>{l.uom}</td>
                <td className="w-32"><input name="rate" disabled={!draft} defaultValue={l.rate} className="input py-1 text-right" /></td>
                <td className="w-20"><input name="gst" disabled={!draft} defaultValue={l.gst_pct} className="input py-1 text-right" /></td>
                {showBudget && <td className={`num ${l.rate > l.budget_rate ? "text-rose-600" : ""}`}>{inr(l.budget_rate)}</td>}<td className="num">{inr(l.qty * l.rate)}</td></tr>))}</tbody></table>
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
      <p className="mt-3 text-xs text-slate-500">Emailing the PO to the vendor (PDF/Word/Excel), acknowledgements, expediting and GRN arrive in Phase 2.</p>
    </div>
  );
}
