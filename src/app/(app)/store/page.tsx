import Link from "next/link";
import { requirePage, can } from "@/lib/auth";
import { q, one } from "@/lib/db";
import { inr, inrShort, dt, num, label } from "@/lib/format";
import { PageHeader, Card, Table, Badge, Stat, Tabs, Empty } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { GrnRegister, Bills } from "@/components/registers";
import { issueMaterialAction, stockAdjustAction } from "@/app/actions/ops";

export const metadata = { title: "Store" };

export default async function Store({ searchParams }: { searchParams: Promise<{ tab?: string; loc?: string; q?: string }> }) {
  const u = await requirePage("stores");
  const sp = await searchParams;
  const tab = sp.tab ?? "stock";
  const [stock, locs, k, delayed] = await Promise.all([
    q(`select i.id, i.code, i.description, i.material_group, i.uom, i.reorder_level, l.id loc_id, l.name loc,
        coalesce(sum(t.qty),0) qty, coalesce(sum(t.qty*t.rate) filter (where t.qty>0) / nullif(sum(t.qty) filter (where t.qty>0),0),0) avg_rate,
        max(t.txn_date) filter (where t.txn_type='GRN') last_in, max(t.txn_date) filter (where t.txn_type='ISSUE') last_out
      from item i cross join location l left join stock_txn t on t.item_id=i.id and t.location_id=l.id
      where i.is_active and l.kind in ('FACTORY','HO','SITE') and ($1::uuid is null or l.id=$1) and ($2::text is null or i.description ilike $2 or i.code ilike $2)
      group by i.id, l.id having coalesce(sum(t.qty),0) <> 0 or (i.reorder_level is not null and l.kind='FACTORY')
      order by i.material_group, i.description, l.name`, [sp.loc || null, sp.q ? `%${sp.q}%` : null]),
    q(`select id, name from location where is_active and kind in ('FACTORY','HO','SITE') order by kind desc, name`),
    one(`select (select count(*)::int from item where is_active) items,
        (select coalesce(sum(qty*rate),0) from stock_txn) value,
        (select count(*)::int from grn where received_date >= date_trunc('month', current_date)) grn_month,
        (select coalesce(sum(b.total - coalesce((select sum(amount) from vendor_payment p where p.bill_id=b.id),0)),0) from vendor_bill b) unpaid`),
    q(`select po.id, po.po_no, po.delivery_date, v.name vendor, w.wo_no, current_date - po.delivery_date days_late, pl.description, pl.qty, pl.uom,
        coalesce((select sum(qty_accepted) from grn_line gl where gl.po_line_id=pl.id),0) received
      from purchase_order po join po_line pl on pl.po_id=po.id left join vendor v on v.id=po.vendor_id join work_order w on w.id=po.wo_id
      where po.status in ('APPROVED','SENT','PARTIAL') and po.delivery_date < current_date
        and coalesce((select sum(qty_accepted) from grn_line gl where gl.po_line_id=pl.id),0) < pl.qty order by po.delivery_date`),
  ]);
  const low = stock.filter((s) => s.reorder_level != null && Number(s.qty) < Number(s.reorder_level));
  const tabs = [{ key: "stock", label: "Material & stock register" }, { key: "low", label: `Low stock (${low.length})` }, { key: "grn", label: "Receipts, challans & evidence" },
    { key: "issue", label: "Issue to jobs" }, { key: "delayed", label: `Delayed material (${delayed.length})` }, { key: "bills", label: "Bills" }];
  const stockTable = (rows: any[]) => (
    <Table head={["Item", "Group", "Store", "In stock", "Reorder level", "Avg rate", "Value", "Last receipt", "Last issue", "Status"]}>
      {rows.map((s) => {
        const isLow = s.reorder_level != null && Number(s.qty) < Number(s.reorder_level);
        return <tr key={s.id + s.loc_id}><td><span className="font-mono text-xs text-slate-500">{s.code}</span><div>{s.description}</div></td><td className="text-xs">{label(s.material_group)}</td><td className="text-xs">{s.loc}</td>
          <td className={`num font-medium ${isLow ? "text-rose-600" : ""}`}>{num(s.qty, 2)} {s.uom}</td><td className="num text-xs">{s.reorder_level != null ? num(s.reorder_level) : "—"}</td><td className="num">{inr(s.avg_rate)}</td><td className="num">{inr(s.qty * s.avg_rate)}</td>
          <td className="text-xs">{dt(s.last_in)}</td><td className="text-xs">{dt(s.last_out)}</td><td>{isLow ? <Badge tone="red">Low</Badge> : <Badge tone="green">OK</Badge>}</td></tr>;
      })}
    </Table>
  );
  return (
    <div>
      <PageHeader title="Store" subtitle="Material register, stock by location, receipts with challans & photos, issues to manufacturing jobs" />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Items in register" value={k!.items} />
        <Stat label="Stock value" value={inrShort(k!.value)} />
        <Stat label="Low stock items" value={low.length} tone={low.length ? "red" : "green"} href="/store?tab=low" />
        <Stat label="Delayed material lines" value={delayed.length} tone={delayed.length ? "amber" : undefined} href="/store?tab=delayed" />
        <Stat label="Receipts this month" value={k!.grn_month} href="/store?tab=grn" />
        <Stat label="Unpaid vendor bills" value={inrShort(k!.unpaid)} href="/store?tab=bills" />
      </div>
      <Tabs tabs={tabs} active={tab} base="/store" />
      {tab === "stock" && (
        <>
          <form className="mb-3 flex flex-wrap gap-2"><input type="hidden" name="tab" value="stock" /><input name="q" defaultValue={sp.q} placeholder="Search item" className="input w-56" />
            <select name="loc" defaultValue={sp.loc ?? ""} className="input w-56"><option value="">All stores</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select><button className="btn-secondary">Filter</button></form>
          <Card bodyClass="p-0">{stock.length ? stockTable(stock) : <Empty>No stock</Empty>}</Card>
          {can(u, "stores", "edit") && <StockAdjust locs={locs} />}
        </>
      )}
      {tab === "low" && <Card bodyClass="p-0">{low.length ? stockTable(low) : <Empty>All items are above their reorder level</Empty>}</Card>}
      {tab === "grn" && <GrnRegister />}
      {tab === "issue" && <Issues locs={locs} canIssue={!!can(u, "stores", "create")} />}
      {tab === "delayed" && (
        <Card bodyClass="p-0">
          {delayed.length ? <Table head={["PO", "Project code", "Vendor", "Item", "Ordered", "Received", "Due", "Days late"]}>
            {delayed.map((d, i) => <tr key={i}><td><Link className="link" href={`/purchase/${d.id}`}>{d.po_no}</Link></td><td>{d.wo_no}</td><td>{d.vendor}</td><td>{d.description}</td><td className="num">{num(d.qty, 2)} {d.uom}</td><td className="num">{num(d.received, 2)}</td><td>{dt(d.delivery_date)}</td><td className="num font-medium text-rose-600">{d.days_late}</td></tr>)}
          </Table> : <Empty>No delayed material</Empty>}
        </Card>
      )}
      {tab === "bills" && <Bills />}
    </div>
  );
}

