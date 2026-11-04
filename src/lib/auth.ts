import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { q, one, pool } from "./db";
import { audit, reqMeta } from "./audit";
import { sendOtpSms } from "./sms";
import { scopeOf, type Action, type ModuleCode, type PermMap, type Scope } from "./rbac";

const SESSION_COOKIE = "env_sess";
const DEVICE_COOKIE = "env_dev";
const OTP_TTL_MIN = 5, OTP_MAX_ATTEMPTS = 5, OTP_MAX_PER_15MIN = 5;
const secret = () => new TextEncoder().encode(process.env.SESSION_SECRET ?? "dev-insecure-secret-change-me-please-32chars");
const sessionDays = () => Number(process.env.SESSION_DAYS ?? 30);

export const normMobile = (m: string) => m.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
const hmac = (s: string) => crypto.createHmac("sha256", secret()).update(s).digest("hex");

export interface CurrentUser {
  id: string; name: string; mobile: string; email: string | null; empCode: string;
  roleCode: string; roleName: string; verticalId: string | null; verticalName: string | null;
  departmentId: string | null; locationId: string | null; managerId: string | null;
  perms: PermMap; teamIds: string[]; sessionId: string; hasPin: boolean;
}

// ---------------- OTP -------------------------------------------------------
export async function requestOtp(mobileRaw: string): Promise<{ ok: boolean; message: string; devCode?: string }> {
  const mobile = normMobile(mobileRaw);
  if (!/^[6-9]\d{9}$/.test(mobile)) return { ok: false, message: "Enter a valid 10-digit Indian mobile number." };
  const { ip } = await reqMeta();
  const recent = await one<{ n: number }>(
    `select count(*)::int n from otp_request where (mobile=$1 or ($2::text is not null and ip=$2)) and created_at > now() - interval '15 minutes'`,
    [mobile, ip]);
  if ((recent?.n ?? 0) >= OTP_MAX_PER_15MIN) return { ok: false, message: "Too many OTP requests. Please try again in 15 minutes." };
  const emp = await one(`select id from employee where mobile=$1 and is_active`, [mobile]);
  if (!emp) {
    await audit(null, "OTP_REQUEST_UNREGISTERED", "auth", null, null, { mobile });
    return { ok: false, message: "This mobile number is not registered or not active. Please contact HR." };
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await pool.query(`insert into otp_request(mobile, code_hash, expires_at, ip) values ($1,$2, now() + ($3 || ' minutes')::interval, $4)`,
    [mobile, hmac(`${mobile}:${code}`), String(OTP_TTL_MIN), ip]);
  await sendOtpSms(mobile, code);
  const dev = (process.env.OTP_PROVIDER ?? "console") === "console" && (process.env.NODE_ENV !== "production" || process.env.DEMO_MODE === "true");
  return { ok: true, message: `OTP sent to +91 ${mobile.slice(0, 2)}xxxxxx${mobile.slice(-2)}`, devCode: dev ? code : undefined };
}

export async function verifyOtp(mobileRaw: string, code: string, deviceLabel?: string): Promise<{ ok: boolean; message: string }> {
  const mobile = normMobile(mobileRaw);
  const otp = await one(`select * from otp_request where mobile=$1 and consumed_at is null and expires_at > now() order by created_at desc limit 1`, [mobile]);
  if (!otp) return { ok: false, message: "OTP expired. Please request a new one." };
  if (otp.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, message: "Too many wrong attempts. Request a new OTP." };
  const good = crypto.timingSafeEqual(Buffer.from(otp.code_hash), Buffer.from(hmac(`${mobile}:${code.trim()}`)));
  if (!good) {
    await pool.query(`update otp_request set attempts = attempts + 1 where id=$1`, [otp.id]);
    return { ok: false, message: `Incorrect OTP. ${OTP_MAX_ATTEMPTS - otp.attempts - 1} attempt(s) left.` };
  }
  await pool.query(`update otp_request set consumed_at = now() where id=$1`, [otp.id]);
  const emp = await one(`select id from employee where mobile=$1 and is_active`, [mobile]);
  if (!emp) return { ok: false, message: "Account inactive." };
  await createSession(emp.id, "OTP", deviceLabel);
  return { ok: true, message: "Logged in" };
}

export async function loginWithPin(mobileRaw: string, pin: string): Promise<{ ok: boolean; message: string }> {
  const mobile = normMobile(mobileRaw);
  const jar = await cookies();
  const deviceId = jar.get(DEVICE_COOKIE)?.value;
  const emp = await one(`select id, pin_hash from employee where mobile=$1 and is_active`, [mobile]);
  if (!emp?.pin_hash || !deviceId) return { ok: false, message: "PIN login is not set up on this device. Use OTP." };
  const known = await one(`select 1 from user_session where employee_id=$1 and device_id=$2 and method='OTP'`, [emp.id, deviceId]);
  if (!known) return { ok: false, message: "This device is not registered for PIN login. Use OTP." };
  const fails = await one<{ n: number }>(`select count(*)::int n from audit_log where action='PIN_FAIL' and actor_id=$1 and at > now() - interval '15 minutes'`, [emp.id]);
  if ((fails?.n ?? 0) >= 5) return { ok: false, message: "PIN locked for 15 minutes. Use OTP." };
  if (!(await bcrypt.compare(pin, emp.pin_hash))) {
    await audit(emp.id, "PIN_FAIL", "auth", emp.id);
    return { ok: false, message: "Incorrect PIN." };
  }
  await createSession(emp.id, "PIN");
  return { ok: true, message: "Logged in" };
}

async function createSession(employeeId: string, method: "OTP" | "PIN", deviceLabel?: string) {
  const jar = await cookies();
  let deviceId = jar.get(DEVICE_COOKIE)?.value;
  if (!deviceId) deviceId = crypto.randomUUID();
  const { ip, device } = await reqMeta();
  const emp = await one(`select single_device from employee where id=$1`, [employeeId]);
  if (emp?.single_device) await pool.query(`update user_session set revoked_at=now() where employee_id=$1 and revoked_at is null`, [employeeId]);
  const s = await one(
    `insert into user_session(employee_id, device_id, device_label, user_agent, ip, method, expires_at)
     values ($1,$2,$3,$4,$5,$6, now() + ($7 || ' days')::interval) returning id`,
    [employeeId, deviceId, deviceLabel ?? guessDevice(device), device, ip, method, String(sessionDays())]);
  const token = await new SignJWT({ sid: s!.id }).setProtectedHeader({ alg: "HS256" })
    .setIssuedAt().setExpirationTime(`${sessionDays()}d`).sign(secret());
  const secure = process.env.NODE_ENV === "production";
  jar.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: sessionDays() * 86400 });
  jar.set(DEVICE_COOKIE, deviceId, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 5 * 365 * 86400 });
  await audit(employeeId, `LOGIN_${method}`, "auth", employeeId, null, { session: s!.id });
}

