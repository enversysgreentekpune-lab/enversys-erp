// Task management: assigned / daily (template) / field-service tasks, evidence, transfer,
// manager-approved service reports, client OTP sign-off, email updates and the performance matrix.
import crypto from "node:crypto";
import { one, q, tx, pool, type Db } from "./db";
import { audit } from "./audit";
import { notify } from "./notify";
import { BizError } from "./workflow";
import { sendMail } from "./email";
import { sendOtpSms } from "./sms";

const secret = () => process.env.SESSION_SECRET ?? "dev-insecure-secret-change-me-please-32chars";
const hmac = (s: string) => crypto.createHmac("sha256", secret()).update(s).digest("hex");
export const demoMode = () => (process.env.OTP_PROVIDER ?? "console") === "console" && (process.env.NODE_ENV !== "production" || process.env.DEMO_MODE === "true");
const OPEN = ["TODO", "IN_PROGRESS", "REPORT_SUBMITTED", "AWAITING_CLIENT"];
export const TASK_OPEN = OPEN;

async function log(c: Db, taskId: string, kind: string, body: string, by: string | null) {
  await c.query(`insert into task_update(task_id, kind, body, created_by) values ($1,$2,$3,$4)`, [taskId, kind, body, by]);
}

/** Email the client (field service) and the assignee's manager about a development on the task */
async function emailUpdate(task: any, subject: string, html: string, actorId: string, toClient = true) {
  const mgr = await one(`select m.email from employee e join employee m on m.id=e.manager_id where e.id=$1`, [task.assigned_to]);
  const to = [toClient && task.kind === "FIELD_SERVICE" ? task.client_email : null, mgr?.email].filter(Boolean).join(", ");
  if (!to) return;
  try {
    await sendMail({ to, subject: `[TASK ${String(task.id).slice(0, 8).toUpperCase()}] ${subject}`, html, attachmentIds: [], sentBy: actorId });
  } catch { /* email failure must not block field work; status is kept on email_message */ }
}

export interface NewTask {
  title: string; description?: string; assignedTo: string; dueAt?: string | null; priority?: string; kind?: "GENERAL" | "FIELD_SERVICE";
  woId?: string | null; customerId?: string | null; clientName?: string; clientEmail?: string; clientMobile?: string; siteAddress?: string;
}
export async function createTask(t: NewTask, actorId: string) {
  if (!t.title?.trim()) throw new BizError("Task title is required");
  if (t.kind === "FIELD_SERVICE") {
    if (!t.clientEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t.clientEmail)) throw new BizError("Client email is required for a field service task");
    if (!t.clientMobile || !/^[6-9]\d{9}$/.test(t.clientMobile.replace(/\D/g, "").slice(-10))) throw new BizError("A valid 10-digit client mobile is required for OTP sign-off");
  }
  return tx(async (c) => {
    const r = await one(`insert into task(title, description, assigned_to, created_by, due_at, priority, kind, wo_id, customer_id, client_name, client_email, client_mobile, site_address, link)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,null) returning *`,
      [t.title.trim(), t.description || null, t.assignedTo, actorId, t.dueAt || null, t.priority || "MEDIUM", t.kind ?? "GENERAL", t.woId || null, t.customerId || null,
        t.clientName || null, t.clientEmail || null, t.clientMobile ? t.clientMobile.replace(/\D/g, "").slice(-10) : null, t.siteAddress || null], c);
    await c.query(`update task set link=$2 where id=$1`, [r!.id, `/tasks/${r!.id}`]);
    await log(c, r!.id, "CREATED", `Assigned${t.dueAt ? `, due ${t.dueAt}` : ""}`, actorId);
    if (t.assignedTo !== actorId) await notify([t.assignedTo], "New task assigned", t.title, `/tasks/${r!.id}`, c);
    await audit(actorId, "CREATE", "task", r!.id, null, { title: t.title, kind: t.kind ?? "GENERAL", assigned_to: t.assignedTo }, c);
    return r!;
  }).then(async (task) => {
    if (task.kind === "FIELD_SERVICE") await emailUpdate(task, `Service visit scheduled: ${task.title}`, `<p>Dear ${task.client_name ?? "Customer"},</p><p>Enversys has scheduled <b>${task.title}</b>${task.due_at ? ` on ${new Date(task.due_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}` : ""}. We will keep you updated on progress.</p>`, actorId);
    return task;
  });
}

