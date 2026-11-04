import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { q } from "@/lib/db";
import { inr, dt, label } from "@/lib/format";
import { PageHeader, Card, Table, Badge, Empty } from "@/components/ui";

export const metadata = { title: "Purchase" };
export default async function Purchase({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requirePage("purchase");
  const { status } = await searchParams;
  const rows = await q(`select po.*, v.name vendor, w.wo_no, w.id wid, (select count(*)::int from po_line l where l.po_id=po.id) lines
    from purchase_order po left join vendor v on v.id=po.vendor_id join work_order w on w.id=po.wo_id where ($1::text is null or po.status=$1) order by po.created_at desc, po.po_no desc`, [status ?? null]);
  return (
    <div>
      <PageHeader title="Purchase orders" subtitle="Auto-drafted from WO specifications · approve per value matrix" />
      <div className="mb-3 flex flex-wrap gap-2 text-sm">{["", "DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "RECEIVED"].map((s) => <Link key={s} href={s ? `/purchase?status=${s}` : "/purchase"} className={`rounded-full px-3 py-1 ${status === s || (!status && !s) ? "bg-brand-600 text-white" : "bg-slate-100 dark:bg-slate-800"}`}>{s ? label(s) : "All"}</Link>)}</div>
      <Card bodyClass="p-0">
        {rows.length ? <Table head={["PO", "WO", "Vendor", "Lines", "Status", "Value", "GST", "Delivery", "Created"]}>
          {rows.map((p) => <tr key={p.id}><td><Link className="link font-medium" href={`/purchase/${p.id}`}>{p.po_no}</Link></td><td><Link className="link" href={`/work-orders/${p.wid}`}>{p.wo_no}</Link></td><td>{p.vendor ?? <span className="text-amber-600">—</span>}</td><td className="num">{p.lines}</td><td><Badge status={p.status} /></td><td className="num">{inr(p.total)}</td><td className="num">{inr(p.gst_total)}</td><td>{dt(p.delivery_date)}</td><td>{dt(p.created_at)}</td></tr>)}
        </Table> : <Empty>No purchase orders</Empty>}
      </Card>
      <p className="mt-3 text-xs text-slate-500">RFQ & comparative statements, GRN, 3-way match, vendor rating and stores arrive in Phase 2.</p>
    </div>
  );
}
