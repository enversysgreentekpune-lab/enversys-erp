"use server";
import { revalidatePath } from "next/cache";
import { requireUser, can } from "@/lib/auth";
import { one } from "@/lib/db";
import { safe, s, opt } from "@/lib/action";
import { BizError } from "@/lib/workflow";
import { saveUploads } from "@/lib/attachments";
import { saveLocation } from "@/lib/hr";
import * as T from "@/lib/tasks";

const files = (fd: FormData) => (fd.getAll("evidence") as File[]).filter((f) => f && typeof f !== "string" && f.size > 0);
const done = (id?: string) => { revalidatePath("/tasks"); revalidatePath("/me"); if (id) revalidatePath(`/tasks/${id}`); };

export async function pingLocationAction(lat: number, lng: number, accuracy?: number) {
  const u = await requireUser();
  await saveLocation(u.id, Number(lat), Number(lng), "LOGIN", accuracy ?? null);
}

export async function createTaskAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const assignee = s(fd, "assigned_to") || u.id;
    if (assignee !== u.id && !u.teamIds.includes(assignee) && can(u, "tasks", "create") !== "company") throw new BizError("You can assign tasks only to yourself or your team");
    const kind = s(fd, "kind") === "FIELD_SERVICE" ? "FIELD_SERVICE" : "GENERAL";
    if (s(fd, "repeat") === "daily") {
      await T.addTemplate(assignee, s(fd, "title"), s(fd, "description"), fd.getAll("weekday").map(Number).filter(Boolean), u.id);
      await T.ensureDailyTasks(new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10), assignee);
      done();
      return { ok: true, message: "Daily task scheduled. It appears on the assignee's list every working day." };
    }
    const t = await T.createTask({
      title: s(fd, "title"), description: s(fd, "description"), assignedTo: assignee, dueAt: opt(fd, "due"), priority: s(fd, "priority") || "MEDIUM", kind,
      woId: opt(fd, "wo_id"), customerId: opt(fd, "customer_id"), clientName: s(fd, "client_name"), clientEmail: s(fd, "client_email"), clientMobile: s(fd, "client_mobile"), siteAddress: s(fd, "site_address"),
    }, u.id);
    done();
    return { ok: true, redirect: `/tasks/${t.id}` };
  });
}

export async function startTaskAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => { await T.startTask(s(fd, "id"), u.id); done(s(fd, "id")); });
}

export async function completeTaskAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const id = s(fd, "id");
    const ev = await saveUploads(files(fd), { entity: "task", entityId: id, folder: "Evidence", userId: u.id });
    await T.completeTask(id, s(fd, "note"), ev.length, u.id);
    done(id);
    return { ok: true, message: "Task completed and reported" };
  });
}

export async function transferTaskAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => { await T.transferTask(s(fd, "id"), s(fd, "to"), s(fd, "reason"), u.id); done(s(fd, "id")); return { ok: true, message: "Task transferred" }; });
}

export async function submitReportAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const id = s(fd, "id");
    const ev = await saveUploads(files(fd), { entity: "task", entityId: id, folder: "Service report", userId: u.id });
    await T.submitServiceReport(id, s(fd, "report"), ev.length, u.id);
    done(id);
    return { ok: true, message: "Service report sent to your manager for approval" };
  });
}

export async function reviewReportAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const id = s(fd, "id");
    const r = await T.reviewServiceReport(id, s(fd, "decision") === "APPROVE", s(fd, "remarks"), u.id);
    done(id);
    return { ok: true, message: s(fd, "decision") === "APPROVE" ? `Approved. Report emailed to the client and OTP sent to their mobile & email.${r.devOtp ? ` (Demo: client OTP ${r.devOtp})` : ""}` : "Report sent back to the engineer" };
  });
}

export async function resendOtpAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const r = await T.sendClientOtp(s(fd, "id"), u.id);
    done(s(fd, "id"));
    return { ok: true, message: `New OTP sent to the client.${r.devOtp ? ` (Demo: client OTP ${r.devOtp})` : ""}` };
  });
}

export async function verifyOtpAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => { await T.verifyClientOtp(s(fd, "id"), s(fd, "otp"), u.id); done(s(fd, "id")); return { ok: true, message: "Client confirmed. Task completed." }; });
}

export async function addCommentAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const id = s(fd, "id");
    const t = await one(`select assigned_to, created_by from task where id=$1`, [id]);
    if (!t) throw new BizError("Task not found");
    if (!s(fd, "body")) throw new BizError("Write a comment");
    await one(`insert into task_update(task_id, kind, body, created_by) values ($1,'COMMENT',$2,$3) returning id`, [id, s(fd, "body"), u.id]);
    await saveUploads(files(fd), { entity: "task", entityId: id, folder: "Evidence", userId: u.id });
    done(id);
  });
}