/** Generate today's tasks from each active daily template (idempotent) */
export async function ensureDailyTasks(date: string, employeeId?: string, db: Db = pool) {
  const dow = ((new Date(date + "T00:00:00").getDay() + 6) % 7) + 1; // ISO 1=Mon..7=Sun
  const r = await db.query(`insert into task(title, description, assigned_to, created_by, due_at, priority, kind, task_date, template_id)
    select t.title, t.description, t.employee_id, t.created_by, ($1::date + time '19:00') at time zone 'Asia/Kolkata', 'MEDIUM', 'DAILY', $1::date, t.id
      from task_template t join employee e on e.id=t.employee_id
     where t.is_active and e.is_active and $2 = any(t.weekdays) and ($3::uuid is null or t.employee_id=$3)
    on conflict (template_id, task_date) where template_id is not null do nothing`, [date, dow, employeeId ?? null]);
  await db.query(`update task set link='/tasks/' || id where link is null and kind='DAILY'`);
  return r.rowCount ?? 0;
}

export async function addTemplate(employeeId: string, title: string, description: string, weekdays: number[], actorId: string) {
  if (!title.trim()) throw new BizError("Title is required");
  const r = await one(`insert into task_template(employee_id, title, description, weekdays, created_by) values ($1,$2,$3,$4,$5) returning *`, [employeeId, title.trim(), description || null, weekdays.length ? weekdays : [1, 2, 3, 4, 5, 6], actorId]);
  await audit(actorId, "CREATE", "task_template", r!.id, null, { employee: employeeId, title });
  return r!;
}

async function loadTask(c: Db, id: string) {
  const t = await one(`select * from task where id=$1 for update`, [id], c);
  if (!t) throw new BizError("Task not found");
  return t;
}
const canActOn = async (t: any, actorId: string, c: Db) => {
  if (t.assigned_to === actorId || t.created_by === actorId) return true;
  const mgr = await one(`with recursive up as (select manager_id from employee where id=$1 union select e.manager_id from employee e join up on e.id=up.manager_id) select 1 from up where manager_id=$2`, [t.assigned_to, actorId], c);
  return !!mgr;
};

export async function startTask(id: string, actorId: string) {
  return tx(async (c) => {
    const t = await loadTask(c, id);
    if (t.assigned_to !== actorId) throw new BizError("Only the assignee can start this task");
    if (t.status !== "TODO") throw new BizError("Task already started");
    await c.query(`update task set status='IN_PROGRESS' where id=$1`, [id]);
    await log(c, id, "STATUS", "Started", actorId);
    return t;
  }).then(async (t) => { if (t.kind === "FIELD_SERVICE") await emailUpdate(t, `Work started: ${t.title}`, `<p>Our engineer has started work on <b>${t.title}</b>.</p>`, actorId); });
}

/** Complete a general/daily task with a completion note; evidence files are counted for the performance matrix */
export async function completeTask(id: string, note: string, evidenceFiles: number, actorId: string) {
  return tx(async (c) => {
    const t = await loadTask(c, id);
    if (t.kind === "FIELD_SERVICE") throw new BizError("Field service tasks are completed with an approved service report and the client's OTP");
    if (t.assigned_to !== actorId) throw new BizError("Only the assignee can complete this task");
    if (!OPEN.includes(t.status)) throw new BizError("Task is not open");
    if (!note?.trim()) throw new BizError("Describe the work done (completion report)");
    await c.query(`update task set status='DONE', done_at=now(), completion_note=$2, evidence_count=evidence_count+$3 where id=$1`, [id, note.trim(), evidenceFiles]);
    await log(c, id, "COMPLETED", `${note.trim()}${evidenceFiles ? ` (${evidenceFiles} evidence file${evidenceFiles > 1 ? "s" : ""})` : ""}`, actorId);
    if (t.created_by && t.created_by !== actorId) await notify([t.created_by], "Task completed", t.title, `/tasks/${id}`, c);
    await audit(actorId, "COMPLETE", "task", id, { status: t.status }, { status: "DONE", evidence: evidenceFiles }, c);
  });
}

export async function transferTask(id: string, toEmployeeId: string, reason: string, actorId: string) {
  if (!reason?.trim()) throw new BizError("Give a reason for the transfer");
  return tx(async (c) => {
    const t = await loadTask(c, id);
    if (!OPEN.includes(t.status)) throw new BizError("Only open tasks can be transferred");
    if (!(await canActOn(t, actorId, c))) throw new BizError("You can transfer only your own tasks or your team's");
    if (toEmployeeId === t.assigned_to) throw new BizError("Task is already assigned to this person");
    const to = await one(`select id, name from employee where id=$1 and is_active`, [toEmployeeId], c);
    if (!to) throw new BizError("Select an active employee");
    await c.query(`update task set assigned_to=$2, status = case when status='IN_PROGRESS' then 'TODO' else status end where id=$1`, [id, toEmployeeId]);
    await log(c, id, "TRANSFER", `Transferred to ${to.name}: ${reason}`, actorId);
    await notify([toEmployeeId, t.created_by].filter((x) => x && x !== actorId), "Task transferred", `${t.title} → ${to.name}`, `/tasks/${id}`, c);
    await audit(actorId, "TRANSFER", "task", id, { assigned_to: t.assigned_to }, { assigned_to: toEmployeeId, reason }, c);
    return { ...t, assigned_to: toEmployeeId, toName: to.name };
  }).then(async (t) => { if (t.kind === "FIELD_SERVICE") await emailUpdate(t, `Engineer changed: ${t.title}`, `<p>Your service task is now handled by <b>${t.toName}</b>.</p>`, actorId); });
}

