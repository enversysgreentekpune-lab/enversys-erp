import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { q, one } from "@/lib/db";
import { inr, inrShort, dt, label, pct } from "@/lib/format";
import { PageHeader, Card, Table, Badge, Stat, Tabs, Empty } from "@/components/ui";
import { Bars } from "@/components/charts";
import { GrnRegister, Bills } from "@/components/registers";

export const metadata = { title: "Purchase" };
type SP = { tab?: string; status?: string; project?: string };

export default async function Purchase({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePage("purchase");
  const sp = await searchParams;
  const tab = sp.tab ?? "dashboard";
  const [k, projects, delayed, vendors] = await Promise.all([
    one(`select
        coalesce(sum(total) filter (where status not in ('DRAFT','PENDING_APPROVAL','CANCELLED')),0) raised, count(*) filter (where status not in ('DRAFT','PENDING_APPROVAL','CANCELLED'))::int raised_n,
        count(*) filter (where status='DRAFT')::int draft_n, coalesce(sum(total) filter (where status='DRAFT'),0) draft,
        count(*) filter (where status='PENDING_APPROVAL')::int pending_n, coalesce(sum(total) filter (where status='PENDING_APPROVAL'),0) pending,
        (select coalesce(sum(gl.qty_accepted*gl.rate),0) from grn_line gl) received,
        (select coalesce(sum(total),0) from vendor_bill) billed,
        (select coalesce(sum(amount),0) from vendor_payment) paid
      from purchase_order`),
    q(`select w.id, w.wo_no, w.title, c.name customer,
        (select coalesce(sum(amount),0) from wo_budget_line b where b.wo_id=w.id and b.category in ('MATERIAL','BOUGHT_OUT','RAW_MATERIAL','FABRICATION','PAINTING','PACKING')) budget,
        (select coalesce(sum(total),0) from purchase_order po where po.wo_id=w.id and po.status not in ('DRAFT','PENDING_APPROVAL','CANCELLED')) po_raised,
        (select count(*)::int from purchase_order po where po.wo_id=w.id) po_n,
        (select coalesce(sum(gl.qty_accepted*gl.rate),0) from grn_line gl join grn g on g.id=gl.grn_id where g.wo_id=w.id) received,
        (select coalesce(sum(total),0) from vendor_bill b where b.wo_id=w.id) billed,
        (select coalesce(sum(p.amount),0) from vendor_payment p join vendor_bill b on b.id=p.bill_id where b.wo_id=w.id) paid
      from work_order w join customer c on c.id=w.customer_id where w.order_kind='PO' and w.status not in ('CANCELLED') order by w.wo_no`),
    q(`select po.id, po.po_no, po.delivery_date, v.name vendor, w.wo_no, current_date - po.delivery_date days_late,
        (select coalesce(sum(pl.qty),0) from po_line pl where pl.po_id=po.id) ordered,
        (select coalesce(sum(gl.qty_accepted),0) from grn_line gl join po_line pl on pl.id=gl.po_line_id where pl.po_id=po.id) received
      from purchase_order po left join vendor v on v.id=po.vendor_id join work_order w on w.id=po.wo_id
      where po.status in ('APPROVED','SENT','PARTIAL') and po.delivery_date < current_date order by po.delivery_date`),
    q(`select v.name, count(po.*)::int n, coalesce(sum(po.total),0) v from purchase_order po join vendor v on v.id=po.vendor_id where po.status not in ('DRAFT','CANCELLED') group by 1 order by 3 desc limit 6`),
  ]);
  const unpaid = Number(k!.billed) - Number(k!.paid);
  const tabs = [{ key: "dashboard", label: "Dashboard" }, { key: "orders", label: "Purchase orders" }, { key: "grn", label: "Material receipt register" }, { key: "bills", label: "Bill receipts" }];
  return (
    <div>
      <PageHeader title="Purchase" subtitle="Project code → cost sheet budget → purchase orders → material receipts → vendor bills & payments" />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="PO raised" value={inrShort(k!.raised)} sub={`${k!.raised_n} approved POs`} href="/purchase?tab=orders" />
        <Stat label="Pending approval" value={k!.pending_n} sub={inrShort(k!.pending)} tone={k!.pending_n ? "amber" : undefined} href="/approvals" />
        <Stat label="Auto-drafted" value={k!.draft_n} sub={inrShort(k!.draft)} href="/purchase?tab=orders&status=DRAFT" />
        <Stat label="Material received" value={inrShort(k!.received)} href="/purchase?tab=grn" />
        <Stat label="Bills received" value={inrShort(k!.billed)} href="/purchase?tab=bills" />
        <Stat label="Paid" value={inrShort(k!.paid)} tone="green" />
        <Stat label="Unpaid" value={inrShort(unpaid)} tone={unpaid > 0 ? "amber" : undefined} href="/purchase?tab=bills" />
        <Stat label="Delayed POs" value={delayed.length} tone={delayed.length ? "red" : undefined} href="/store?tab=delayed" />
      </div>
      <Tabs tabs={tabs} active={tab} base="/purchase" />
      {tab === "dashboard" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Project-wise purchase position" className="lg:col-span-3" bodyClass="p-0">
            <Table head={["Project code", "Client", "Cost-sheet material budget", "PO raised", "% of budget", "Received", "Billed", "Paid", "Unpaid"]}>
              {projects.map((p) => (
                <tr key={p.id}><td><Link className="link font-medium" href={`/work-orders/${p.id}?tab=purchase`}>{p.wo_no}</Link><div className="max-w-[220px] truncate text-xs text-slate-500">{p.title}</div></td><td>{p.customer}</td>
                  <td className="num">{inr(p.budget)}</td><td className="num">{inr(p.po_raised)} <span className="text-xs text-slate-400">({p.po_n})</span></td>
                  <td className={`num ${p.budget && p.po_raised > p.budget ? "text-rose-600" : ""}`}>{p.budget ? pct((p.po_raised / p.budget) * 100, 0) : "—"}</td>
                  <td className="num">{inr(p.received)}</td><td className="num">{inr(p.billed)}</td><td className="num">{inr(p.paid)}</td><td className="num">{inr(p.billed - p.paid)}</td></tr>
              ))}
            </Table>
          </Card>
          <Card title="PO value by project" className="lg:col-span-2"><Bars data={projects.map((p) => ({ k: p.wo_no.slice(-7), budget: Number(p.budget), po: Number(p.po_raised), recd: Number(p.received) }))} x="k" bars={[{ key: "budget", label: "Budget", color: "#cbd5e1" }, { key: "po", label: "PO raised" }, { key: "recd", label: "Received" }]} height={240} /></Card>
          <Card title="Top vendors" bodyClass="p-0"><Table head={["Vendor", "POs", "Value"]}>{vendors.map((v) => <tr key={v.name}><td>{v.name}</td><td className="num">{v.n}</td><td className="num">{inrShort(v.v)}</td></tr>)}</Table></Card>
          <Card title="Delayed deliveries" className="lg:col-span-3" bodyClass="p-0">
            {delayed.length ? <Table head={["PO", "Project code", "Vendor", "Due", "Days late", "Received / ordered"]}>{delayed.map((d) => <tr key={d.id}><td><Link className="link" href={`/purchase/${d.id}`}>{d.po_no}</Link></td><td>{d.wo_no}</td><td>{d.vendor}</td><td>{dt(d.delivery_date)}</td><td className="num text-rose-600">{d.days_late}</td><td className="num">{Number(d.received)} / {Number(d.ordered)}</td></tr>)}</Table> : <Empty>No delayed deliveries</Empty>}
          </Card>
        </div>
      )}
      {tab === "orders" && <Orders status={sp.status} />}
      {tab === "grn" && <GrnRegister />}
      {tab === "bills" && <Bills />}
    </div>
  );
}

