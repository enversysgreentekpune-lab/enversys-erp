import Link from "next/link";
import { requirePage, can } from "@/lib/auth";
import { q } from "@/lib/db";
import { woScope } from "@/lib/access";
import { inrShort, pct, num, label, dt } from "@/lib/format";
import { PageHeader, Card, Table, Badge, Progress, Empty } from "@/components/ui";
import { WO_TYPES } from "@/lib/workflow";

export const metadata = { title: "Work Orders" };
export default async function WorkOrders({ searchParams }: { searchParams: Promise<{ type?: string; status?: string; q?: string }> }) {
  const u = await requirePage("work_orders");
  const sp = await searchParams;
  const p: unknown[] = [];
  const w = [woScope(u, "view", p)];
  if (sp.type) { p.push(sp.type); w.push(`w.wo_type=$${p.length}`); }
  if (sp.status) { p.push(sp.status); w.push(`w.status=$${p.length}`); }
  if (sp.q) { p.push(`%${sp.q}%`); w.push(`(w.wo_no ilike $${p.length} or w.title ilike $${p.length} or c.name ilike $${p.length})`); }
  const rows = await q(`select w.*, c.name customer, (select string_agg(e.name, ', ') from wo_team t join employee e on e.id=t.employee_id where t.wo_id=w.id and t.team_role='PM') pm
    from v_wo_pnl w join customer c on c.id=w.customer_id where ${w.join(" and ")} order by w.created_at desc`, p);
  const fin = !!can(u, "costing", "view") || !!can(u, "finance", "view");
  const money = fin || !!can(u, "work_orders", "edit");
  return (
    <div>
      <PageHeader title="Work orders" subtitle="Every cost is booked against a WO — the master cost centre" actions={<a className="btn-secondary" href="/api/export/work-orders">Export Excel</a>} />
      <form className="card mb-4 flex flex-wrap gap-2 p-3">
        <input name="q" defaultValue={sp.q} placeholder="Search WO, title, customer" className="input max-w-xs" />
        <select name="type" defaultValue={sp.type ?? ""} className="input w-44"><option value="">All types</option>{WO_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</select>
        <select name="status" defaultValue={sp.status ?? ""} className="input w-40"><option value="">All statuses</option>{["KICKOFF", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CLOSED"].map((t) => <option key={t} value={t}>{label(t)}</option>)}</select>
        <button className="btn-secondary">Filter</button>
      </form>
      <Card bodyClass="p-0">
        {rows.length ? <Table head={["WO", "Type", "Customer", "PM", "Start → End", "Progress", ...(money ? ["Contract"] : []), ...(fin ? ["Budget", "Actual+Commit", "Est. margin"] : []), "Schedule", "Cost"]}>
          {rows.map((w) => (
            <tr key={w.id}>
              <td><Link className="link font-medium" href={`/work-orders/${w.id}`}>{w.wo_no}</Link><div className="max-w-[240px] text-xs text-slate-500">{w.title}</div>{w.has_fabrication && <Badge tone="purple">Markal</Badge>}</td>
              <td>{label(w.wo_type)}</td><td>{w.customer}</td><td>{w.pm ?? "—"}</td><td className="whitespace-nowrap text-xs">{dt(w.start_date)} → {dt(w.end_date)}</td>
              <td className="w-28"><div className="text-xs">{num(w.pct_complete)}% · <Badge status={w.status} /></div><Progress value={Number(w.pct_complete)} /></td>
              {money && <td className="num">{inrShort(w.contract_value)}</td>}
              {fin && <><td className="num">{inrShort(w.budget_cost)}</td><td className="num">{inrShort(Number(w.actual_cost) + Number(w.committed_cost))}<div className="text-xs text-slate-500">{w.consumed_pct}%</div></td><td className="num">{pct(w.est_margin_pct)}</td></>}
              <td><Badge status={w.schedule_rag} /></td><td><Badge status={w.cost_rag} /></td>
            </tr>
          ))}
        </Table> : <Empty>No work orders visible to you</Empty>}
      </Card>
    </div>
  );
}