export async function submitServiceReport(id: string, report: string, evidenceFiles: number, actorId: string) {
  if (!report?.trim()) throw new BizError("Write the service report");
  return tx(async (c) => {
    const t = await loadTask(c, id);
    if (t.kind !== "FIELD_SERVICE") throw new BizError("Service reports are for field service tasks");
    if (t.assigned_to !== actorId) throw new BizError("Only the assigned engineer can submit the report");
    if (!["TODO", "IN_PROGRESS"].includes(t.status)) throw new BizError("A report is already pending");
    await c.query(`update task set status='REPORT_SUBMITTED', report_text=$2, report_status='SUBMITTED', evidence_count=evidence_count+$3 where id=$1`, [id, report.trim(), evidenceFiles]);
    await log(c, id, "REPORT", "Service report submitted for manager approval", actorId);
    const mgr = await one(`select manager_id from employee where id=$1`, [actorId], c);
    await notify([mgr?.manager_id, t.created_by].filter((x) => x && x !== actorId), "Service report to approve", t.title, `/tasks/${id}`, c);
    await audit(actorId, "SUBMIT_REPORT", "task", id, null, { evidence: evidenceFiles }, c);
    return t;
  }).then(async (t) => { await emailUpdate(t, `Service report submitted: ${t.title}`, `<p>The service report has been submitted and is under review.</p>`, actorId, false); });
}

/** Manager approves the draft report → report is emailed to the client and an OTP is sent to client mobile + email */
export async function reviewServiceReport(id: string, approve: boolean, remarks: string, actorId: string): Promise<{ devOtp?: string }> {
  const t = await tx(async (c) => {
    const t = await loadTask(c, id);
    if (t.status !== "REPORT_SUBMITTED") throw new BizError("No report waiting for approval");
    if (t.assigned_to === actorId) throw new BizError("The report must be approved by the engineer's manager");
    if (!(await canActOn(t, actorId, c))) throw new BizError("Only the engineer's manager can approve this report");
    if (!approve) {
      if (!remarks?.trim()) throw new BizError("Give a reason for sending the report back");
      await c.query(`update task set status='IN_PROGRESS', report_status='REJECTED' where id=$1`, [id]);
      await log(c, id, "REPORT_REJECTED", remarks, actorId);
      await notify([t.assigned_to], "Service report sent back", remarks, `/tasks/${id}`, c);
      return null;
    }
    await c.query(`update task set report_status='APPROVED', report_approved_by=$2, report_approved_at=now() where id=$1`, [id, actorId]);
    await log(c, id, "REPORT_APPROVED", remarks || "Approved", actorId);
    await audit(actorId, "APPROVE_REPORT", "task", id, null, { remarks }, c);
    return t;
  });
  if (!t) return {};
  return sendClientOtp(id, actorId);
}

export async function sendClientOtp(id: string, actorId: string): Promise<{ devOtp?: string }> {
  const t = await one(`select t.*, e.name engineer from task t join employee e on e.id=t.assigned_to where t.id=$1`, [id]);
  if (!t || t.report_status !== "APPROVED") throw new BizError("The service report must be approved first");
  if (!["REPORT_SUBMITTED", "AWAITING_CLIENT"].includes(t.status)) throw new BizError("Task is not waiting for client sign-off");
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await pool.query(`update task set status='AWAITING_CLIENT', client_otp_hash=$2, client_otp_expires=now() + interval '48 hours' where id=$1`, [id, hmac(`${id}:${code}`)]);
  await sendOtpSms(t.client_mobile, code, "service");
  await emailUpdate(t, `Service report & completion OTP: ${t.title}`,
    `<p>Dear ${t.client_name ?? "Customer"},</p><p>Please find below the service report for <b>${t.title}</b> by ${t.engineer}.</p><blockquote>${String(t.report_text ?? "").replace(/</g, "&lt;").replace(/\n/g, "<br/>")}</blockquote>
     <p>If the work is completed to your satisfaction, share this OTP with our engineer to sign off: <b style="font-size:18px">${code}</b> (valid 48 hours). The same OTP was sent to your mobile.</p>`, actorId);
  await one(`insert into task_update(task_id, kind, body, created_by) values ($1,'CLIENT_OTP',$2,$3) returning id`, [id, `Report emailed to ${t.client_email}; OTP sent to client mobile ${String(t.client_mobile).slice(0, 2)}xxxxxx${String(t.client_mobile).slice(-2)}`, actorId]);
  return { devOtp: demoMode() ? code : undefined };
}

