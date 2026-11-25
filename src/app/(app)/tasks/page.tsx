import Link from "next/link";
import { requireUser, can } from "@/lib/auth";
import { q } from "@/lib/db";
import { todayIST } from "@/lib/hr";
import { ensureDailyTasks, TASK_OPEN } from "@/lib/tasks";
import { dtm, label } from "@/lib/format";
import { PageHeader, Card, Table, Badge, Stat, Tabs, Empty } from "@/components/ui";
import { NewTaskForm } from "./NewTaskForm";
import { FIELD_ROLES } from "@/lib/rbac";

export const metadata = { title: "Tasks" };
type SP = { tab?: string; who?: string };

export default async function Tasks({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const today = todayIST();
  await ensureDailyTasks(today, u.id);
  const sc = can(u, "tasks", "view");
  const teamScope = sc === "company" ? null : sc === "team" ? [u.id, ...u.teamIds] : [u.id];
  const isMgr = sc === "team" || sc === "company";
  const tab = sp.tab ?? "mine";
  const monthStart = today.slice(0, 8) + "01";
  const [mine, k, team, people, wos, customers] = await Promise.all([
    q(`select t.*, c.name creator, a.name assignee from task t left join employee c on c.id=t.created_by left join employee a on a.id=t.assigned_to
       where cardinality($2::uuid[]) >= 0 is not false and cardinality($3::text[]) > 0 and ${tab === "byme" ? "t.created_by=$1 and t.assigned_to<>$1" : tab === "team" && isMgr ? "($2::uuid[] is null or t.assigned_to=any($2)) and t.assigned_to<>$1" : "t.assigned_to=$1"}
         and ${tab === "done" ? "t.status='DONE' and t.done_at > now() - interval '45 days'" : tab === "lapsed" ? "t.status = any($3) and t.due_at < now()" : "t.status = any($3)"}
       order by (t.due_at < now()) desc, t.due_at nulls last limit 300`, [u.id, teamScope, TASK_OPEN]),
    q(`select count(*)::int assigned, count(*) filter (where status='DONE')::int done, count(*) filter (where status = any($2) and (due_at is null or due_at >= now()))::int pending,
         count(*) filter (where status = any($2) and due_at < now())::int lapsed, count(*) filter (where kind='FIELD_SERVICE' and status='AWAITING_CLIENT')::int awaiting
       from task where assigned_to=$1 and status<>'CANCELLED' and (status = any($2) or coalesce(done_at, created_at) >= $3::date)`, [u.id, TASK_OPEN, monthStart]),
    isMgr ? q(`select e.id, e.name, count(t.*)::int assigned, count(t.*) filter (where t.status='DONE')::int done,
          count(t.*) filter (where t.status = any($2) and (t.due_at is null or t.due_at >= now()))::int pending, count(t.*) filter (where t.status = any($2) and t.due_at < now())::int lapsed,
          count(t.*) filter (where t.status='REPORT_SUBMITTED')::int to_approve
        from employee e left join task t on t.assigned_to=e.id and t.status<>'CANCELLED' and (t.status = any($2) or coalesce(t.done_at, t.created_at) >= $3::date)
        where e.is_active and e.id<>$4 and ($1::uuid[] is null or e.id=any($1)) group by e.id order by lapsed desc, e.name`, [teamScope, TASK_OPEN, monthStart, u.id]) : Promise.resolve([]),
    q(`select id, name from employee where is_active and ($1::uuid[] is null or id=any($1)) order by name`, [sc === "company" ? null : [u.id, ...u.teamIds]]),
    q(`select id, wo_no, title from work_order where status not in ('CLOSED','CANCELLED') order by wo_no`),
    q(`select id, name from customer order by name`),
  ]);
  const kk = k[0];
  const field = FIELD_ROLES.includes(u.roleCode);
  const toApprove = team.reduce((a, t) => a + t.to_approve, 0);
  const tabs = [{ key: "mine", label: "My open tasks" }, { key: "lapsed", label: "Lapsed" }, { key: "done", label: "Completed" }, ...(!field ? [{ key: "byme", label: "Assigned by me" }] : []), ...(isMgr ? [{ key: "team", label: `Team tasks${toApprove ? ` · ${toApprove} report(s) to approve` : ""}` }] : [])];
  return (
    <div>
      <PageHeader title={field ? "My tasks" : "Task management"} subtitle="Daily tasks appear automatically every working day. Complete each task with a short report and evidence." />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Assigned (this month + open)" value={kk.assigned} />
        <Stat label="Completed" value={kk.done} tone="green" href="/tasks?tab=done" />
        <Stat label="Pending" value={kk.pending} href="/tasks" />
        <Stat label="Lapsed (overdue)" value={kk.lapsed} tone={kk.lapsed ? "red" : undefined} href="/tasks?tab=lapsed" />
        <Stat label="Awaiting client OTP" value={kk.awaiting} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          <Tabs tabs={tabs} active={tab} base="/tasks" />
          {tab === "team" && isMgr && (
            <Card title="Team summary" bodyClass="p-0" className="mb-4">
              <Table head={["Employee", "Assigned", "Completed", "Pending", "Lapsed", "Reports to approve"]}>{team.map((t) => <tr key={t.id}><td>{t.name}</td><td className="num">{t.assigned}</td><td className="num">{t.done}</td><td className="num">{t.pending}</td><td className={`num ${t.lapsed ? "font-semibold text-rose-600" : ""}`}>{t.lapsed}</td><td className="num">{t.to_approve || ""}</td></tr>)}</Table>
            </Card>
          )}
          <Card bodyClass="p-0">
            {mine.length ? <Table head={["Task", "Type", tab === "byme" || tab === "team" ? "Assigned to" : "From", "Due", "Status"]}>
              {mine.map((t) => {
                const late = t.due_at && new Date(t.due_at) < new Date() && t.status !== "DONE";
                return <tr key={t.id}><td><Link className="link font-medium" href={`/tasks/${t.id}`}>{t.title}</Link>{t.client_name && <div className="text-xs text-slate-500">{t.client_name}{t.site_address && ` · ${t.site_address}`}</div>}</td>
                  <td><Badge tone={t.kind === "FIELD_SERVICE" ? "blue" : t.kind === "DAILY" ? "gray" : "purple"}>{label(t.kind)}</Badge></td>
                  <td className="text-xs">{tab === "byme" || tab === "team" ? t.assignee : t.creator ?? "—"}</td>
                  <td className={`whitespace-nowrap text-xs ${late ? "font-semibold text-rose-600" : ""}`}>{t.due_at ? dtm(t.due_at) : "—"}{late && " · lapsed"}</td>
                  <td><Badge status={t.status === "REPORT_SUBMITTED" || t.status === "AWAITING_CLIENT" ? "PENDING_APPROVAL" : t.status}>{label(t.status)}</Badge></td></tr>;
              })}
            </Table> : <Empty>No tasks here</Empty>}
          </Card>
        </div>
        <Card title="New task"><NewTaskForm people={people} me={u.id} wos={wos} customers={customers} canDaily={!field} /></Card>
      </div>
    </div>
  );
}
