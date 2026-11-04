// Time office, attendance, DWR (labour costing) and leave
import { one, q, tx, pool } from "./db";
import { audit } from "./audit";
import { notify } from "./notify";
import { BizError } from "./workflow";
import { iso } from "./period";

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000, toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1), dLng = toR(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/** IST "today" */
export const todayIST = () => iso(new Date(Date.now() + (330 + new Date().getTimezoneOffset()) * 60000));

export async function nearestLocation(lat: number, lng: number) {
  const locs = await q(`select * from location where is_active and lat is not null`);
  let best: any = null;
  for (const l of locs) {
    const d = haversineM(lat, lng, Number(l.lat), Number(l.lng));
    if (!best || d < best.distance) best = { ...l, distance: d };
  }
  return best as (Record<string, any> & { distance: number }) | null;
}

export async function geoCheck(employeeId: string, kind: "IN" | "OUT", lat: number, lng: number, selfieKey?: string | null) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new BizError("Location not available. Enable GPS and try again.");
  const loc = await nearestLocation(lat, lng);
  if (!loc || loc.distance > loc.geofence_m)
    throw new BizError(`You are ${loc ? loc.distance + " m from " + loc.name : "far from any registered location"}. Check-in is allowed only inside a geofence (HO, Markal Factory or project site).`);
  const date = todayIST();
  const locked = await one(`select 1 from attendance_lock where month=$1`, [date.slice(0, 7)]);
  if (locked) throw new BizError("Attendance for this month is locked");
  if (kind === "IN") {
    const nowIst = new Date(Date.now() + (330 + new Date().getTimezoneOffset()) * 60000);
    const [h, m] = String(loc.shift_start).split(":").map(Number);
    const late = nowIst.getHours() * 60 + nowIst.getMinutes() > h * 60 + m + 15; // 15 min grace
    const r = await one(`insert into attendance(employee_id, att_date, location_id, check_in, in_lat, in_lng, in_distance_m, selfie_key, source, status, is_late)
      values ($1,$2,$3,now(),$4,$5,$6,$7,'GEO','P',$8)
      on conflict (employee_id, att_date) do update set check_in = coalesce(attendance.check_in, excluded.check_in), location_id = excluded.location_id,
        in_lat = coalesce(attendance.in_lat, excluded.in_lat), in_lng = coalesce(attendance.in_lng, excluded.in_lng), status='P'
      returning *`, [employeeId, date, loc.id, lat, lng, loc.distance, selfieKey ?? null, late]);
    await audit(employeeId, "CHECK_IN", "attendance", r!.id, null, { location: loc.code, distance: loc.distance });
    return { ...r, locationName: loc.name };
  }
  const cur = await one(`select a.*, l.shift_end from attendance a left join location l on l.id=a.location_id where employee_id=$1 and att_date=$2`, [employeeId, date]);
  if (!cur?.check_in) throw new BizError("Check in first");
  const hours = (Date.now() - new Date(cur.check_in).getTime()) / 3600000;
  const ot = Math.max(0, Math.round((hours - 9) * 2) / 2);  // OT beyond 9 h in 0.5 h steps
  const status = hours < 4.5 ? "HD" : "P";
  const r = await one(`update attendance set check_out=now(), out_lat=$2, out_lng=$3, ot_hours=$4, status=$5 where id=$1 returning *`, [cur.id, lat, lng, ot, status]);
  await audit(employeeId, "CHECK_OUT", "attendance", cur.id, null, { hours: hours.toFixed(2), ot });
  return { ...r, locationName: loc.name };
}