export async function verifyClientOtp(id: string, code: string, actorId: string) {
  const t = await tx(async (c) => {
    const t = await loadTask(c, id);
    if (t.status !== "AWAITING_CLIENT") throw new BizError("Task is not waiting for client OTP");
    if (t.assigned_to !== actorId && !(await canActOn(t, actorId, c))) throw new BizError("Only the engineer or manager can enter the client OTP");
    if (!t.client_otp_hash || new Date(t.client_otp_expires) < new Date()) throw new BizError("OTP expired. Resend it to the client.");
    const ok = crypto.timingSafeEqual(Buffer.from(t.client_otp_hash), Buffer.from(hmac(`${id}:${code.trim()}`)));
    if (!ok) { await log(c, id, "CLIENT_OTP_FAILED", "Incorrect client OTP entered", actorId); throw new BizError("Incorrect OTP"); }
    await c.query(`update task set status='DONE', done_at=now(), client_verified_at=now(), client_otp_hash=null where id=$1`, [id]);
    await log(c, id, "COMPLETED", "Client confirmed completion with OTP", actorId);
    await notify([t.created_by].filter((x) => x && x !== actorId), "Field service completed", `${t.title} — client signed off`, `/tasks/${id}`, c);
    await audit(actorId, "CLIENT_SIGNOFF", "task", id, { status: "AWAITING_CLIENT" }, { status: "DONE" }, c);
    return t;
  });
  await emailUpdate(t, `Service completed: ${t.title}`, `<p>Thank you for confirming completion of <b>${t.title}</b>. A copy of the approved service report is on record with Enversys.</p>`, actorId);
}

// ---------------- Performance matrix -------------------------------------------
export interface PerfRow {
  id: string; name: string; emp_code: string; role: string; assigned: number; daily: number; completed: number; on_time: number; late: number; lapsed: number;
  open_not_due: number; with_evidence: number; dwr_days: number; working_days: number; present_days: number; score: number;
}
/** Score = 40% completion + 20% on-time + 15% evidence + 15% daily-report compliance + 10% attendance */
export async function performance(from: string, to: string, employeeIds?: string[] | null): Promise<PerfRow[]> {
  const rows = await q(`
    select e.id, e.name, e.emp_code, r.name role,
      count(t.id)::int assigned,
      count(t.id) filter (where t.kind='DAILY')::int daily,
      count(t.id) filter (where t.status='DONE')::int completed,
      count(t.id) filter (where t.status='DONE' and (t.due_at is null or t.done_at <= t.due_at))::int on_time,
      count(t.id) filter (where t.status='DONE' and t.due_at is not null and t.done_at > t.due_at)::int late,
      count(t.id) filter (where t.status = any($4) and t.due_at < now())::int lapsed,
      count(t.id) filter (where t.status = any($4) and (t.due_at is null or t.due_at >= now()))::int open_not_due,
      count(t.id) filter (where t.status='DONE' and (t.evidence_count > 0 or t.client_verified_at is not null))::int with_evidence,
      (select count(*)::int from dwr d where d.employee_id=e.id and d.report_date between $1 and $2) dwr_days,
      (select count(*)::int from attendance a where a.employee_id=e.id and a.att_date between $1 and $2 and a.status in ('P','HD','OD','A','L')) working_days,
      (select count(*)::int from attendance a where a.employee_id=e.id and a.att_date between $1 and $2 and a.status in ('P','HD','OD')) present_days
    from employee e join role r on r.id=e.role_id
    left join task t on t.assigned_to=e.id and t.status <> 'CANCELLED' and coalesce(t.task_date, (t.due_at at time zone 'Asia/Kolkata')::date, t.created_at::date) between $1 and $2
    where e.is_active and ($3::uuid[] is null or e.id = any($3))
    group by e.id, r.name order by e.name`, [from, to, employeeIds ?? null, OPEN]);
  return rows.map((r) => {
    const due = r.completed + r.lapsed;
    const completion = due ? r.completed / due : r.assigned ? 0 : 1;
    const onTime = r.completed ? r.on_time / r.completed : due ? 0 : 1;
    const evidence = r.completed ? r.with_evidence / r.completed : due ? 0 : 1;
    const dwr = r.present_days ? Math.min(1, r.dwr_days / r.present_days) : 0;
    const att = r.working_days ? r.present_days / r.working_days : 0;
    const score = Math.round((completion * 40 + onTime * 20 + evidence * 15 + dwr * 15 + att * 10) * 10) / 10;
    return { ...r, score } as PerfRow;
  });
}
export const grade = (s: number) => (s >= 85 ? "A" : s >= 70 ? "B" : s >= 50 ? "C" : "D");
