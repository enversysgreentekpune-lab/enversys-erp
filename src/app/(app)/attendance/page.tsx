import { requirePage, can } from "@/lib/auth";
import { q } from "@/lib/db";
import { todayIST } from "@/lib/hr";
import { dt, dtm, num, label } from "@/lib/format";
import { PageHeader, Card, Table, Badge, Stat, Field, Tabs, Empty } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { markAttendanceAction, importBiometricAction, lockMonthAction } from "@/app/actions/attendance";

export const metadata = { title: "Time Office" };
type SP = { date?: string; loc?: string; tab?: string; month?: string };

export default async function Attendance({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await requirePage("attendance");
  const sp = await searchParams;
  const date = sp.date ?? todayIST();
  const month = sp.month ?? date.slice(0, 7);
  const tab = sp.tab ?? "muster";
  const sc = can(u, "attendance", "view")!;
  const scopeIds = sc === "company" ? null : [u.id, ...u.teamIds];
  const locs = await q(`select * from location where is_active order by kind, name`);
  const p: unknown[] = [date, scopeIds, sp.loc ?? null];
  const muster = await q(`select e.id, e.emp_code, e.name, l.name loc, l.kind, d.name dept, a.status, a.check_in, a.check_out, a.is_late, a.ot_hours, a.source, a.in_distance_m, a.remarks, a.locked
    from employee e join location l on l.id=e.location_id left join department d on d.id=e.department_id left join attendance a on a.employee_id=e.id and a.att_date=$1
    where e.is_active and ($2::uuid[] is null or e.id = any($2)) and ($3::uuid is null or e.location_id=$3) order by l.kind, l.name, e.name`, p);
  const cnt = (f: (r: any) => boolean) => muster.filter(f).length;
  const locked = (await q(`select month from attendance_lock order by month desc limit 6`)).map((r) => r.month);
  const base = `/attendance?date=${date}${sp.loc ? `&loc=${sp.loc}` : ""}`;
  const tabs = [{ key: "muster", label: "Daily muster roll" }, { key: "late", label: "Late comers" }, { key: "ot", label: "OT register" }, { key: "monthly", label: "Monthly summary" }, { key: "manhours", label: "Man-hours per WO" }];
  const edit = !!can(u, "attendance", "edit");
  return (
    <div>
      <PageHeader title="Time office & attendance" subtitle={`${dt(date)} · ${sc === "company" ? "All locations" : "My team"}`} />
      <form className="card mb-4 flex flex-wrap items-end gap-2 p-3">
        <Field label="Date"><input type="date" name="date" defaultValue={date} className="input" /></Field>
        <Field label="Muster roll"><select name="loc" defaultValue={sp.loc ?? ""} className="input w-56"><option value="">All (HO, Markal, sites)</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
        <input type="hidden" name="tab" value={tab} /><button className="btn-secondary">Show</button>
        <a className="btn-ghost ml-auto" href={`/api/export/attendance?month=${month}`}>Export month (.xlsx)</a>
      </form>
      <div className="mb-4 grid grid-cols-3 gap-3 md:grid-cols-6">
        <Stat label="Employees" value={muster.length} /><Stat label="Present" value={cnt((r) => ["P", "HD", "OD"].includes(r.status))} tone="green" />
        <Stat label="Absent" value={cnt((r) => r.status === "A")} tone="red" /><Stat label="Not marked" value={cnt((r) => !r.status)} tone="amber" />
        <Stat label="Leave" value={cnt((r) => r.status === "L")} /><Stat label="Late" value={cnt((r) => r.is_late)} />
      </div>
      <Tabs tabs={tabs} active={tab} base={base} />
      {tab === "muster" && (
        <Card bodyClass="p-0">
          <Table head={["Code", "Employee", "Location", "Dept", "Status", "In", "Out", "OT h", "Source", "Remarks"]}>
            {muster.map((r) => <tr key={r.id}><td className="text-xs">{r.emp_code}</td><td>{r.name}</td><td className="text-xs">{r.loc}</td><td className="text-xs">{r.dept}</td><td>{r.status ? <Badge status={r.status} /> : <Badge tone="amber">—</Badge>}{r.is_late && <span className="ml-1 text-xs text-amber-600">late</span>}{r.locked && " 🔒"}</td>
              <td>{r.check_in ? new Date(r.check_in).toLocaleTimeString("en-IN", { timeStyle: "short", timeZone: "Asia/Kolkata" }) : "—"}</td><td>{r.check_out ? new Date(r.check_out).toLocaleTimeString("en-IN", { timeStyle: "short", timeZone: "Asia/Kolkata" }) : "—"}</td>
              <td className="num">{Number(r.ot_hours) || ""}</td><td className="text-xs">{r.source}{r.in_distance_m != null && ` · ${r.in_distance_m} m`}</td><td className="text-xs">{r.remarks}</td></tr>)}
          </Table>
        </Card>
      )}
      {tab === "late" && <Report sql={`select e.name, l.name loc, count(*)::int n, string_agg(to_char(a.att_date,'DD'), ', ' order by a.att_date) days from attendance a join employee e on e.id=a.employee_id join location l on l.id=e.location_id where a.is_late and to_char(a.att_date,'YYYY-MM')=$1 and ($2::uuid[] is null or e.id=any($2)) group by 1,2 order by 3 desc`} params={[month, scopeIds]} head={["Employee", "Location", "Late marks", "Dates"]} cols={["name", "loc", "n", "days"]} title={`Late comers — ${month}`} />}
      {tab === "ot" && <Report sql={`select e.name, l.name loc, sum(a.ot_hours) h, round(sum(a.ot_hours * e.hourly_cost * 2)) cost from attendance a join employee e on e.id=a.employee_id join location l on l.id=e.location_id where a.ot_hours>0 and to_char(a.att_date,'YYYY-MM')=$1 and ($2::uuid[] is null or e.id=any($2)) group by 1,2 order by 3 desc`} params={[month, scopeIds]} head={["Employee", "Location", "OT hours", "OT cost @2x (₹)"]} cols={["name", "loc", "h", "cost"]} title={`OT register — ${month}`} />}
      {tab === "monthly" && <Report sql={`select e.emp_code, e.name, l.name loc, count(*) filter (where status='P')::int p, count(*) filter (where status='HD')::int hd, count(*) filter (where status='A')::int a, count(*) filter (where status='L')::int lv, count(*) filter (where status in ('WO','H'))::int off, count(*) filter (where is_late)::int late, coalesce(sum(ot_hours),0) ot from employee e join location l on l.id=e.location_id left join attendance a on a.employee_id=e.id and to_char(a.att_date,'YYYY-MM')=$1 where e.is_active and ($2::uuid[] is null or e.id=any($2)) group by 1,2,3 order by 3,2`} params={[month, scopeIds]} head={["Code", "Employee", "Location", "P", "HD", "A", "Leave", "WO/H", "Late", "OT h"]} cols={["emp_code", "name", "loc", "p", "hd", "a", "lv", "off", "late", "ot"]} title={`Monthly summary (payroll input) — ${month}`} />}
      {tab === "manhours" && <Report sql={`select w.wo_no, w.title, d2.name dept, sum(dl.hours) h from dwr_line dl join dwr d on d.id=dl.dwr_id join work_order w on w.id=dl.wo_id join employee e on e.id=d.employee_id left join department d2 on d2.id=e.department_id where to_char(d.report_date,'YYYY-MM')=$1 and ($2::uuid[] is null or e.id=any($2)) group by 1,2,3 order by 1, 4 desc`} params={[month, scopeIds]} head={["WO", "Title", "Department", "Man-hours"]} cols={["wo_no", "title", "dept", "h"]} title={`Man-hours per WO / department — ${month}`} />}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {edit && (
          <Card title="Manual entry / correction">
            <ActionForm action={markAttendanceAction} className="grid grid-cols-2 gap-2">
              <select name="employee_id" required className="input col-span-2">{muster.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.emp_code})</option>)}</select>
              <input type="date" name="date" defaultValue={date} className="input" />
              <select name="status" className="input">{[["P", "Present"], ["A", "Absent"], ["HD", "Half day"], ["L", "Leave"], ["OD", "On duty / site deputation"], ["WO", "Weekly off"], ["H", "Holiday"]].map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <input type="time" name="in" className="input" aria-label="In time" /><input type="time" name="out" className="input" aria-label="Out time" />
              <select name="location_id" className="input">{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
              <input name="ot" placeholder="OT hours" className="input" />
              <label className="text-sm"><input type="checkbox" name="late" /> Late mark</label>
              <input name="remarks" placeholder="Remarks" className="input col-span-2" />
            </ActionForm>
          </Card>
        )}
        {can(u, "attendance", "create") === "company" && (
          <Card title="Biometric import (CSV)">
            <p className="mb-2 text-xs text-slate-500">Format: <code>emp_code,date,in,out</code> e.g. <code>ENV017,2026-11-03,08:24,18:02</code>. Late marks (15-min grace) and OT beyond 9 h are computed per location shift.</p>
            <ActionForm action={importBiometricAction} submitLabel="Import"><input type="file" name="file" accept=".csv,text/csv" className="text-sm" /></ActionForm>
          </Card>
        )}
        {(can(u, "attendance", "edit") === "company") && (
          <Card title="Monthly lock → payroll">
            <ActionForm action={lockMonthAction} submitLabel="Lock month" confirm="Lock attendance for this month? Further edits will be blocked."><input type="month" name="month" defaultValue={month} className="input" /></ActionForm>
            <p className="mt-2 text-xs text-slate-500">Locked: {locked.join(", ") || "none"}. Payroll push arrives with HR payroll (Phase 3).</p>
          </Card>
        )}
      </div>
    </div>
  );
}

async function Report({ sql, params, head, cols, title }: { sql: string; params: unknown[]; head: string[]; cols: string[]; title: string }) {
  const rows = await q(sql, params);
  return <Card title={title} bodyClass="p-0">{rows.length ? <Table head={head}>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} className={typeof r[c] === "number" ? "num" : ""}>{typeof r[c] === "number" ? num(r[c], 1) : r[c]}</td>)}</tr>)}</Table> : <Empty>No records</Empty>}</Card>;
}
