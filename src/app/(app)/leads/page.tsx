import Link from "next/link";
import { requirePage, can, scopeSql } from "@/lib/auth";
import { q } from "@/lib/db";
import { inrShort, dt, label } from "@/lib/format";
import { PageHeader, Card, Table, Badge, Empty } from "@/components/ui";
import { LEAD_STAGES, OPEN_STAGES, LEAD_SOURCES, stageLabel } from "@/lib/workflow";

export const metadata = { title: "Leads & Enquiries" };
type SP = { q?: string; stage?: string; vertical?: string; owner?: string; source?: string; open?: string; overdue?: string; view?: string; from?: string; to?: string };

export default async function Leads({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await requirePage("leads");
  const sp = await searchParams;
  const p: unknown[] = [];
  const w = [scopeSql(u, can(u, "leads", "view")!, { owner: ["l.assigned_to", "l.created_by"], vertical: "l.vertical_id" }, p)];
  const add = (sql: string, v: unknown) => { p.push(v); w.push(sql.replace("?", `$${p.length}`)); };
  if (sp.q) add(`(l.enquiry_no ilike ? or l.title ilike $${p.length + 1} or c.name ilike $${p.length + 1})`, `%${sp.q}%`);
  if (sp.stage) add(`l.stage = ?`, sp.stage);
  if (sp.vertical) add(`l.vertical_id = ?`, sp.vertical);
  if (sp.owner) add(`l.assigned_to = ?`, sp.owner);
  if (sp.source) add(`l.source = ?`, sp.source);
  if (sp.from) add(`l.enquiry_date >= ?`, sp.from);
  if (sp.to) add(`l.enquiry_date <= ?`, sp.to);
  if (sp.open) add(`l.stage = any(?)`, OPEN_STAGES);
  if (sp.overdue) { add(`l.stage = any(?)`, OPEN_STAGES); w.push(`l.next_followup_at < now()`); }
  const rows = await q(`select l.*, c.name customer, v.name vertical, e.name owner from lead l join customer c on c.id=l.customer_id join vertical v on v.id=l.vertical_id
    left join employee e on e.id=l.assigned_to where ${w.join(" and ")} order by l.enquiry_date desc, l.enquiry_no desc limit 500`, p);
  const [verts, owners] = await Promise.all([q(`select id, name from vertical order by sort`), q(`select distinct e.id, e.name from employee e join lead l on l.assigned_to=e.id order by e.name`)]);
  const kanban = sp.view === "kanban";
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "view") as [string, string][]).toString();
  return (
    <div>
      <PageHeader title="Lead / Enquiry register" subtitle={`${rows.length} enquiries · ${inrShort(rows.reduce((a, r) => a + Number(r.est_value), 0))}`}
        actions={<>
          <Link className="btn-secondary" href={`/leads?${qs}&view=${kanban ? "list" : "kanban"}`}>{kanban ? "List view" : "Pipeline board"}</Link>
          {can(u, "leads", "export") && <a className="btn-secondary" href={`/api/export/leads?${qs}`}>Export Excel</a>}
          {can(u, "leads", "create") && <Link className="btn-primary" href="/leads/new">+ New enquiry</Link>}
        </>} />
      <form className="card mb-4 grid gap-2 p-3 sm:grid-cols-4 lg:grid-cols-8">
        <input name="q" defaultValue={sp.q} placeholder="Search no., title, customer" className="input sm:col-span-2" />
        <select name="stage" defaultValue={sp.stage ?? ""} className="input"><option value="">All stages</option>{LEAD_STAGES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}</select>
        <select name="vertical" defaultValue={sp.vertical ?? ""} className="input"><option value="">All verticals</option>{verts.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
        <select name="owner" defaultValue={sp.owner ?? ""} className="input"><option value="">All owners</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
        <select name="source" defaultValue={sp.source ?? ""} className="input"><option value="">All sources</option>{LEAD_SOURCES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="open" value="1" defaultChecked={!!sp.open} /> Open only</label>
        <button className="btn-secondary">Filter</button>
        {kanban && <input type="hidden" name="view" value="kanban" />}
      </form>
      {kanban ? (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {LEAD_STAGES.filter((s) => !["DROPPED", "REGRETTED"].includes(s.code)).map((s) => {
            const items = rows.filter((r) => r.stage === s.code);
            return (
              <div key={s.code} className="w-64 shrink-0 rounded-xl bg-slate-100 p-2 dark:bg-slate-900">
                <div className="mb-2 flex justify-between px-1 text-xs font-semibold uppercase text-slate-500"><span>{s.label} ({items.length})</span><span>{inrShort(items.reduce((a, r) => a + Number(r.est_value), 0))}</span></div>
                <div className="space-y-2">
                  {items.map((l) => (
                    <Link key={l.id} href={`/leads/${l.id}`} className="block rounded-lg border border-slate-200 bg-white p-2 text-sm shadow-sm hover:border-brand-500 dark:border-slate-700 dark:bg-slate-800">
                      <div className="text-[11px] text-slate-500">{l.enquiry_no}</div><div className="font-medium leading-snug">{l.title}</div>
                      <div className="mt-1 flex justify-between text-xs text-slate-500"><span>{l.owner}</span><b>{inrShort(l.est_value)}</b></div>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Card bodyClass="p-0">
          {rows.length ? (
            <Table head={["Enquiry", "Date", "Customer", "Title", "Vertical", "Stage", "Owner", "Next follow-up", "Value"]}>
              {rows.map((l) => {
                const overdue = l.next_followup_at && new Date(l.next_followup_at) < new Date() && OPEN_STAGES.includes(l.stage);
                return (
                  <tr key={l.id}>
                    <td><Link className="link font-medium" href={`/leads/${l.id}`}>{l.enquiry_no}</Link>{l.tender_no && <div className="text-[11px] text-slate-500">Tender {l.tender_no}</div>}</td>
                    <td className="whitespace-nowrap">{dt(l.enquiry_date)}</td><td>{l.customer}</td><td className="max-w-xs">{l.title}</td><td>{l.vertical}</td>
                    <td><Badge status={l.stage}>{stageLabel(l.stage)}</Badge></td><td>{l.owner}</td>
                    <td className={overdue ? "font-medium text-rose-600" : ""}>{l.next_followup_at ? dt(l.next_followup_at) : "—"}</td>
                    <td className="num">{inrShort(l.est_value)}</td>
                  </tr>
                );
              })}
            </Table>
          ) : <Empty>No enquiries match the filters</Empty>}
        </Card>
      )}
    </div>
  );
}
