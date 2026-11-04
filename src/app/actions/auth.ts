"use server";
import { requestOtp, verifyOtp, loginWithPin, setPin, requireUser } from "@/lib/auth";
import { pool, one } from "@/lib/db";
import { audit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

export async function sendOtpAction(mobile: string) { return requestOtp(mobile); }
export async function verifyOtpAction(mobile: string, code: string) { return verifyOtp(mobile, code); }
export async function pinLoginAction(mobile: string, pin: string) { return loginWithPin(mobile, pin); }

export async function setPinAction(_: any, fd: FormData) {
  const u = await requireUser();
  const pin = String(fd.get("pin") ?? ""), confirm = String(fd.get("confirm") ?? "");
  if (pin !== confirm) return { ok: false, error: "PINs do not match" };
  try { await setPin(u.id, pin); } catch (e: any) { return { ok: false, error: e.message }; }
  return { ok: true, message: "Quick-login PIN saved for this account. Use it on devices where you've logged in with OTP." };
}

export async function revokeSessionAction(_: any, fd: FormData) {
  const u = await requireUser();
  const id = String(fd.get("id"));
  const s = await one(`update user_session set revoked_at=now() where id=$1 and employee_id=$2 returning id`, [id, u.id]);
  if (!s) return { ok: false, error: "Session not found" };
  await audit(u.id, "REVOKE_SESSION", "user_session", id);
  revalidatePath("/profile");
  return { ok: true, message: "Device logged out" };
}

export async function revokeOthersAction() {
  const u = await requireUser();
  await pool.query(`update user_session set revoked_at=now() where employee_id=$1 and id<>$2 and revoked_at is null`, [u.id, u.sessionId]);
  await audit(u.id, "REVOKE_OTHER_SESSIONS", "user_session", null);
  revalidatePath("/profile");
  return { ok: true, message: "All other devices logged out" };
}
