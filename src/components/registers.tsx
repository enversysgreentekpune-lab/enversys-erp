import Link from "next/link";
import { q } from "@/lib/db";
import { inr, dt, label } from "@/lib/format";
import { Card, Table, Badge, Empty } from "@/components/ui";

export async function GrnRegister() {
  const rows = await q(`select g.*, po.po_no, po.id po_id, v.name vendor, w.wo_no, l.name loc, e.name by_name,
      (select coalesce(sum(qty_accepted*rate),0) from grn_line gl where gl.grn_id=g.id) value,
      (select count(*)::int from attachment a where a.entity='grn' and a.entity_id=g.id) evidence,
      (select min(a.id::text) from attachment a where a.entity='grn' and a.entity_id=g.id) first_file
    from grn g join purchase_order po on po.id=g.po_id left join vendor v on v.id=g.vendor_id left join work_order w on w.id=g.wo_id left join location l on l.id=g.location_id left join employee e on e.id=g.received_by
    order by g.received_date desc, g.grn_no desc`);
  return (
    <Card bodyClass="p-0">
      {rows.length ? <Table head={["GRN", "Date", "PO", "Project code", "Vendor", "Challan no. / date", "Vehicle", "Store", "Value", "Status", "Evidence"]}>
        {rows.map((g) => <tr key={g.id}><td className="font-medium">{g.grn_no}</td><td>{dt(g.received_date)}</td><td><Link className="link" href={`/purchase/${g.po_id}`}>{g.po_no}</Link></td><td>{g.wo_no}</td><td>{g.vendor}</td><td>{g.challan_no}<div className="text-xs text-slate-500">{dt(g.challan_date)}</div></td><td className="text-xs">{g.vehicle_no}</td><td className="text-xs">{g.loc}</td><td className="num">{inr(g.value)}</td><td><Badge status={g.status === "ACCEPTED" ? "APPROVED" : "PENDING"}>{label(g.status)}</Badge></td>
          <td>{g.evidence ? <a className="link text-xs" href={`/api/files/${g.first_file}`}>📎 {g.evidence} file(s)</a> : <span className="text-xs text-slate-400">—</span>}</td></tr>)}
      </Table> : <Empty>No material received yet. Record receipts from an approved PO.</Empty>}
    </Card>
  );
}

export async function Bills() {
  const rows = await q(`select b.*, v.name vendor, po.po_no, po.id po_id, w.wo_no, coalesce((select sum(amount) from vendor_payment p where p.bill_id=b.id),0) paid,
      (select min(a.id::text) from attachment a where a.entity='vendor_bill' and a.entity_id=b.id) file
    from vendor_bill b join vendor v on v.id=b.vendor_id left join purchase_order po on po.id=b.po_id left join work_order w on w.id=b.wo_id order by b.bill_date desc`);
  return (
    <Card bodyClass="p-0">
      {rows.length ? <Table head={["Bill no.", "Date", "Vendor", "PO", "Project code", "Taxable", "GST", "Total", "Paid", "Unpaid", "Due", "Status"]}>
        {rows.map((b) => {
          const due = Number(b.total) - Number(b.paid);
          const overdue = due > 1 && b.due_date && b.due_date < new Date().toISOString().slice(0, 10);
          return <tr key={b.id}><td>{b.file ? <a className="link" href={`/api/files/${b.file}`}>{b.bill_no}</a> : b.bill_no}</td><td>{dt(b.bill_date)}</td><td>{b.vendor}</td><td><Link className="link" href={`/purchase/${b.po_id}`}>{b.po_no}</Link></td><td>{b.wo_no}</td><td className="num">{inr(b.taxable)}</td><td className="num">{inr(b.gst)}</td><td className="num">{inr(b.total)}</td><td className="num">{inr(b.paid)}</td><td className="num">{inr(due)}</td><td className={overdue ? "text-rose-600" : ""}>{dt(b.due_date)}</td><td>{due <= 1 ? <Badge tone="green">Paid</Badge> : b.paid > 0 ? <Badge tone="amber">Part paid</Badge> : <Badge tone={overdue ? "red" : "gray"}>Unpaid</Badge>}</td></tr>;
        })}
      </Table> : <Empty>No vendor bills yet</Empty>}
    </Card>
  );
}
