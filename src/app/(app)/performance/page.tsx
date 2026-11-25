import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, can } from "@/lib/auth";
import { q } from "@/lib/db";
import { resolveFrame, type Frame } from "@/lib/period";
import { performance, grade, TASK_OPEN } from "@/lib/tasks";
import { dtm, label, pct } from "@/lib/format";
import { PageHeader, Card, Table, Badge, Stat, Empty } from "@/components/ui";
import { FrameBar } from "@/components/FrameBar";

export const metadata = { title: "Performance" };

export default async function Performance({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser();
  const sc = can(u, "tasks", "view");
  if (!sc || sc === "own") redirect("/forbidden");
  const sp = await searchParams;
  const r = resolveFrame((sp.frame as Frame) ?? "month", new Date(), { from: sp.from, to: sp.to });
  const ids = sc === "company" ? null : [u.id, ...u.teamIds];
  const rows = (await performance(r.from, r.to, ids)).sort((a, b) => b.score - a.score);
  const emp = sp.employee ? rows.find((x) => x.id === sp.employee) : null;
  const detail = emp ? await q(`select t.*, (select count(*)::int from attachment a where a.entity='task' and a.entity_id=t.id) files from task t
      where t.assigned_to=$1 and t.status<>'CANCELLED' and coalesce(t.task_date, (t.due_at at time zone 'Asia/Kolkata')::date, t.created_at::date) between $2 and $3 order by coalesce(t.due_at, t.created_at) desc`, [emp.id, r.from, r.to]) : [];
  const avg = rows.length ? rows.reduce((a, x) => a + x.score, 0) / rows.length : 0;
  const qs = `frame=${sp.frame ?? "month"}${sp.from ? `&from=${sp.from}` : ""}${sp.to ? `&to=${sp.to}` : ""}`;
  return (
    <div>
      <PageHeader title="Employee performance matrix" subtitle={`${r.label} · based on daily and assigned tasks, completion reports with evidence, daily work reports and attendance`}
        actions={<a className="btn-secondary" href={`/api/export/performance?${qs}`}>Download all (.xlsx)</a>} />
      <FrameBar showCompare={false} showUnit={false} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Employees" value={rows.length} /><Stat label="Average score" value={avg.toFixed(1)} />
        <Stat label="Grade A (≥ 85)" value={rows.filter((x) => x.score >= 85).length} tone="green" /><Stat label="Needs attention (< 50)" value={rows.filter((x) => x.score < 50).length} tone="red" />
      </div>
      <Card bodyClass="p-0">
        {rows.length ? <Table head={["Employee", "Tasks", "Daily", "Completed", "On time", "Late", "Lapsed", "With evidence", "DWR days", "Attendance", "Score", "Grade", ""]}>
          {rows.map((x) => (
            <tr key={x.id} className={x.id === sp.employee ? "bg-brand-50/50" : ""}>
              <td><Link className="link font-medium" href={`/performance?${qs}&employee=${x.id}`}>{x.name}</Link><div className="text-xs text-slate-500">{x.role}</div></td>
              <td className="num">{x.assigned}</td><td className="num">{x.daily}</td><td className="num">{x.completed}</td><td className="num">{x.on_time}</td><td className="num">{x.late}</td>
              <td className={`num ${x.lapsed ? "font-semibold text-rose-600" : ""}`}>{x.lapsed}</td><td className="num">{x.with_evidence}</td><td className="num">{x.dwr_days}/{x.present_days}</td>
              <td className="num">{x.working_days ? pct((x.present_days / x.working_days) * 100, 0) : "—"}</td>
              <td className="num font-display font-bold">{x.score.toFixed(1)}</td><td><Badge tone={x.score >= 85 ? "green" : x.score >= 70 ? "blue" : x.score >= 50 ? "amber" : "red"}>{grade(x.score)}</Badge></td>
              <td><a className="link text-xs" href={`/api/export/performance?${qs}&employee=${x.id}`}>Report ↓</a></td>
            </tr>
          ))}
        </Table> : <Empty>No employees in scope</Empty>}
      </Card>
      <p className="mt-2 text-xs text-slate-500">Score = 40% tasks completed (of those due) + 20% completed on time + 15% completed with evidence or client sign-off + 15% daily work reports submitted on present days + 10% attendance.</p>
      {emp && (
        <Card title={`${emp.name} — task report (${r.label})`} className="mt-4" bodyClass="p-0" actions={<a className="btn-secondary btn-sm" href={`/api/export/performance?${qs}&employee=${emp.id}`}>Download report</a>}>
          {detail.length ? <Table head={["Task", "Type", "Due", "Completed", "Status", "Report", "Evidence"]}>
            {detail.map((t) => <tr key={t.id}><td><Link className="link" href={`/tasks/${t.id}`}>{t.title}</Link></td><td className="text-xs">{label(t.kind)}</td><td className="text-xs">{t.due_at ? dtm(t.due_at) : "—"}</td><td className="text-xs">{t.done_at ? dtm(t.done_at) : "—"}</td>
              <td>{TASK_OPEN.includes(t.status) && t.due_at && new Date(t.due_at) < new Date() ? <Badge tone="red">Lapsed</Badge> : <Badge status={t.status}>{label(t.status)}</Badge>}</td>
              <td className="max-w-xs text-xs">{t.completion_note ?? t.report_text ?? ""}</td><td className="num text-xs">{t.files || (t.client_verified_at ? "client OTP" : "—")}</td></tr>)}
          </Table> : <Empty>No tasks in this period</Empty>}
        </Card>
      )}
    </div>
  );
}
