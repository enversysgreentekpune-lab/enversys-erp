import Link from "next/link";
import { requireUser, can } from "@/lib/auth";
import { q, one } from "@/lib/db";
import { todayIST, leaveBalances } from "@/lib/hr";
import { fyStartYear } from "@/lib/period";
import { dt, dtm, num, pct, inrShort } from "@/lib/format";
import { PageHeader, Card, Badge, Stat, Table, Empty } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { CheckIn } from "./CheckIn";
import { DwrForm } from "./DwrForm";
import { leaveAction, taskStatusAction, decideLeaveAction, createTaskAction } from "@/app/actions/me";

export const metadata = { title: "My Dashboard" };

export default async function Me({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const u = await requireUser();
  const { view } = await searchParams;
  const today = todayIST();
  const month = today.slice(0, 7);
  const fyFrom = `${fyStartYear(new Date(today))}-04-01`;
  const [att, tasks, monthAtt, wos, dwr, balances, myLeaves, notes, teamLeaves, teamAtt, kpi] = await Promise.all([
    one(`select a.*, l.name loc from attendance a left join location l on l.id=a.location_id where employee_id=$1 and att_date=$2`, [u.id, today]),
    q(`select * from task where assigned_to=$1 and status in ('TODO','IN_PROGRESS','DONE') and (status<>'DONE' or done_at > now() - interval '3 days') order by (due_at is null), due_at`, [u.id]),
    q(`select att_date, status, is_late, ot_hours from attendance where employee_id=$1 and to_char(att_date,'YYYY-MM')=$2 order by att_date`, [u.id, month]),
    q(`select w.id, w.wo_no, w.title from work_order w where w.status not in ('CLOSED','CANCELLED') and (exists (select 1 from wo_team t where t.wo_id=w.id and t.employee_id=$1) or $2) order by w.wo_no`, [u.id, can(u, "work_orders", "view") === "company"]),
    one(`select d.*, coalesce(json_agg(json_build_object('wo_id', l.wo_id, 'hours', l.hours, 'description', l.description)) filter (where l.id is not null), '[]') lines from dwr d left join dwr_line l on l.dwr_id=d.id where d.employee_id=$1 and d.report_date=$2 group by d.id`, [u.id, today]),
    leaveBalances(u.id, fyFrom),
    q(`select * from leave_request where employee_id=$1 order by created_at desc limit 5`, [u.id]),
    q(`select * from notification where employee_id=$1 order by created_at desc limit 6`, [u.id]),
    q(`select lr.*, e.name from leave_request lr join employee e on e.id=lr.employee_id where lr.status='PENDING' and lr.approver_id=$1`, [u.id]),
    u.teamIds.length ? q(`select e.id, e.name, a.status, a.check_in, a.is_late, (select count(*) from dwr d where d.employee_id=e.id and d.report_date=$2)::int dwr
        from employee e left join attendance a on a.employee_id=e.id and a.att_date=$2 where e.id = any($1) and e.is_active order by e.name`, [u.teamIds, today]) : Promise.resolve([]),
    one(`select (select count(*) from task where assigned_to=$1 and status='DONE' and done_at::date <= due_at::date and done_at > now() - interval '30 days')::int on_time,
          (select count(*) from task where assigned_to=$1 and status='DONE' and done_at > now() - interval '30 days')::int done,
          (select count(*) from task where assigned_to=$1 and status in ('TODO','IN_PROGRESS') and due_at < now())::int overdue,
          (select count(*) from lead where assigned_to=$1 and stage='WON' and stage_changed_at > now() - interval '365 days')::int won,
          (select count(*) from lead where assigned_to=$1 and stage in ('WON','LOST') and stage_changed_at > now() - interval '365 days')::int closed,
          (select coalesce(sum(hours),0) from dwr_line l join dwr d on d.id=l.dwr_id where d.employee_id=$1 and d.report_date > current_date - 30) hours30,
          (select count(*) from dwr where employee_id=$1 and report_date > current_date - 30)::int dwr30`, [u.id]),
  ]);
  const open = tasks.filter((t) => t.status !== "DONE");
  const cols = [["TODO", "To do"], ["IN_PROGRESS", "In progress"], ["DONE", "Done (3 days)"]] as const;
  const board = view !== "list";
  const present = monthAtt.filter((a) => ["P", "HD", "OD"].includes(a.status)).length;
  return (
    <div>
      <PageHeader title={`Hello, ${u.name.split(" ")[0]}`} subtitle={`${u.roleName}${u.verticalName ? " · " + u.verticalName : ""} · ${dt(today)}`} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <Stat label="Open tasks" value={open.length} sub={kpi!.overdue ? <span className="text-rose-600">{kpi!.overdue} overdue</span> : "none overdue"} />
        <Stat label="On-time closure (30 d)" value={kpi!.done ? pct((kpi!.on_time / kpi!.done) * 100, 0) : "—"} />
        <Stat label="Present this month" value={`${present} d`} sub={`${monthAtt.filter((a) => a.is_late).length} late marks`} />
        <Stat label="Hours booked (30 d)" value={num(kpi!.hours30, 1)} sub={`${kpi!.dwr30} DWRs`} />
        {can(u, "leads", "create") ? <Stat label="Leads won (12 m)" value={kpi!.won} sub={kpi!.closed ? `hit ratio ${pct((kpi!.won / kpi!.closed) * 100, 0)}` : ""} /> : <Stat label="Leave balance (PL)" value={(() => { const b = balances.find((x) => x.code === "PL"); return b ? num(b.annual_quota - b.used, 1) : "—"; })()} />}
        <Stat label="Pending approvals" value={teamLeaves.length} href="/approvals" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="My tasks" actions={<div className="flex gap-1 text-xs"><Link className={board ? "font-semibold" : "link"} href="/me">Board</Link>·<Link className={!board ? "font-semibold" : "link"} href="/me?view=list">List</Link></div>}>
            {board ? (
              <div className="grid gap-3 md:grid-cols-3">
                {cols.map(([st, title]) => (
                  <div key={st} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/40">
                    <div className="mb-2 text-xs font-semibold uppercase text-slate-500">{title} ({tasks.filter((t) => t.status === st).length})</div>
                    <div className="space-y-2">
                      {tasks.filter((t) => t.status === st).map((t) => <TaskCard key={t.id} t={t} />)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Table head={["Task", "Due", "Priority", "Status", ""]}>
                {tasks.map((t) => <tr key={t.id}><td>{t.link ? <Link className="link" href={t.link}>{t.title}</Link> : t.title}</td><td className={t.due_at && new Date(t.due_at) < new Date() && t.status !== "DONE" ? "text-rose-600" : ""}>{dtm(t.due_at)}</td><td><Badge status={t.priority} /></td><td><Badge status={t.status} /></td><td><TaskMove t={t} /></td></tr>)}
              </Table>
            )}
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-brand-600">+ New task</summary>
              <ActionForm action={createTaskAction} reset submitLabel="Create task" className="mt-2 grid gap-2 sm:grid-cols-4">
                <input name="title" required placeholder="Task title" className="input sm:col-span-2" />
                <input name="due" type="datetime-local" className="input" />
                <select name="priority" className="input" defaultValue="MEDIUM">{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((p) => <option key={p}>{p}</option>)}</select>
                {u.teamIds.length > 0 && <TeamSelect ids={u.teamIds} />}
              </ActionForm>
            </details>
          </Card>

          <Card title={`Daily Work Report — ${dt(today)}`} actions={dwr ? <Badge status="DONE">Submitted</Badge> : <Badge status="PENDING">Pending</Badge>}>
            <DwrForm wos={wos} today={today} existing={dwr ? { summary: dwr.summary, issues: dwr.issues ?? "", lines: dwr.lines } : undefined} />
            <p className="mt-2 text-[11px] text-slate-500">Hours booked against a WO are costed at your labour rate and posted to that WO&apos;s cost ledger.</p>
          </Card>

          {u.teamIds.length > 0 && (
            <Card title="My team today" bodyClass="p-0">
              <Table head={["Member", "Attendance", "In", "DWR"]}>
                {teamAtt.map((m) => <tr key={m.id}><td>{m.name}</td><td>{m.status ? <Badge status={m.status} /> : <Badge tone="red">Not marked</Badge>}{m.is_late && <span className="ml-1 text-xs text-amber-600">late</span>}</td><td>{m.check_in ? dtm(m.check_in) : "—"}</td><td>{m.dwr ? <Badge status="DONE">Submitted</Badge> : <Badge status="PENDING">Pending</Badge>}</td></tr>)}
              </Table>
            </Card>
          )}
        </div>

        <div className="order-first space-y-4 lg:order-none">
          <Card title="Attendance"><CheckIn checkedIn={!!att?.check_in} checkedOut={!!att?.check_out} inTime={att?.check_in ? new Date(att.check_in).toLocaleTimeString("en-IN", { timeStyle: "short", timeZone: "Asia/Kolkata" }) : undefined} outTime={att?.check_out ? new Date(att.check_out).toLocaleTimeString("en-IN", { timeStyle: "short", timeZone: "Asia/Kolkata" }) : undefined} loc={att?.loc} />
            <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[10px]">
              {monthAtt.map((a) => <div key={a.att_date} title={`${a.att_date}: ${a.status}`} className={`rounded py-1 ${a.status === "P" ? (a.is_late ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800") : a.status === "A" ? "bg-rose-100 text-rose-800" : a.status === "L" ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-500"} dark:bg-opacity-20`}>{a.att_date.slice(8)}<br />{a.status}</div>)}
            </div>
          </Card>
          {teamLeaves.length > 0 && (
            <Card title="Leave approvals" id="approvals">
              {teamLeaves.map((l) => (
                <div key={l.id} className="mb-2 rounded-lg border border-slate-200 p-2 text-sm dark:border-slate-800">
                  <b>{l.name}</b> · {l.leave_type} · {dt(l.from_date)} → {dt(l.to_date)} ({l.days} d)<div className="text-xs text-slate-500">{l.reason}</div>
                  <div className="mt-1 flex gap-2">
                    <ActionForm action={decideLeaveAction} hideSubmit><input type="hidden" name="id" value={l.id} /><input type="hidden" name="decision" value="APPROVE" /><button className="btn-primary btn-sm">Approve</button></ActionForm>
                    <ActionForm action={decideLeaveAction} hideSubmit><input type="hidden" name="id" value={l.id} /><input type="hidden" name="decision" value="REJECT" /><button className="btn-secondary btn-sm">Reject</button></ActionForm>
                  </div>
                </div>
              ))}
            </Card>
          )}
          <Card title="Leave">
            <div className="mb-3 grid grid-cols-3 gap-2 text-center text-xs">
              {balances.filter((b) => b.annual_quota > 0).map((b) => <div key={b.code} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/40"><div className="text-slate-500">{b.code}</div><div className="text-base font-semibold">{num(b.annual_quota - b.used, 1)}</div><div className="text-[10px] text-slate-400">of {b.annual_quota}</div></div>)}
            </div>
            <ActionForm action={leaveAction} reset submitLabel="Apply leave" className="grid grid-cols-2 gap-2">
              <select name="type" className="input col-span-2">{balances.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}<option value="CO">On duty / work from site → use OD in Time Office</option></select>
              <input type="date" name="from" required className="input" /><input type="date" name="to" required className="input" />
              <input name="reason" placeholder="Reason" className="input col-span-2" />
            </ActionForm>
            {myLeaves.length > 0 && <ul className="mt-3 space-y-1 text-xs">{myLeaves.map((l) => <li key={l.id} className="flex justify-between"><span>{l.leave_type} {dt(l.from_date)} → {dt(l.to_date)}</span><Badge status={l.status} /></li>)}</ul>}
          </Card>
          <Card title="Notifications" actions={<Link href="/notifications" className="link text-xs">All</Link>}>
            {notes.length ? <ul className="space-y-2 text-sm">{notes.map((n) => <li key={n.id} className={n.read_at ? "text-slate-500" : ""}><Link href={n.link ?? "#"} className="hover:underline"><b className="font-medium">{n.title}</b> — {n.body}</Link><div className="text-[11px] text-slate-400">{dtm(n.created_at)}</div></li>)}</ul> : <Empty>No notifications</Empty>}
          </Card>
          <Card title="My documents"><p className="text-sm text-slate-500">Payslips, offer letter, ID card and policies appear here once HR payroll goes live (Phase 3).</p><Link href="/profile" className="link text-sm">Profile, devices & quick-login PIN →</Link></Card>
        </div>
      </div>
    </div>
  );
}

function TaskCard({ t }: { t: any }) {
  const overdue = t.due_at && new Date(t.due_at) < new Date() && t.status !== "DONE";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="font-medium">{t.link ? <Link href={t.link} className="hover:underline">{t.title}</Link> : t.title}</div>
      <div className="mt-1 flex items-center justify-between gap-1 text-[11px]">
        <span className={overdue ? "font-semibold text-rose-600" : "text-slate-500"}>{t.due_at ? dtm(t.due_at) : "No due date"}{t.escalation_level > 0 && " · escalated"}</span>
        <Badge status={t.priority} />
      </div>
      <TaskMove t={t} />
    </div>
  );
}
function TaskMove({ t }: { t: any }) {
  const next = t.status === "TODO" ? [["IN_PROGRESS", "Start"], ["DONE", "Done"]] : t.status === "IN_PROGRESS" ? [["DONE", "Done"], ["TODO", "Back"]] : [["TODO", "Reopen"]];
  return (
    <div className="mt-1 flex gap-1">
      {next.map(([st, l]) => (
        <ActionForm key={st} action={taskStatusAction} hideSubmit><input type="hidden" name="id" value={t.id} /><input type="hidden" name="status" value={st} /><button className="btn-ghost btn-sm">{l}</button></ActionForm>
      ))}
    </div>
  );
}
async function TeamSelect({ ids }: { ids: string[] }) {
  const team = await q(`select id, name from employee where id = any($1) order by name`, [ids]);
  return <select name="assigned_to" className="input sm:col-span-2"><option value="">Assign to me</option>{team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>;
}
