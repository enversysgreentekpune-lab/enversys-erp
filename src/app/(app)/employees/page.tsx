import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, can } from "@/lib/auth";
import { q } from "@/lib/db";
import { todayIST } from "@/lib/hr";
import { dt, dtm, num } from "@/lib/format";
import { PageHeader, Card, Table, Badge, Stat, Tabs, Empty } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { EmployeeMap } from "@/components/EmployeeMap";
import { decideLeaveAction } from "@/app/actions/me";

export const metadata = { title: "Employees" };

export default async function Employees({ searchParams }: { searchParams: Promise<{ tab?: string; date?: string; month?: string }> }) {
  const u = await requireUser();
  const sc = can(u, "attendance", "view") === "company" || can(u, "hr", "view") === "company" ? "company" : can(u, "attendance", "view") === "team" || can(u, "hr", "view") === "team" ? "team" : null;
  if (!sc) redirect("/forbidden");
  const sp = await searchParams;
  const date = sp.date ?? todayIST(), month = sp.month ?? date.slice(0, 7), tab = sp.tab ?? "today";
  const ids = sc === "company" ? null : [u.id, ...u.teamIds];
  const [daily, byLoc, monthly, points, sites, leaves] = await Promise.all([
    q(`select e.id, e.emp_code, e.name, l.name loc, l.kind, d.name dept, m.name mgr, a.status, a.check_in, a.check_out, a.is_late, a.ot_hours, a.source
       from employee e join location l on l.id=e.location_id left join department d on d.id=e.department_id left join employee m on m.id=e.manager_id
       left join attendance a on a.employee_id=e.id and a.att_date=$1 where e.is_active and ($2::uuid[] is null or e.id=any($2)) order by l.kind, e.name`, [date, ids]),
    q(`select l.name loc, l.kind, count(*)::int total, count(a.*) filter (where a.status in ('P','HD','OD'))::int present, count(a.*) filter (where a.status='A')::int absent,
         count(a.*) filter (where a.status='L')::int leave, count(a.*) filter (where a.is_late)::int late, count(*) filter (where a.status is null)::int unmarked
       from employee e join location l on l.id=e.location_id left join attendance a on a.employee_id=e.id and a.att_date=$1 where e.is_active and ($2::uuid[] is null or e.id=any($2)) group by 1,2 order by 2,1`, [date, ids]),
    q(`select e.id, e.emp_code, e.name, l.name loc, count(*) filter (where a.status='P')::int p, count(*) filter (where a.status='HD')::int hd, count(*) filter (where a.status='OD')::int od,
         count(*) filter (where a.status='A')::int a, count(*) filter (where a.status='L')::int lv, count(*) filter (where a.status in ('WO','H'))::int off,
         count(*) filter (where a.is_late)::int late, coalesce(sum(a.ot_hours),0) ot
       from employee e join location l on l.id=e.location_id left join attendance a on a.employee_id=e.id and to_char(a.att_date,'YYYY-MM')=$1
       where e.is_active and ($2::uuid[] is null or e.id=any($2)) group by e.id, l.name order by l.name, e.name`, [month, ids]),
    q(`select e.id, e.name, el.lat::float lat, el.lng::float lng, el.at, el.source, l.name loc from employee_location el join employee e on e.id=el.employee_id left join location l on l.id=e.location_id
       where e.is_active and ($1::uuid[] is null or e.id=any($1)) order by el.at desc`, [ids]),
    q(`select name, lat::float lat, lng::float lng, geofence_m r from location where is_active and lat is not null`),
    q(`select lr.*, e.name, m.name approver from leave_request lr join employee e on e.id=lr.employee_id left join employee m on m.id=lr.approver_id
       where ($1::uuid[] is null or lr.employee_id=any($1)) order by (lr.status='PENDING') desc, lr.created_at desc limit 100`, [ids]),
  ]);
  const c = (f: (r: any) => boolean) => daily.filter(f).length;
  const tabs = [{ key: "today", label: "Daily attendance" }, { key: "monthly", label: "Monthly breakdown" }, { key: "map", label: `Live location (${points.length})` }, { key: "leave", label: `Leave (${leaves.filter((l) => l.status === "PENDING").length} pending)` }];
  const base = `/employees?date=${date}`;
  const isHr = can(u, "hr", "approve") === "company";
  return (
    <div>
      <PageHeader title="Employee management" subtitle={`${sc === "company" ? "All employees" : "My team"} · attendance, location, time office and leave`} actions={<Link href="/attendance" className="btn-secondary">Time office →</Link>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Employees" value={daily.length} />
        <Stat label="Present" value={c((r) => ["P", "HD", "OD"].includes(r.status))} tone="green" />
        <Stat label="Absent" value={c((r) => r.status === "A")} tone="red" />
        <Stat label="On leave" value={c((r) => r.status === "L")} />
        <Stat label="Not marked" value={c((r) => !r.status)} tone="amber" />
        <Stat label="Late" value={c((r) => r.is_late)} />
        <Stat label="Field / site" value={c((r) => r.kind === "SITE")} sub="based at project sites" />
      </div>
      <Tabs tabs={tabs} active={tab} base={base} />
      {tab === "today" && (
        <div className="space-y-4">
          <form className="flex gap-2"><input type="hidden" name="tab" value="today" /><input type="date" name="date" defaultValue={date} className="input w-44" /><button className="btn-secondary">Show</button></form>
          <Card title={`Bifurcation by location — ${dt(date)}`} bodyClass="p-0">
            <Table head={["Location", "Employees", "Present", "Absent", "Leave", "Late", "Not marked"]}>{byLoc.map((l) => <tr key={l.loc}><td>{l.loc}</td><td className="num">{l.total}</td><td className="num">{l.present}</td><td className="num">{l.absent}</td><td className="num">{l.leave}</td><td className="num">{l.late}</td><td className="num">{l.unmarked}</td></tr>)}</Table>
          </Card>
          <Card title="Employee-wise" bodyClass="p-0">
            <Table head={["Code", "Employee", "Location", "Department", "Manager", "Status", "In", "Out", "OT h", "Source"]}>
              {daily.map((r) => <tr key={r.id}><td className="text-xs">{r.emp_code}</td><td>{r.name}</td><td className="text-xs">{r.loc}</td><td className="text-xs">{r.dept}</td><td className="text-xs">{r.mgr}</td>
                <td>{r.status ? <Badge status={r.status} /> : <Badge tone="amber">—</Badge>}{r.is_late && <span className="ml-1 text-xs text-amber-600">late</span>}</td>
                <td className="text-xs">{r.check_in ? new Date(r.check_in).toLocaleTimeString("en-IN", { timeStyle: "short", timeZone: "Asia/Kolkata" }) : "—"}</td><td className="text-xs">{r.check_out ? new Date(r.check_out).toLocaleTimeString("en-IN", { timeStyle: "short", timeZone: "Asia/Kolkata" }) : "—"}</td>
                <td className="num">{Number(r.ot_hours) || ""}</td><td className="text-xs">{r.source ?? ""}</td></tr>)}
            </Table>
          </Card>
        </div>
      )}
      {tab === "monthly" && (
        <div className="space-y-3">
          <form className="flex gap-2"><input type="hidden" name="tab" value="monthly" /><input type="month" name="month" defaultValue={month} className="input w-44" /><button className="btn-secondary">Show</button><a className="btn-ghost" href={`/api/export/attendance?month=${month}`}>Export (.xlsx)</a></form>
          <Card bodyClass="p-0">
            <Table head={["Code", "Employee", "Location", "Present", "Half day", "On duty", "Absent", "Leave", "Off / holiday", "Late", "OT h", "Attendance %"]}>
              {monthly.map((r) => { const work = r.p + r.hd + r.od + r.a + r.lv; return <tr key={r.id}><td className="text-xs">{r.emp_code}</td><td>{r.name}</td><td className="text-xs">{r.loc}</td><td className="num">{r.p}</td><td className="num">{r.hd}</td><td className="num">{r.od}</td><td className="num">{r.a}</td><td className="num">{r.lv}</td><td className="num">{r.off}</td><td className="num">{r.late}</td><td className="num">{num(r.ot, 1)}</td><td className="num">{work ? `${Math.round(((r.p + r.hd * 0.5 + r.od) / work) * 100)}%` : "—"}</td></tr>; })}
            </Table>
          </Card>
        </div>
      )}
      {tab === "map" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Card title="Current location of employees (last check-in, check-out or app login)"><EmployeeMap points={points} sites={sites} /></Card>
          <Card title="Last known positions" bodyClass="p-0">
            {points.length ? <Table head={["Employee", "When", "From", ""]}>{points.map((p) => <tr key={p.id}><td>{p.name}<div className="text-xs text-slate-500">{p.loc}</div></td><td className="text-xs">{dtm(p.at)}</td><td className="text-xs">{p.source.replace("_", " ").toLowerCase()}</td>
              <td><a className="link text-xs" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${p.lat},${p.lng}`}>Google Maps ↗</a></td></tr>)}</Table> : <Empty>No locations shared yet. Locations come from geo check-in/out and from the app when an employee logs in and allows location.</Empty>}
          </Card>
        </div>
      )}
      {tab === "leave" && (
        <Card bodyClass="p-0">
          {leaves.length ? <Table head={["Employee", "Type", "From", "To", "Days", "Reason", "Approver", "Status", ""]}>
            {leaves.map((l) => <tr key={l.id}><td>{l.name}</td><td>{l.leave_type}</td><td>{dt(l.from_date)}</td><td>{dt(l.to_date)}</td><td className="num">{l.days}</td><td className="text-xs">{l.reason}</td><td className="text-xs">{l.approver}</td><td><Badge status={l.status} /></td>
              <td>{l.status === "PENDING" && (l.approver_id === u.id || isHr) && <ActionForm action={decideLeaveAction} hideSubmit className="flex gap-1"><input type="hidden" name="id" value={l.id} /><button name="decision" value="APPROVE" className="btn-primary btn-sm">Approve</button><button name="decision" value="REJECT" className="btn-secondary btn-sm">Reject</button></ActionForm>}</td></tr>)}
          </Table> : <Empty>No leave requests</Empty>}
        </Card>
      )}
    </div>
  );
}