function guessDevice(ua: string | null) {
  if (!ua) return "Unknown device";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Device";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${br} on ${os}`;
}

export async function logout() {
  const jar = await cookies();
  const u = await getCurrentUser();
  if (u) {
    await pool.query(`update user_session set revoked_at=now() where id=$1`, [u.sessionId]);
    await audit(u.id, "LOGOUT", "auth", u.id);
  }
  jar.delete(SESSION_COOKIE);
}

export async function setPin(userId: string, pin: string) {
  if (!/^\d{4}$/.test(pin)) throw new Error("PIN must be 4 digits");
  await pool.query(`update employee set pin_hash=$2 where id=$1`, [userId, await bcrypt.hash(pin, 10)]);
  await audit(userId, "PIN_SET", "employee", userId);
}

// ---------------- Session -> user ------------------------------------------
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const jar = await cookies();
  const tok = jar.get(SESSION_COOKIE)?.value;
  if (!tok) return null;
  let sid: string;
  try { sid = (await jwtVerify(tok, secret())).payload.sid as string; } catch { return null; }
  const row = await one(
    `select e.*, r.code role_code, r.name role_name, v.name vertical_name, s.id sid, s.last_seen_at
       from user_session s join employee e on e.id=s.employee_id join role r on r.id=e.role_id
       left join vertical v on v.id=e.vertical_id
      where s.id=$1 and s.revoked_at is null and s.expires_at > now() and e.is_active`, [sid]);
  if (!row) return null;
  if (Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60_000)
    pool.query(`update user_session set last_seen_at=now() where id=$1`, [sid]).catch(() => {});
  const perms: PermMap = {};
  for (const p of await q(`select module, action, scope from permission where role_id=$1`, [row.role_id]))
    perms[`${p.module}:${p.action}`] = p.scope;
  const team = await q<{ id: string }>(
    `with recursive t as (select id from employee where manager_id=$1 union select e.id from employee e join t on e.manager_id=t.id) select id from t`,
    [row.id]);
  return {
    id: row.id, name: row.name, mobile: row.mobile, email: row.email, empCode: row.emp_code,
    roleCode: row.role_code, roleName: row.role_name, verticalId: row.vertical_id, verticalName: row.vertical_name,
    departmentId: row.department_id, locationId: row.location_id, managerId: row.manager_id,
    perms, teamIds: team.map((t) => t.id), sessionId: sid, hasPin: !!row.pin_hash,
  };
});

export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return u;
}

export class Forbidden extends Error { constructor(m = "You do not have permission for this action") { super(m); } }

export function can(u: CurrentUser, module: ModuleCode, action: Action): Scope | null {
  return scopeOf(u.perms, module, action);
}
/** Throws (or redirects for page loads) when the user lacks the permission. Returns granted scope. */
export function need(u: CurrentUser, module: ModuleCode, action: Action): Scope {
  const s = can(u, module, action);
  if (!s) throw new Forbidden(`Not permitted: ${module}.${action}`);
  return s;
}
export async function requirePage(module: ModuleCode, action: Action = "view") {
  const u = await requireUser();
  if (!can(u, module, action)) redirect("/forbidden");
  return u;
}

/**
 * Builds a SQL predicate implementing data scoping.
 * cols.owner: column(s) holding the responsible employee; cols.vertical: vertical column.
 * params array is mutated (placeholders appended).
 */
export function scopeSql(u: CurrentUser, scope: Scope, cols: { owner?: string[]; vertical?: string; custom?: (ids: string) => string }, params: unknown[]): string {
  if (scope === "company") return "true";
  if (scope === "dept") {
    if (!cols.vertical || !u.verticalId) return scopeSql(u, "team", cols, params);
    params.push(u.verticalId);
    return `${cols.vertical} = $${params.length}`;
  }
  const ids = scope === "team" ? [u.id, ...u.teamIds] : [u.id];
  params.push(ids);
  const ph = `$${params.length}::uuid[]`;
  const parts = (cols.owner ?? []).map((c) => `${c} = any(${ph})`);
  if (cols.custom) parts.push(cols.custom(ph));
  return parts.length ? `(${parts.join(" or ")})` : "false";
}
