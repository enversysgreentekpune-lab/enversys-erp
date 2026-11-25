import Link from "next/link";
import { requirePage, can, scopeSql } from "@/lib/auth";
import { q } from "@/lib/db";
import { inrShort } from "@/lib/format";
import { PageHeader, Card, Table, Badge, Empty } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { importCustomersAction } from "@/app/actions/customers";
import { Stat, Stepper } from "@/components/ui";
import { proposalScopeSql } from "@/lib/access";
import { fyStartYear } from "@/lib/period";
import { dt } from "@/lib/format";
import type { CurrentUser } from "@/lib/auth";

async function ClientDashboard({ u }: { u: CurrentUser }) {
  const p: unknown[] = [];
  const sc = scopeSql(u, can(u, "customers", "view")!, { owner: ["c.owner_id", "c.created_by"], vertical: "c.vertical_id" }, p);
  const fy = `${fyStartYear(new Date())}-04-01`;
  p.push(fy);
  const k = (await q(`select count(*)::int total,
      count(*) filter (where c.created_at >= date_trunc('month', now()))::int new_month,
      count(*) filter (where c.created_at >= $${p.length}::date)::int new_year,
      count(*) filter (where exists (select 1 from lead l where l.customer_id=c.id and l.stage not in ('LOST','DROPPED','REGRETTED') and l.updated_at > now() - interval '12 months')
                         or exists (select 1 from work_order w where w.customer_id=c.id and w.status not in ('CLOSED','CANCELLED')))::int active
    from customer c where ${sc}`, p))[0];
  const pp: unknown[] = [];
  const recent = await q(`select p.id, p.proposal_no, p.title, p.quoted_value, p.status, p.submitted_at, c.name customer from proposal p join customer c on c.id=p.customer_id
    where p.submitted_at > now() - interval '45 days' and ${proposalScopeSql(u, pp)} order by p.submitted_at desc limit 6`, pp);
  return (
    <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Total clients" value={k.total} />
        <Stat label="Active clients" value={k.active} sub="open enquiry or live project" tone="green" />
        <Stat label="New this month" value={k.new_month} />
        <Stat label="New this year (FY)" value={k.new_year} />
      </div>
      <div className="card p-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 dark:border-slate-800"><h2 className="text-sm font-semibold">Proposals submitted recently</h2><Link className="link text-xs" href="/proposals">All proposals</Link></div>
        {recent.length ? <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">{recent.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2"><span className="min-w-0"><Link href={`/proposals/${r.id}`} className="link font-medium">{r.proposal_no}</Link> <span className="text-slate-500">· {r.customer}</span><span className="block truncate text-xs text-slate-500">{r.title}</span></span>
            <span className="shrink-0 text-right text-xs"><b className="block text-sm text-navy-900 dark:text-slate-100">{inrShort(r.quoted_value)}</b>{dt(r.submitted_at)} · <Badge status={r.status} /></span></li>))}</ul>
          : <Empty>No proposals submitted in the last 45 days</Empty>}
      </div>
    </div>
  );
}

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
      <PageHeader title="Clients" subtitle="Client register and client dashboard" actions={<>
        {can(u, "customers", "export") && <a className="btn-secondary" href="/api/export/customers">Export Excel</a>}
        {can(u, "customers", "create") && <Link className="btn-primary" href="/customers/new">+ New client</Link>}
      </>} />
      <ClientDashboard u={u} />
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