async function Orders({ status }: { status?: string }) {
  const rows = await q(`select po.*, v.name vendor, w.wo_no, w.id wid, (select count(*)::int from po_line l where l.po_id=po.id) lines,
      (select coalesce(sum(total),0) from vendor_bill b where b.po_id=po.id) billed
    from purchase_order po left join vendor v on v.id=po.vendor_id join work_order w on w.id=po.wo_id where ($1::text is null or po.status=$1) order by po.created_at desc, po.po_no desc`, [status ?? null]);
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2 text-sm">{["", "DRAFT", "PENDING_APPROVAL", "APPROVED", "PARTIAL", "RECEIVED"].map((s) => <Link key={s} href={s ? `/purchase?tab=orders&status=${s}` : "/purchase?tab=orders"} className={`rounded-full border px-3 py-1 ${status === s || (!status && !s) ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600"}`}>{s ? label(s) : "All"}</Link>)}</div>
      <Card bodyClass="p-0">
        {rows.length ? <Table head={["PO", "Project code", "Vendor", "Lines", "Status", "Value", "Billed", "Delivery", "Created"]}>
          {rows.map((p) => <tr key={p.id}><td><Link className="link font-medium" href={`/purchase/${p.id}`}>{p.po_no}</Link></td><td><Link className="link" href={`/work-orders/${p.wid}`}>{p.wo_no}</Link></td><td>{p.vendor ?? <span className="text-amber-600">—</span>}</td><td className="num">{p.lines}</td><td><Badge status={p.status} /></td><td className="num">{inr(p.total)}</td><td className="num">{inr(p.billed)}</td><td>{dt(p.delivery_date)}</td><td>{dt(p.created_at)}</td></tr>)}
        </Table> : <Empty>No purchase orders</Empty>}
      </Card>
    </>
  );
}

