import Link from "next/link";
import { requirePage, can } from "@/lib/auth";
import { q } from "@/lib/db";
import { dt, num } from "@/lib/format";
import { PageHeader, Card, Table, Badge, Stat, Empty, Progress } from "@/components/ui";
import { IC_STAGE_LABEL } from "@/lib/ic";

export const metadata = { title: "Installation & Commissioning" };
const STATUS_LABEL: Record<string, string> = { NOT_STARTED: "Not started", IN_PROGRESS: "In progress", HANDOVER_PENDING: "Handover pending", COMPLETED: "Completed" };

export default async function IcList({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const u = await requirePage("field_services");
  const sp = await searchParams;
  const all = can(u, "field_services", "view") === "company" || can(u, "inspection", "view") === "company";
  const rows = await q(`select ic.*, w.wo_no, w.title, c.name customer, e.name engineer,
      (select count(*)::int from dispatch d where d.wo_id=w.id) dispatches, (select count(*)::int from dispatch d where d.wo_id=w.id and d.status='DELIVERED') delivered,
      (select max(update_date) from ic_update x where x.ic_id=ic.id) last_update,
      (select count(*)::int from ic_update x where x.ic_id=ic.id and x.client_signed) signed_reports
    from ic_project ic join work_order w on w.id=ic.wo_id join customer c on c.id=w.customer_id left join employee e on e.id=ic.engineer_id
    where ($1 or ic.engineer_id=$2 or exists (select 1 from wo_team t where t.wo_id=w.id and t.employee_id=$2))
    order by case ic.status when 'IN_PROGRESS' then 0 when 'HANDOVER_PENDING' then 1 when 'NOT_STARTED' then 2 else 3 end, w.wo_no`, [all, u.id]);
  const by = (s: string) => rows.filter((r) => r.status === s).length;
  const shown = sp.status ? rows.filter((r) => r.status === sp.status) : rows;
  return (
    <div>
      <PageHeader title="Installation & Commissioning (I&C)" subtitle="Every dispatched project appears here automatically. Update progress with evidence and client-signed reports, generate the handover documents, and close the project with the signed handover and appreciation certificates." />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Projects in I&C" value={rows.length} href="/ic" />
        <Stat label="Not started" value={by("NOT_STARTED")} href="/ic?status=NOT_STARTED" />
        <Stat label="In progress" value={by("IN_PROGRESS")} tone={by("IN_PROGRESS") ? "amber" : undefined} href="/ic?status=IN_PROGRESS" />
        <Stat label="Handover pending" value={by("HANDOVER_PENDING")} sub="awaiting signed certificates" href="/ic?status=HANDOVER_PENDING" />
        <Stat label="Completed" value={by("COMPLETED")} tone="green" sub="handover + appreciation signed" href="/ic?status=COMPLETED" />
      </div>
      <Card bodyClass="p-0">
        {shown.length ? (
          <Table head={["Project code", "Client", "Dispatch", "Stage", "Progress", "I&C engineer", "Last update", "Client-signed reports", "Handover", "Status"]}>
            {shown.map((r) => (
              <tr key={r.id}>
                <td><Link className="link font-medium" href={`/ic/${r.id}`}>{r.wo_no}</Link><div className="max-w-[240px] truncate text-xs text-slate-500">{r.title}</div></td>
                <td>{r.customer}</td>
                <td className="text-xs">{r.dispatches} dispatch{r.dispatches === 1 ? "" : "es"}<div className="text-slate-500">{r.delivered} delivered</div></td>
                <td className="text-xs">{IC_STAGE_LABEL[r.stage] ?? r.stage}</td>
                <td className="w-32"><div className="text-xs">{num(r.pct)}%</div><Progress value={Number(r.pct)} tone={Number(r.pct) >= 100 ? "green" : undefined} /></td>
                <td className="text-xs">{r.engineer ?? <span className="text-amber-700">Not assigned</span>}</td>
                <td className="text-xs">{r.last_update ? dt(r.last_update) : "—"}</td>
                <td className="num">{r.signed_reports}</td>
                <td className="text-xs">{r.status === "COMPLETED" ? "Signed ✓" : r.docs_sent_at ? `Sent ${dt(r.docs_sent_at)} · ${(r.handover_signed_id ? 1 : 0) + (r.appreciation_signed_id ? 1 : 0)}/2 signed` : r.docs_generated_at ? "Generated, not sent" : "—"}</td>
                <td><Badge status={r.status}>{STATUS_LABEL[r.status]}</Badge></td>
              </tr>
            ))}
          </Table>
        ) : <Empty>No projects in I&C yet. A project appears here as soon as its first dispatch is made.</Empty>}
      </Card>
    </div>
  );
}
