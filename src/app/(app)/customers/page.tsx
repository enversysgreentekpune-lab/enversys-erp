import Link from "next/link";
import { requirePage, can, scopeSql } from "@/lib/auth";
import { q } from "@/lib/db";
import { inrShort } from "@/lib/format";
import { PageHeader, Card, Table, Badge, Empty } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { importCustomersAction } from "@/app/actions/customers";

export const metadata = { title: "Customers" };
export default async function Customers({ searchParams }: { searchParams: Promise<{ q?: string; rating?: string }> }) {
  const u = await requirePage("customers");
  const sp = await searchParams;
  const p: unknown[] = [];
  const where = [scopeSql(u, can(u, "customers", "view")!, { owner: ["c.owner_id", "c.created_by"], vertical: "c.vertical_id" }, p)];
  if (sp.q) { p.push(`%${sp.q}%`); where.push(`(c.name ilike $${p.length} or c.code ilike $${p.length} or c.gstin ilike $${p.length} or c.group_name ilike $${p.length})`); }
  if (sp.rating) { p.push(sp.rating); where.push(`c.rating=$${p.length}`); }
  const rows = await q(`select c.*, e.name owner, (select city from customer_address a where a.customer_id=c.id and a.is_default limit 1) city,
      (select count(*)::int from lead l where l.customer_id=c.id) leads,
      (select count(*)::int from lead l where l.customer_id=c.id and l.stage not in ('WON','LOST','DROPPED','REGRETTED')) open_leads,
      (select coalesce(sum(contract_value),0) from work_order w where w.customer_id=c.id) orders
    from customer c left join employee e on e.id=c.owner_id where ${where.join(" and ")} order by c.name limit 500`, p);
  return (
    <div>
      <PageHeader title="Customers" subtitle={`${rows.length} customers`} actions={<>
        {can(u, "customers", "export") && <a className="btn-secondary" href="/api/export/customers">Export Excel</a>}
        {can(u, "customers", "create") && <Link className="btn-primary" href="/customers/new">+ New customer</Link>}
      </>} />
      <form className="card mb-4 flex flex-wrap gap-2 p-3">
        <input name="q" defaultValue={sp.q} placeholder="Search name, code, GSTIN, group…" className="input max-w-sm" />
        <select name="rating" defaultValue={sp.rating ?? ""} className="input w-32"><option value="">All ratings</option><option>A</option><option>B</option><option>C</option></select>
        <button className="btn-secondary">Filter</button>
      </form>
      <Card bodyClass="p-0">
        {rows.length ? (
          <Table head={["Code", "Customer", "Industry", "City", "GSTIN", "Rating", "Owner", "Leads (open)", "Orders"]}>
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="text-xs text-slate-500">{c.code}</td>
                <td><Link className="link font-medium" href={`/customers/${c.id}`}>{c.name}</Link>{c.group_name && <div className="text-xs text-slate-500">{c.group_name}</div>}</td>
                <td>{c.industry}</td><td>{c.city}</td><td className="text-xs">{c.gstin}</td><td>{c.rating && <Badge tone={c.rating === "A" ? "green" : c.rating === "B" ? "blue" : "gray"}>{c.rating}</Badge>}</td>
                <td>{c.owner}</td><td className="num">{c.leads} ({c.open_leads})</td><td className="num">{inrShort(c.orders)}</td>
              </tr>
            ))}
          </Table>
        ) : <Empty>No customers found</Empty>}
      </Card>
      {can(u, "customers", "create") && (
        <Card title="Import from Excel" className="mt-4">
          <p className="mb-2 text-xs text-slate-500">Columns (row 1 = headers): Name · Group · Industry · GSTIN · Phone · Email · City · State · Contact name · Contact mobile · Contact email · Rating. Duplicates (GSTIN / phone / email / similar name) are skipped.</p>
          <ActionForm action={importCustomersAction} submitLabel="Import"><input type="file" name="file" accept=".xlsx" className="text-sm" /></ActionForm>
        </Card>
      )}
    </div>
  );
}
