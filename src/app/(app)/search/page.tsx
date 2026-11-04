import Link from "next/link";
import { requireUser, can, scopeSql } from "@/lib/auth";
import { q } from "@/lib/db";
import { woScope } from "@/lib/access";
import { PageHeader, Card, Badge, Empty } from "@/components/ui";
import { inrShort } from "@/lib/format";

export const metadata = { title: "Search" };
export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const u = await requireUser();
  const term = ((await searchParams).q ?? "").trim();
  if (term.length < 2) return <div><PageHeader title="Search" /><Empty>Type at least 2 characters in the search bar.</Empty></div>;
  const like = `%${term}%`;
  const groups: { title: string; items: { href: string; title: string; sub: string; badge?: string }[] }[] = [];
  if (can(u, "customers", "view")) {
    const p: unknown[] = [like];
    const rows = await q(`select id, code, name, gstin, industry from customer c where (name ilike $1 or code ilike $1 or gstin ilike $1 or group_name ilike $1) and ${scopeSql(u, can(u, "customers", "view")!, { owner: ["c.owner_id", "c.created_by"], vertical: "c.vertical_id" }, p)} limit 10`, p);
    groups.push({ title: "Customers", items: rows.map((r) => ({ href: `/customers/${r.id}`, title: r.name, sub: `${r.code} · ${r.industry ?? ""} · ${r.gstin ?? ""}` })) });
  }
  if (can(u, "leads", "view")) {
    const p: unknown[] = [like];
    const sc = scopeSql(u, can(u, "leads", "view")!, { owner: ["l.assigned_to", "l.created_by"], vertical: "l.vertical_id" }, p);
    const leads = await q(`select l.id, l.enquiry_no, l.title, l.stage, l.est_value, c.name customer from lead l join customer c on c.id=l.customer_id where (l.enquiry_no ilike $1 or l.title ilike $1 or l.tender_no ilike $1) and ${sc} limit 10`, p);
    groups.push({ title: "Leads / enquiries", items: leads.map((r) => ({ href: `/leads/${r.id}`, title: `${r.enquiry_no} — ${r.title}`, sub: `${r.customer} · ${inrShort(r.est_value)}`, badge: r.stage })) });
    const p2: unknown[] = [like];
    const sc2 = scopeSql(u, can(u, "leads", "view")!, { owner: ["p.owner_id", "l.assigned_to"], vertical: "l.vertical_id" }, p2);
    const props = await q(`select p.id, p.proposal_no, p.title, p.status, p.quoted_value from proposal p join lead l on l.id=p.lead_id where (p.proposal_no ilike $1 or p.title ilike $1) and ${sc2} limit 10`, p2);
    groups.push({ title: "Proposals", items: props.map((r) => ({ href: `/proposals/${r.id}`, title: `${r.proposal_no} — ${r.title}`, sub: inrShort(r.quoted_value), badge: r.status })) });
  }
  if (can(u, "work_orders", "view")) {
    const p: unknown[] = [like];
    const wos = await q(`select w.id, w.wo_no, w.title, w.status, cp.po_no from work_order w left join customer_po cp on cp.id=w.customer_po_id where (w.wo_no ilike $1 or w.title ilike $1 or cp.po_no ilike $1) and ${woScope(u, "view", p)} limit 10`, p);
    groups.push({ title: "Work orders", items: wos.map((r) => ({ href: `/work-orders/${r.id}`, title: `${r.wo_no} — ${r.title}`, sub: `Customer PO ${r.po_no ?? "—"}`, badge: r.status })) });
  }
  if (can(u, "purchase", "view")) {
    const pos = await q(`select po.id, po.po_no, po.status, v.name vendor from purchase_order po left join vendor v on v.id=po.vendor_id where po.po_no ilike $1 or v.name ilike $1 limit 10`, [like]);
    groups.push({ title: "Purchase orders", items: pos.map((r) => ({ href: `/purchase/${r.id}`, title: r.po_no, sub: r.vendor ?? "", badge: r.status })) });
  }
  const docs = await q(`select a.id, a.file_name, a.entity from attachment a where a.file_name ilike $1 and (a.uploaded_by=$2 or $3) limit 10`, [like, u.id, !!can(u, "leads", "view") && can(u, "leads", "view") !== "own"]);
  groups.push({ title: "Documents", items: docs.map((d) => ({ href: `/api/files/${d.id}`, title: d.file_name, sub: d.entity })) });
  const total = groups.reduce((a, g) => a + g.items.length, 0);
  return (
    <div>
      <PageHeader title={`Search: “${term}”`} subtitle={`${total} result(s)`} />
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.filter((g) => g.items.length).map((g) => (
          <Card key={g.title} title={g.title} bodyClass="p-0"><ul className="divide-y divide-slate-100 dark:divide-slate-800">{g.items.map((i) => <li key={i.href}><Link href={i.href} className="flex items-center justify-between gap-2 px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/40"><span><span className="block text-sm font-medium">{i.title}</span><span className="text-xs text-slate-500">{i.sub}</span></span>{i.badge && <Badge status={i.badge} />}</Link></li>)}</ul></Card>
        ))}
      </div>
      {!total && <Empty>No matches you have access to.</Empty>}
    </div>
  );
}