async function Issues({ locs, canIssue }: { locs: any[]; canIssue: boolean }) {
  const [rows, jobs, items] = await Promise.all([
    q(`select t.*, i.description, i.uom, i.material_group, j.job_no, j.project_item_code, l.name loc, e.name by_name from stock_txn t join item i on i.id=t.item_id left join job_order j on j.id=t.job_id
       join location l on l.id=t.location_id left join employee e on e.id=t.created_by where t.txn_type='ISSUE' order by t.txn_date desc, t.created_at desc limit 200`),
    q(`select j.id, j.job_no, j.title, j.project_item_code from job_order j where j.status <> 'COMPLETED' order by j.job_no`),
    q(`select i.id, i.code, i.description, i.uom from item i where i.is_active and i.category in ('RAW_MATERIAL','CONSUMABLE','BOUGHT_OUT') order by i.material_group, i.description`),
  ]);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card title="Material issued to jobs" bodyClass="p-0">
        {rows.length ? <Table head={["Date", "Job / project item", "Item", "Group", "Qty", "Rate", "Value", "From", "By"]}>
          {rows.map((r) => <tr key={r.id}><td>{dt(r.txn_date)}</td><td>{r.job_no}<div className="font-mono text-[11px] text-slate-500">{r.project_item_code}</div></td><td>{r.description}</td><td className="text-xs">{label(r.material_group)}</td><td className="num">{num(-r.qty, 2)} {r.uom}</td><td className="num">{inr(r.rate)}</td><td className="num">{inr(-r.qty * r.rate)}</td><td className="text-xs">{r.loc}</td><td className="text-xs">{r.by_name}</td></tr>)}
        </Table> : <Empty>No issues yet</Empty>}
      </Card>
      {canIssue && (
        <Card title="Issue material to a job">
          <ActionForm action={issueMaterialAction} reset submitLabel="Issue" className="space-y-2">
            <select name="job_id" required className="input"><option value="">Job…</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.job_no} · {j.title.slice(0, 28)}</option>)}</select>
            <select name="item_id" required className="input"><option value="">Item…</option>{items.map((i) => <option key={i.id} value={i.id}>{i.description} ({i.uom})</option>)}</select>
            <select name="location_id" className="input">{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
            <div className="grid grid-cols-2 gap-2"><input name="qty" required placeholder="Quantity" className="input" /><input type="date" name="date" className="input" aria-label="Issue date" /></div>
          </ActionForm>
          <p className="mt-2 text-[11px] text-slate-500">Stock is checked before issue. The value is charged to the job and its project code at the average stock rate.</p>
        </Card>
      )}
    </div>
  );
}

async function StockAdjust({ locs }: { locs: any[] }) {
  const items = await q(`select id, description, uom from item where is_active order by description`);
  return (
    <Card title="Opening stock / adjustment" className="mt-4 max-w-3xl">
      <ActionForm action={stockAdjustAction} reset submitLabel="Save adjustment" className="grid gap-2 sm:grid-cols-3">
        <select name="item_id" className="input sm:col-span-2">{items.map((i) => <option key={i.id} value={i.id}>{i.description} ({i.uom})</option>)}</select>
        <select name="location_id" className="input">{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        <input name="qty" placeholder="Qty (+ add / − reduce)" className="input" /><input name="rate" placeholder="Rate ₹" className="input" /><input name="reason" placeholder="Reason (opening, physical count…)" className="input" />
      </ActionForm>
    </Card>
  );
}
