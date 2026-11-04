"use server";
import { revalidatePath } from "next/cache";
import { requireUser, can } from "@/lib/auth";
import { geoCheck, submitDwr, applyLeave, decideLeave, todayIST } from "@/lib/hr";
import { safe, s, n } from "@/lib/action";
import { pool, one } from "@/lib/db";
import { audit } from "@/lib/audit";
import { BizError } from "@/lib/workflow";

export async function checkAction(kind: "IN" | "OUT", lat: number, lng: number) {
  const u = await requireUser();
  return safe(async () => {
    const r = await geoCheck(u.id, kind, lat, lng);
    revalidatePath("/me");
    return { ok: true, message: `Checked ${kind === "IN" ? "in" : "out"} at ${r.locationName}${kind === "IN" && r.is_late ? " (late mark)" : ""}` };
  });
}

export async function dwrAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const wos = fd.getAll("wo").map(String), hrs = fd.getAll("hours").map(Number), desc = fd.getAll("desc").map(String);
    const date = s(fd, "date") || todayIST();
    if (date > todayIST()) throw new BizError("DWR cannot be for a future date");
    await submitDwr(u.id, date, s(fd, "summary"), s(fd, "issues"), wos.map((w, i) => ({ woId: w || null, hours: hrs[i] || 0, description: desc[i] })));
    revalidatePath("/me");
    return { ok: true, message: "Daily work report submitted. Hours booked to work orders." };
  });
}

export async function leaveAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    await applyLeave(u.id, s(fd, "type"), s(fd, "from"), s(fd, "to"), s(fd, "reason"));
    revalidatePath("/me");
    return { ok: true, message: "Leave applied and sent to your reporting manager." };
  });
}

export async function decideLeaveAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    await decideLeave(s(fd, "id"), s(fd, "decision") === "APPROVE", u.id, can(u, "hr", "approve") === "company");
    revalidatePath("/me"); revalidatePath("/approvals");
  });
}

export async function taskStatusAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const id = s(fd, "id"), status = s(fd, "status");
    if (!["TODO", "IN_PROGRESS", "DONE", "CANCELLED"].includes(status)) throw new BizError("Bad status");
    const t = await one(`update task set status=$3, done_at = case when $3='DONE' then now() else null end where id=$1 and (assigned_to=$2 or created_by=$2) returning id`, [id, u.id, status]);
    if (!t) throw new BizError("Task not found");
    await audit(u.id, "STATUS", "task", id, null, { status });
    revalidatePath("/me");
  });
}

export async function createTaskAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const assignee = s(fd, "assigned_to") || u.id;
    if (assignee !== u.id && !u.teamIds.includes(assignee)) throw new BizError("You can assign tasks only to yourself or your team");
    await pool.query(`insert into task(title, description, assigned_to, created_by, due_at, priority) values ($1,$2,$3,$4,$5,$6)`,
      [s(fd, "title"), s(fd, "description") || null, assignee, u.id, s(fd, "due") || null, s(fd, "priority") || "MEDIUM"]);
    revalidatePath("/me");
    return { ok: true, message: "Task created" };
  });
}

export async function markNotificationsRead() {
  const u = await requireUser();
  await pool.query(`update notification set read_at=now() where employee_id=$1 and read_at is null`, [u.id]);
  revalidatePath("/notifications");
}
