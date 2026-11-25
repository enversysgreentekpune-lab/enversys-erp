import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, can } from "@/lib/auth";
import { q, one } from "@/lib/db";
import { dt, dtm, label } from "@/lib/format";
import { PageHeader, Card, Badge, Stepper, Empty } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { startTaskAction, completeTaskAction, transferTaskAction, submitReportAction, reviewReportAction, resendOtpAction, verifyOtpAction, addCommentAction } from "@/app/actions/tasks";
import { TASK_OPEN } from "@/lib/tasks";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const t = await one(`select t.*, a.name assignee, a.manager_id assignee_mgr, c.name creator, w.wo_no, cu.name customer, ap.name approver from task t join employee a on a.id=t.assigned_to
    left join employee c on c.id=t.created_by left join work_order w on w.id=t.wo_id left join customer cu on cu.id=t.customer_id left join employee ap on ap.id=t.report_approved_by where t.id=$1`, [id]);
  if (!t) notFound();
  const chain = await one(`with recursive up as (select manager_id from employee where id=$1 union select e.manager_id from employee e join up on e.id=up.manager_id) select 1 ok from up where manager_id=$2`, [t.assigned_to, u.id]);
  const isAssignee = t.assigned_to === u.id, isMgr = !!chain || t.created_by === u.id || can(u, "tasks", "view") === "company";
  if (!isAssignee && !isMgr) notFound();
  const [updates, files, people] = await Promise.all([
    q(`select tu.*, e.name by_name from task_update tu left join employee e on e.id=tu.created_by where task_id=$1 order by created_at desc`, [id]),
    q(`select * from attachment where entity='task' and entity_id=$1 order by created_at`, [id]),
    q(`select id, name from employee where is_active and id<>$1 order by name`, [t.assigned_to]),
  ]);
  const open = TASK_OPEN.includes(t.status);
  const field = t.kind === "FIELD_SERVICE";
  const late = t.due_at && new Date(t.due_at) < new Date() && open;
  return (
    <div>
      <PageHeader back={{ href: "/tasks", label: "Tasks" }} title={t.title}
        subtitle={<span className="flex flex-wrap items-center gap-2"><Badge tone={field ? "blue" : "gray"}>{label(t.kind)}</Badge><Badge status={t.status}>{label(t.status)}</Badge>{late && <Badge tone="red">Lapsed</Badge>} Assigned to {t.assignee} by {t.creator ?? "system"}{t.due_at && <> · due {dtm(t.due_at)}</>}</span>} />
      {field && (
        <Stepper steps={[
          { label: "Assigned", done: true },
          { label: "Work started", done: t.status !== "TODO" },
          { label: "Service report", done: ["SUBMITTED", "APPROVED"].includes(t.report_status), current: t.status === "IN_PROGRESS" },
          { label: "Manager approval", done: t.report_status === "APPROVED", current: t.status === "REPORT_SUBMITTED" },
          { label: "Report & OTP sent to client", done: ["AWAITING_CLIENT", "DONE"].includes(t.status) && t.report_status === "APPROVED" },
          { label: "Client OTP sign-off", done: !!t.client_verified_at, current: t.status === "AWAITING_CLIENT" },
        ]} />
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Card title="Details">
            {t.description ? <p className="whitespace-pre-wrap text-sm">{t.description}</p> : <p className="text-sm text-slate-500">No description.</p>}
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              {[["Priority", t.priority], ["Task date", t.task_date ? dt(t.task_date) : "—"], ["Project / SO", t.wo_no ?? "—"], ...(field ? [["Client", `${t.customer ?? ""} ${t.client_name ? `· ${t.client_name}` : ""}`], ["Client email", t.client_email], ["Client mobile", t.client_mobile ? `${t.client_mobile.slice(0, 2)}xxxxxx${t.client_mobile.slice(-2)}` : "—"], ["Site", t.site_address ?? "—"]] : [])].map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd>{v}</dd></div>)}
            </dl>
          </Card>
          {(t.completion_note || t.report_text) && (
            <Card title={field ? "Service report" : "Completion report"}>
              <p className="whitespace-pre-wrap text-sm">{t.report_text ?? t.completion_note}</p>
              {t.report_status !== "NONE" && <p className="mt-2 text-xs text-slate-500">Report status: <b>{label(t.report_status)}</b>{t.approver && ` by ${t.approver} on ${dtm(t.report_approved_at)}`}{t.client_verified_at && ` · client confirmed ${dtm(t.client_verified_at)}`}</p>}
            </Card>
          )}
          <Card title={`Evidence (${files.length})`}>
            {files.length ? <div className="flex flex-wrap gap-2">{files.map((f) => f.mime?.startsWith("image/")
              // eslint-disable-next-line @next/next/no-img-element
              ? <a key={f.id} href={`/api/files/${f.id}`} target="_blank"><img src={`/api/files/${f.id}`} alt={f.file_name} className="h-24 w-32 rounded border border-slate-200 object-cover" /></a>
              : <a key={f.id} className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:border-brand-600" href={`/api/files/${f.id}`}>📄 {f.file_name}</a>)}</div> : <Empty>No evidence uploaded yet</Empty>}
          </Card>
          <Card title="Updates">
            <ol className="space-y-3">{updates.map((x) => <li key={x.id} className="border-l-2 border-slate-200 pl-3 text-sm dark:border-slate-700"><b className="font-medium">{label(x.kind)}</b> — {x.body}<div className="text-[11px] text-slate-400">{dtm(x.created_at)} · {x.by_name ?? "system"}</div></li>)}</ol>
            <ActionForm action={addCommentAction} reset submitLabel="Add update" submitClass="btn-secondary" className="mt-3 space-y-2"><input type="hidden" name="id" value={id} /><textarea name="body" placeholder="Progress update / comment" className="input" /><input type="file" name="evidence" multiple accept="image/*,application/pdf" className="text-xs" /></ActionForm>
          </Card>
        </div>
        <div className="space-y-4">
          {isAssignee && t.status === "TODO" && <Card title="Start"><ActionForm action={startTaskAction} submitLabel="Start work"><input type="hidden" name="id" value={id} /></ActionForm></Card>}
          {isAssignee && !field && open && (
            <Card title="Complete with report & evidence">
              <ActionForm action={completeTaskAction} submitLabel="Mark completed" className="space-y-2"><input type="hidden" name="id" value={id} />
                <textarea name="note" required placeholder="What was done (completion report)" className="input min-h-24" />
                <div><span className="label">Evidence of work (photos / documents)</span><input type="file" name="evidence" multiple accept="image/*,application/pdf" capture="environment" className="text-sm" /></div></ActionForm>
            </Card>
          )}
          {isAssignee && field && ["TODO", "IN_PROGRESS"].includes(t.status) && (
            <Card title="Upload service report">
              <ActionForm action={submitReportAction} submitLabel="Submit report for approval" className="space-y-2"><input type="hidden" name="id" value={id} />
                <textarea name="report" required defaultValue={t.report_text ?? ""} placeholder="Work done, readings, parts replaced, observations, recommendations" className="input min-h-32" />
                <div><span className="label">Photos / signed job sheet</span><input type="file" name="evidence" multiple accept="image/*,application/pdf" capture="environment" className="text-sm" /></div></ActionForm>
              {t.report_status === "REJECTED" && <p className="mt-2 text-xs text-rose-600">Your manager sent the last report back. See updates for the reason.</p>}
            </Card>
          )}
          {isMgr && !isAssignee && t.status === "REPORT_SUBMITTED" && (
            <Card title="Approve service report">
              <p className="mb-2 text-xs text-slate-500">On approval the report is emailed to {t.client_email} and a completion OTP is sent to the client&apos;s mobile and email.</p>
              <ActionForm action={reviewReportAction} hideSubmit className="space-y-2"><input type="hidden" name="id" value={id} /><input name="remarks" placeholder="Remarks (required to send back)" className="input" />
                <div className="flex gap-2"><button name="decision" value="APPROVE" className="btn-primary">Approve & send to client</button><button name="decision" value="REJECT" className="btn-secondary">Send back</button></div></ActionForm>
            </Card>
          )}
          {t.status === "AWAITING_CLIENT" && (isAssignee || isMgr) && (
            <Card title="Client sign-off">
              <ActionForm action={verifyOtpAction} submitLabel="Verify & complete" className="space-y-2"><input type="hidden" name="id" value={id} />
                <input name="otp" required inputMode="numeric" maxLength={6} placeholder="6-digit OTP from client" className="input text-center text-lg tracking-[0.4em]" /></ActionForm>
              <ActionForm action={resendOtpAction} submitLabel="Resend OTP to client" submitClass="btn-ghost btn-sm" className="mt-1"><input type="hidden" name="id" value={id} /></ActionForm>
            </Card>
          )}
          {open && (isAssignee || isMgr) && (
            <Card title="Transfer task">
              <ActionForm action={transferTaskAction} submitLabel="Transfer" submitClass="btn-secondary" className="space-y-2"><input type="hidden" name="id" value={id} />
                <select name="to" className="input">{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><input name="reason" required placeholder="Reason" className="input" /></ActionForm>
            </Card>
          )}
          {t.status === "DONE" && <Card><p className="text-sm">✅ Completed {dtm(t.done_at)}{t.client_verified_at && " · confirmed by client OTP"}.</p><Link href="/tasks" className="link text-sm">Back to tasks</Link></Card>}
        </div>
      </div>
    </div>
  );
}
