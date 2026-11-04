"use server";
import { revalidatePath } from "next/cache";
import { requireUser, need, can } from "@/lib/auth";
import { one, q, pool } from "@/lib/db";
import { audit } from "@/lib/audit";
import { safe, s, n, opt } from "@/lib/action";
import { BizError } from "@/lib/workflow";

async function assertUnlocked(date: string) {
  if (await one(`select 1 from attendance_lock where month=$1`, [date.slice(0, 7)])) throw new BizError(`Attendance for ${date.slice(0, 7)} is locked`);
}
const ts = (date: string, hm: string | null) => (hm ? `${date}T${hm}:00+05:30` : null);

export async function markAttendanceAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const sc = need(u, "attendance", "edit");
    const emp = s(fd, "employee_id"), date = s(fd, "date");
    if (sc !== "company" && !u.teamIds.includes(emp)) throw new BizError("You can mark attendance only for your team");
    await assertUnlocked(date);
    const old = await one(`select * from attendance where employee_id=$1 and att_date=$2`, [emp, date]);
    const r = await one(`insert into attendance(employee_id, att_date, location_id, check_in, check_out, source, status, is_late, ot_hours, remarks, updated_by)
      values ($1,$2,$3,$4,$5,'MANUAL',$6,$7,$8,$9,$10)
      on conflict (employee_id, att_date) do update set location_id=excluded.location_id, check_in=coalesce(excluded.check_in, attendance.check_in), check_out=coalesce(excluded.check_out, attendance.check_out),
        status=excluded.status, is_late=excluded.is_late, ot_hours=excluded.ot_hours, remarks=excluded.remarks, updated_by=excluded.updated_by, source='MANUAL' returning id`,
      [emp, date, opt(fd, "location_id"), ts(date, opt(fd, "in")), ts(date, opt(fd, "out")), s(fd, "status") || "P", s(fd, "late") === "on", n(fd, "ot"), opt(fd, "remarks"), u.id]);
    await audit(u.id, old ? "EDIT" : "CREATE", "attendance", r!.id, old ? { status: old.status, ot: old.ot_hours } : null, { status: s(fd, "status"), ot: n(fd, "ot"), source: "MANUAL" });
    revalidatePath("/attendance");
    return { ok: true, message: "Attendance saved" };
  });
}

/** Biometric CSV: emp_code,date(YYYY-MM-DD),in(HH:MM),out(HH:MM) */
export async function importBiometricAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    need(u, "attendance", "create");
    if (can(u, "attendance", "create") !== "company") throw new BizError("Only Time Office / HR can import biometric data");
    const f = fd.get("file") as File | null;
    if (!f?.size) throw new BizError("Choose a CSV file");
    const lines = (await f.text()).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const emps = new Map((await q(`select e.id, e.emp_code, e.location_id, l.shift_start from employee e left join location l on l.id=e.location_id`)).map((e) => [e.emp_code, e]));
    let ok = 0; const bad: string[] = [];
    for (const [i, line] of lines.entries()) {
      const [code, date, tin, tout] = line.split(",").map((x) => x.trim());
      if (i === 0 && !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) continue; // header
      const e = emps.get(code);
      if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(tin ?? "")) { bad.push(`row ${i + 1}`); continue; }
      if (await one(`select 1 from attendance_lock where month=$1`, [date.slice(0, 7)])) { bad.push(`row ${i + 1} (locked)`); continue; }
      const [sh, sm] = String(e.shift_start ?? "09:30").split(":").map(Number), [ih, im] = tin.split(":").map(Number);
      const late = ih * 60 + im > sh * 60 + sm + 15;
      let ot = 0;
      if (tout && /^\d{1,2}:\d{2}$/.test(tout)) { const [oh, om] = tout.split(":").map(Number); ot = Math.max(0, Math.round(((oh * 60 + om - ih * 60 - im) / 60 - 9) * 2) / 2); }
      await pool.query(`insert into attendance(employee_id, att_date, location_id, check_in, check_out, source, status, is_late, ot_hours, updated_by)
        values ($1,$2,$3,$4,$5,'BIOMETRIC','P',$6,$7,$8) on conflict (employee_id, att_date) do update set check_in=excluded.check_in, check_out=excluded.check_out, source='BIOMETRIC', status='P', is_late=excluded.is_late, ot_hours=excluded.ot_hours`,
        [e.id, date, e.location_id, ts(date, tin.padStart(5, "0")), tout ? ts(date, tout.padStart(5, "0")) : null, late, ot, u.id]);
      ok++;
    }
    await audit(u.id, "IMPORT", "attendance", null, null, { rows: ok, rejected: bad.length });
    revalidatePath("/attendance");
    return { ok: true, message: `Imported ${ok} punch record(s).${bad.length ? ` Rejected: ${bad.slice(0, 8).join(", ")}${bad.length > 8 ? "…" : ""}` : ""}` };
  });
}

export async function lockMonthAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    if (can(u, "attendance", "approve") !== "company" && can(u, "attendance", "edit") !== "company") throw new BizError("Only Time Office / HR can lock attendance");
    const m = s(fd, "month");
    if (!/^\d{4}-\d{2}$/.test(m)) throw new BizError("Pick a month");
    await pool.query(`insert into attendance_lock(month, locked_by) values ($1,$2) on conflict do nothing`, [m, u.id]);
    await pool.query(`update attendance set locked=true where to_char(att_date,'YYYY-MM')=$1`, [m]);
    await audit(u.id, "LOCK", "attendance", null, null, { month: m });
    revalidatePath("/attendance");
    return { ok: true, message: `${m} locked. Attendance is now frozen for payroll processing.` };
  });
}