export async function submitDwr(employeeId: string, date: string, summary: string, issues: string, lines: { woId: string | null; hours: number; description: string }[]) {
  if (!summary?.trim()) throw new BizError("Summary is required");
  const total = lines.reduce((a, l) => a + Number(l.hours || 0), 0);
  if (total > 16) throw new BizError("Total hours cannot exceed 16 in a day");
  return tx(async (c) => {
    const emp = await one(`select hourly_cost, name from employee where id=$1`, [employeeId], c);
    const d = await one(`insert into dwr(employee_id, report_date, summary, issues) values ($1,$2,$3,$4)
      on conflict (employee_id, report_date) do update set summary=excluded.summary, issues=excluded.issues, submitted_at=now() returning id`, [employeeId, date, summary, issues || null], c);
    // re-submission replaces the day's lines and their labour cost entries
    await c.query(`delete from cost_entry where source_type='DWR' and source_id in (select id from dwr_line where dwr_id=$1)`, [d!.id]);
    await c.query(`delete from dwr_line where dwr_id=$1`, [d!.id]);
    for (const l of lines.filter((x) => Number(x.hours) > 0)) {
      const dl = await one(`insert into dwr_line(dwr_id, wo_id, hours, description) values ($1,$2,$3,$4) returning id`, [d!.id, l.woId || null, l.hours, l.description || null], c);
      if (l.woId && Number(emp.hourly_cost) > 0)
        await c.query(`insert into cost_entry(cost_centre, wo_id, category, description, amount, entry_date, source_type, source_id, created_by)
          values ('WO',$1,'LABOUR',$2,$3,$4,'DWR',$5,$6)`, [l.woId, `${emp.name}: ${l.hours} h — ${l.description || "DWR"}`, Math.round(Number(l.hours) * Number(emp.hourly_cost) * 100) / 100, date, dl!.id, employeeId]);
    }
    await audit(employeeId, "SUBMIT", "dwr", d!.id, null, { date, hours: total }, c);
    return d!;
  });
}

export async function applyLeave(employeeId: string, type: string, from: string, to: string, reason: string) {
  const f = new Date(from), t = new Date(to);
  if (!(t >= f)) throw new BizError("To-date must be on/after from-date");
  const days = Math.round((t.getTime() - f.getTime()) / 86400000) + 1;
  const emp = await one(`select manager_id, name from employee where id=$1`, [employeeId]);
  const r = await one(`insert into leave_request(employee_id, leave_type, from_date, to_date, days, reason, approver_id) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [employeeId, type, from, to, days, reason, emp?.manager_id ?? null]);
  if (emp?.manager_id) await notify([emp.manager_id], "Leave applied", `${emp.name}: ${type} ${from} → ${to} (${days} d)`, "/me#approvals");
  await audit(employeeId, "APPLY", "leave_request", r!.id, null, { type, from, to, days });
  return r!;
}

export async function decideLeave(id: string, approve: boolean, actorId: string, isHr: boolean) {
  return tx(async (c) => {
    const l = await one(`select * from leave_request where id=$1 for update`, [id], c);
    if (!l || l.status !== "PENDING") throw new BizError("Leave is not pending");
    if (l.approver_id !== actorId && !isHr) throw new BizError("Only the reporting manager or HR can decide");
    await c.query(`update leave_request set status=$2, decided_at=now(), approver_id=$3 where id=$1`, [id, approve ? "APPROVED" : "REJECTED", actorId]);
    if (approve)
      await c.query(`insert into attendance(employee_id, att_date, status, source, remarks, updated_by)
        select $1, d::date, 'L', 'MANUAL', $4, $5 from generate_series($2::date, $3::date, '1 day') d
        on conflict (employee_id, att_date) do update set status='L', remarks=excluded.remarks where attendance.check_in is null`,
        [l.employee_id, l.from_date, l.to_date, `Leave ${l.leave_type}`, actorId]);
    await notify([l.employee_id], `Leave ${approve ? "approved" : "rejected"}`, `${l.leave_type} ${l.from_date} → ${l.to_date}`, "/me", c);
    await audit(actorId, approve ? "APPROVE" : "REJECT", "leave_request", id, { status: "PENDING" }, { status: approve ? "APPROVED" : "REJECTED" }, c);
  });
}

export async function leaveBalances(employeeId: string, fyFrom: string) {
  return q(`select lt.code, lt.name, lt.annual_quota,
      coalesce((select sum(days) from leave_request lr where lr.employee_id=$1 and lr.leave_type=lt.code and lr.status='APPROVED' and lr.from_date >= $2),0) used
    from leave_type lt order by lt.code`, [employeeId, fyFrom]);
}

export { pool };
