// O&M field operations: daily operator log (presence, water treated, energy, chemicals, plant status),
// spares register, material & service requisitions, tickets (operator / client), monthly and visit
// reports for the client, and the all-sites dashboard.
import { one, q, tx, pool, type Db } from "./db";
import { nextNo } from "./numbering";
import { audit } from "./audit";
import { notify, idsByRole } from "./notify";
import { BizError } from "./workflow";
import { saveAttachment } from "./attachments";
import { sendMail } from "./email";
import { buildDoc, H, P, KV, GRID, SIGN, fmtDate, fmtNum, lbl } from "./reports";
import type { CurrentUser } from "./auth";
import { scopeOf, type Action, type ModuleCode } from "./rbac";

const can = (u: CurrentUser, m: ModuleCode, a: Action) => scopeOf(u.perms, m, a);

export const TICKET_CATEGORIES = ["OPERATION", "EQUIPMENT", "WATER_QUALITY", "MANPOWER", "SAFETY", "OTHER"] as const;
export const CHEMICALS = ["Sodium hypochlorite", "Alum", "PAC", "Polyelectrolyte", "Caustic soda", "HCl", "Antiscalant", "Nutrients (urea/DAP)"];
export const OM_MANAGERS = ["OM_MANAGER", "OM_SUPERVISOR"];

/** Company-wide O&M viewers (directors, O&M manager / supervisors) see every site; operators see their own */
export const seesAllSites = (u: CurrentUser) => can(u, "field_services", "view") === "company" || can(u, "dashboard_md", "view") === "company";
export async function siteIdsFor(u: CurrentUser, db: Db = pool): Promise<string[] | null> {
  if (seesAllSites(u)) return null;
  const r = await q(`select site_id from om_site_staff where employee_id=$1 union select id from om_site where supervisor_id=$1`, [u.id], db);
  return r.map((x) => x.site_id);
}
export async function assertSite(u: CurrentUser, siteId: string, db: Db = pool) {
  const ids = await siteIdsFor(u, db);
  if (ids && !ids.includes(siteId)) throw new BizError("You are not assigned to this site");
  const s = await one(`select s.*, c.name customer from om_site s join customer c on c.id=s.customer_id where s.id=$1`, [siteId], db);
  if (!s) throw new BizError("Site not found");
  return s;
}
const canDecide = (u: CurrentUser) => !!can(u, "field_services", "approve") || ["MD", "SUPER_ADMIN"].includes(u.roleCode);

// ---------------- Daily log ----------------------------------------------------------
export interface DailyLogIn {
  date: string; presentIds: string[]; waterTreated: number; energyKwh: number; status: "NORMAL" | "ISSUE" | "SHUTDOWN"; issueNote?: string;
  chemicals: { chemical: string; qty: number; uom?: string }[]; inletPh?: number | null; outletPh?: number | null; outletTss?: number | null; outletBod?: number | null; outletCod?: number | null; remarks?: string;
}
export async function saveDailyLog(u: CurrentUser, siteId: string, inp: DailyLogIn) {
  const site = await assertSite(u, siteId);
  if (!inp.date) throw new BizError("Date is required");
  if (inp.date > new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)) throw new BizError("A log cannot be entered for a future date");
  if (!(inp.waterTreated >= 0) || !(inp.energyKwh >= 0)) throw new BizError("Water treated and energy must be zero or more");
  if (!["NORMAL", "ISSUE", "SHUTDOWN"].includes(inp.status)) throw new BizError("Invalid plant status");
  if (inp.status !== "NORMAL" && !inp.issueNote?.trim()) throw new BizError("Describe the operation issue");
  for (const v of [inp.inletPh, inp.outletPh]) if (v != null && (v < 0 || v > 14)) throw new BizError("pH must be between 0 and 14");
  const staff = await q(`select employee_id from om_site_staff where site_id=$1`, [siteId]);
  const present = [...new Set(inp.presentIds)].filter((id) => staff.some((s) => s.employee_id === id));
  return tx(async (c) => {
    const log = await one(`insert into om_daily_log(site_id, log_date, operator_id, present_ids, present_count, water_treated_m3, energy_kwh, operation_status, issue_note, inlet_ph, outlet_ph, outlet_tss, outlet_bod, outlet_cod, remarks)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      on conflict (site_id, log_date) do update set operator_id=excluded.operator_id, present_ids=excluded.present_ids, present_count=excluded.present_count,
        water_treated_m3=excluded.water_treated_m3, energy_kwh=excluded.energy_kwh, operation_status=excluded.operation_status, issue_note=excluded.issue_note,
        inlet_ph=excluded.inlet_ph, outlet_ph=excluded.outlet_ph, outlet_tss=excluded.outlet_tss, outlet_bod=excluded.outlet_bod, outlet_cod=excluded.outlet_cod, remarks=excluded.remarks, updated_at=now()
      returning *, (xmax = 0) inserted`,
      [siteId, inp.date, u.id, present, present.length, inp.waterTreated, inp.energyKwh, inp.status, inp.issueNote || null, inp.inletPh ?? null, inp.outletPh ?? null, inp.outletTss ?? null, inp.outletBod ?? null, inp.outletCod ?? null, inp.remarks || null], c);
    await c.query(`delete from om_chemical_use where log_id=$1`, [log!.id]);
    for (const ch of inp.chemicals.filter((x) => x.chemical?.trim() && x.qty > 0))
      await c.query(`insert into om_chemical_use(log_id, chemical, qty, uom) values ($1,$2,$3,$4)`, [log!.id, ch.chemical.trim(), ch.qty, ch.uom || "KG"]);
    // An operation issue raises a ticket automatically (once per site per day)
    if (inp.status !== "NORMAL") {
      const open = await one(`select 1 from om_ticket where site_id=$1 and source='OPERATOR' and category='OPERATION' and created_at::date=$2::date`, [siteId, inp.date], c);
      if (!open) await createTicket(u, siteId, { source: "OPERATOR", category: "OPERATION", priority: inp.status === "SHUTDOWN" ? "CRITICAL" : "HIGH", title: `${inp.status === "SHUTDOWN" ? "Plant shutdown" : "Operation issue"} — ${site.name}`, description: inp.issueNote }, c);
    }
    if (present.length < site.required_manpower)
      await notify(site.supervisor_id ? [site.supervisor_id] : await idsByRole(OM_MANAGERS, c), `Manpower short at ${site.name}`, `${present.length} of ${site.required_manpower} present on ${inp.date}`, "/om", c);
    await audit(u.id, log!.inserted ? "CREATE" : "EDIT", "om_daily_log", log!.id, null, { site: site.code, date: inp.date, present: present.length, status: inp.status }, c);
    return log!;
  });
}

// ---------------- Spares -------------------------------------------------------------
export async function addSpare(u: CurrentUser, siteId: string, inp: { name: string; partNo?: string; uom?: string; qty?: number; minQty?: number }) {
  await assertSite(u, siteId);
  if (!inp.name?.trim()) throw new BizError("Spare name is required");
  return tx(async (c) => {
    const s = await one(`insert into om_spare(site_id, name, part_no, uom, min_qty) values ($1,$2,$3,$4,$5) on conflict (site_id, name) do update set part_no=coalesce(excluded.part_no, om_spare.part_no), min_qty=excluded.min_qty returning *`,
      [siteId, inp.name.trim(), inp.partNo || null, inp.uom || "NOS", inp.minQty ?? 0], c);
    if (inp.qty && inp.qty > 0) await spareMove(u, s!.id, "IN", inp.qty, "Opening stock", c);
    return s!;
  });
}
export async function spareMove(u: CurrentUser, spareId: string, kind: "IN" | "OUT", qty: number, note: string, db?: Db) {
  if (!(qty > 0)) throw new BizError("Quantity must be more than zero");
  const run = async (c: Db) => {
    const s = await one(`select * from om_spare where id=$1 for update`, [spareId], c);
    if (!s) throw new BizError("Spare not found");
    await assertSite(u, s.site_id, c);
    if (kind === "OUT" && Number(s.qty) < qty) throw new BizError(`Only ${fmtNum(s.qty)} ${s.uom} of ${s.name} in stock`);
    if (kind === "OUT" && !note?.trim()) throw new BizError("Say where the spare was used");
    await c.query(`insert into om_spare_txn(spare_id, kind, qty, note, created_by) values ($1,$2,$3,$4,$5)`, [spareId, kind, qty, note || null, u.id]);
    await c.query(`update om_spare set qty = qty ${kind === "IN" ? "+" : "-"} $2 where id=$1`, [spareId, qty]);
  };
  return db ? run(db) : tx(run);
}

// ---------------- Material & service requisitions -----------------------------------
export async function raiseOmRequisition(u: CurrentUser, siteId: string, inp: { kind: "MATERIAL" | "SERVICE"; lines: { description: string; qty: number; uom: string }[]; reason: string }) {
  const site = await assertSite(u, siteId);
  if (!["MATERIAL", "SERVICE"].includes(inp.kind)) throw new BizError("Choose material or service");
  const lines = inp.lines.filter((l) => l.description?.trim() && (inp.kind === "SERVICE" || l.qty > 0));
  if (!lines.length) throw new BizError("Add at least one item or service");
  if (!inp.reason?.trim()) throw new BizError("Give the reason");
  return tx(async (c) => {
    const no = await nextNo(c, "OM_REQ");
    const r = await one(`insert into om_requisition(req_no, site_id, kind, lines, reason, raised_by) values ($1,$2,$3,$4,$5,$6) returning *`, [no, siteId, inp.kind, JSON.stringify(lines), inp.reason.trim(), u.id], c);
    await notify(site.supervisor_id ? [site.supervisor_id, ...(await idsByRole(["OM_MANAGER"], c))] : await idsByRole(OM_MANAGERS, c), `${lbl(inp.kind)} requisition ${no}`, `${site.name}: ${inp.reason}`, "/om?tab=requisitions", c);
    await audit(u.id, "CREATE", "om_requisition", r!.id, null, { no, kind: inp.kind }, c);
    return r!;
  });
}
export async function decideOmRequisition(u: CurrentUser, id: string, status: "APPROVED" | "REJECTED" | "FULFILLED", note: string) {
  if (!canDecide(u)) throw new BizError("Only the O&M supervisor / manager can approve requisitions");
  const r = await one(`select * from om_requisition where id=$1`, [id]);
  if (!r) throw new BizError("Requisition not found");
  if (status === "FULFILLED" ? r.status !== "APPROVED" : r.status !== "PENDING") throw new BizError(`Requisition is ${r.status.toLowerCase()}`);
  if (status === "REJECTED" && !note?.trim()) throw new BizError("Give the reason for rejecting");
  await pool.query(`update om_requisition set status=$2, decided_by=$3, decided_at=now(), decision_note=coalesce($4, decision_note) where id=$1`, [id, status, u.id, note || null]);
  await notify([r.raised_by], `Requisition ${r.req_no} ${status.toLowerCase()}`, note || "", "/om?tab=requisitions");
  await audit(u.id, status, "om_requisition", id, { status: r.status }, { status, note });
}

// ---------------- Tickets ------------------------------------------------------------
export interface TicketIn { source: "OPERATOR" | "CLIENT"; clientName?: string; category: string; priority: string; title: string; description?: string }
export async function createTicket(u: CurrentUser, siteId: string, inp: TicketIn, db?: Db) {
  const run = async (c: Db) => {
    const site = await assertSite(u, siteId, c);
    if (!inp.title?.trim()) throw new BizError("Ticket title is required");
    if (!["OPERATOR", "CLIENT"].includes(inp.source)) throw new BizError("Invalid ticket source");
    if (inp.source === "CLIENT" && !inp.clientName?.trim()) throw new BizError("Enter who raised it at the client");
    const no = await nextNo(c, "OM_TICKET");
    const t = await one(`insert into om_ticket(ticket_no, site_id, source, raised_by, client_name, category, priority, title, description, assigned_to) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [no, siteId, inp.source, u.id, inp.clientName || null, inp.category || "OTHER", inp.priority || "MEDIUM", inp.title.trim(), inp.description || null, site.supervisor_id], c);
    await notify(site.supervisor_id ? [site.supervisor_id] : await idsByRole(OM_MANAGERS, c), `Ticket ${no} (${inp.source === "CLIENT" ? "client" : "operator"})`, `${site.name}: ${inp.title}`, `/om?tab=tickets`, c);
    await audit(u.id, "CREATE", "om_ticket", t!.id, null, { no, source: inp.source, priority: inp.priority }, c);
    return t!;
  };
  return db ? run(db) : tx(run);
}
export async function updateTicket(u: CurrentUser, id: string, inp: { status: string; resolution?: string; assignedTo?: string | null }) {
  const t = await one(`select * from om_ticket where id=$1`, [id]);
  if (!t) throw new BizError("Ticket not found");
  await assertSite(u, t.site_id);
  if (!["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"].includes(inp.status)) throw new BizError("Invalid status");
  if (t.status === "CLOSED") throw new BizError("Ticket is already closed");
  if (["RESOLVED", "CLOSED"].includes(inp.status) && !(inp.resolution?.trim() || t.resolution)) throw new BizError("Enter the resolution before resolving the ticket");
  if (inp.status === "CLOSED" && !canDecide(u) && t.source === "CLIENT") throw new BizError("Client tickets are closed by the O&M supervisor after the client confirms");
  await pool.query(`update om_ticket set status=$2, resolution=coalesce(nullif($3,''), resolution), assigned_to=coalesce($4, assigned_to),
      resolved_at=case when $2 in ('RESOLVED','CLOSED') then coalesce(resolved_at, now()) else null end, closed_at=case when $2='CLOSED' then now() else null end where id=$1`,
    [id, inp.status, inp.resolution ?? "", inp.assignedTo || null]);
  if (t.raised_by && t.raised_by !== u.id) await notify([t.raised_by], `Ticket ${t.ticket_no}: ${lbl(inp.status)}`, inp.resolution ?? "", "/om?tab=tickets");
  await audit(u.id, "UPDATE", "om_ticket", id, { status: t.status }, { status: inp.status });
}

// ---------------- Dashboard ----------------------------------------------------------
export async function omDashboard(siteIds: string[] | null, date: string) {
  const sites = await q(`select s.id, s.code, s.name, s.plant_type, s.capacity_kld, s.required_manpower, c.name customer, sup.name supervisor, s.client_email,
      l.present_count, l.operation_status, l.issue_note, l.water_treated_m3, l.energy_kwh, l.id log_id,
      (select count(*)::int from om_site_staff st where st.site_id=s.id) staff,
      (select count(*)::int from om_ticket t where t.site_id=s.id and t.status in ('OPEN','IN_PROGRESS')) open_tickets,
      (select count(*)::int from om_ticket t where t.site_id=s.id and t.status in ('OPEN','IN_PROGRESS') and t.priority in ('HIGH','CRITICAL')) urgent_tickets,
      (select coalesce(sum(water_treated_m3),0) from om_daily_log x where x.site_id=s.id and x.log_date >= date_trunc('month', $2::date)) water_month,
      (select coalesce(sum(energy_kwh),0) from om_daily_log x where x.site_id=s.id and x.log_date >= date_trunc('month', $2::date)) energy_month,
      (select count(*)::int from om_spare sp where sp.site_id=s.id and sp.qty <= sp.min_qty) low_spares
    from om_site s join customer c on c.id=s.customer_id left join employee sup on sup.id=s.supervisor_id
    left join om_daily_log l on l.site_id=s.id and l.log_date=$2
    where s.is_active and ($1::uuid[] is null or s.id = any($1)) order by s.name`, [siteIds, date]);
  const rows = sites.map((s) => ({ ...s, manpowerIssue: !s.log_id || Number(s.present_count) < Number(s.required_manpower), operationIssue: (s.operation_status && s.operation_status !== "NORMAL") || s.urgent_tickets > 0 }));
  const tk = await one(`select count(*) filter (where source='OPERATOR')::int by_operator, count(*) filter (where source='CLIENT')::int by_client,
      count(*) filter (where status in ('OPEN','IN_PROGRESS'))::int open, count(*) filter (where status in ('RESOLVED','CLOSED'))::int closed,
      count(*) filter (where status in ('OPEN','IN_PROGRESS') and source='CLIENT')::int open_client
    from om_ticket where ($1::uuid[] is null or site_id = any($1))`, [siteIds]);
  return {
    rows, tickets: tk!,
    totals: {
      sites: rows.length, required: rows.reduce((a, r) => a + Number(r.required_manpower), 0), present: rows.reduce((a, r) => a + Number(r.present_count ?? 0), 0),
      manpowerIssues: rows.filter((r) => r.manpowerIssue).length, operationIssues: rows.filter((r) => r.operationIssue).length, notLogged: rows.filter((r) => !r.log_id).length,
      waterToday: rows.reduce((a, r) => a + Number(r.water_treated_m3 ?? 0), 0), waterMonth: rows.reduce((a, r) => a + Number(r.water_month), 0), energyMonth: rows.reduce((a, r) => a + Number(r.energy_month), 0),
    },
  };
}

// ---------------- Documents for the client ------------------------------------------
async function company() { return one(`select * from company limit 1`); }

export async function ticketResolutionDoc(ticketId: string) {
  const t = await one(`select t.*, s.name site, s.code site_code, c.name customer, e.name raised_name, a.name assigned_name
    from om_ticket t join om_site s on s.id=t.site_id join customer c on c.id=s.customer_id left join employee e on e.id=t.raised_by left join employee a on a.id=t.assigned_to where t.id=$1`, [ticketId]);
  if (!t) throw new BizError("Ticket not found");
  const buf = await buildDoc(await company(), "Complaint Resolution Report", `${t.ticket_no} · ${t.site}`, [
    KV([["Ticket", t.ticket_no], ["Client / site", `${t.customer} — ${t.site}`], ["Raised by", t.source === "CLIENT" ? `${t.client_name} (client)` : `${t.raised_name} (Enversys operator)`],
      ["Raised on", fmtDate(t.created_at)], ["Category / priority", `${lbl(t.category)} / ${lbl(t.priority)}`], ["Status", lbl(t.status)], ["Resolved on", fmtDate(t.resolved_at)], ["Attended by", t.assigned_name ?? "—"]]),
    H("Complaint"), P(t.title, { bold: true }), P(t.description || "—"),
    H("Resolution"), P(t.resolution || "Resolution pending."),
    SIGN(["For Enversys", "O&M supervisor"], [`For ${t.customer}`, "Client representative"]),
  ]);
  return { buf, name: `${t.ticket_no.replace(/\//g, "-")} Resolution.docx` };
}

export async function monthlyReportDoc(siteId: string, period: string) {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new BizError("Choose a month");
  const from = `${period}-01`;
  const s = await one(`select s.*, c.name customer, sup.name supervisor from om_site s join customer c on c.id=s.customer_id left join employee sup on sup.id=s.supervisor_id where s.id=$1`, [siteId]);
  if (!s) throw new BizError("Site not found");
  const [logs, chem, tickets, spares, reqs] = await Promise.all([
    q(`select * from om_daily_log where site_id=$1 and log_date >= $2::date and log_date < ($2::date + interval '1 month') order by log_date`, [siteId, from]),
    q(`select cu.chemical, cu.uom, sum(cu.qty) qty from om_chemical_use cu join om_daily_log l on l.id=cu.log_id where l.site_id=$1 and l.log_date >= $2::date and l.log_date < ($2::date + interval '1 month') group by 1,2 order by 1`, [siteId, from]),
    q(`select * from om_ticket where site_id=$1 and created_at >= $2::date and created_at < ($2::date + interval '1 month') order by created_at`, [siteId, from]),
    q(`select sp.name, sp.uom, sp.qty, coalesce(sum(t.qty) filter (where t.kind='OUT'),0) used from om_spare sp left join om_spare_txn t on t.spare_id=sp.id and t.txn_date >= $2::date and t.txn_date < ($2::date + interval '1 month') where sp.site_id=$1 group by sp.id order by sp.name`, [siteId, from]),
    q(`select req_no, kind, status, reason from om_requisition where site_id=$1 and created_at >= $2::date and created_at < ($2::date + interval '1 month') order by created_at`, [siteId, from]),
  ]);
  const days = logs.length, water = logs.reduce((a, l) => a + Number(l.water_treated_m3), 0), energy = logs.reduce((a, l) => a + Number(l.energy_kwh), 0);
  const normal = logs.filter((l) => l.operation_status === "NORMAL").length;
  const avg = (k: string) => { const v = logs.filter((l) => l[k] != null).map((l) => Number(l[k])); return v.length ? fmtNum(v.reduce((a, b) => a + b, 0) / v.length, 1) : "—"; };
  const monthName = new Date(`${from}T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const buf = await buildDoc(await company(), "Monthly O&M Report", `${s.name} · ${monthName}`, [
    KV([["Client", s.customer], ["Site", `${s.name} (${s.code})`], ["Plant", `${s.plant_type}${s.capacity_kld ? `, ${fmtNum(s.capacity_kld, 0)} KLD` : ""}`], ["Month", monthName], ["O&M supervisor", s.supervisor ?? "—"]]),
    H("Performance summary"),
    GRID(["Days logged", "Water treated (m³)", "Average per day (m³)", "Capacity utilisation", "Energy (kWh)", "kWh per m³", "Days in normal operation"], [[
      days, fmtNum(water, 0), days ? fmtNum(water / days, 0) : "—", s.capacity_kld && days ? `${fmtNum((water / days / Number(s.capacity_kld)) * 100, 0)}%` : "—", fmtNum(energy, 0), water ? fmtNum(energy / water, 2) : "—", `${normal} of ${days}`]]),
    H("Treated water quality (monthly average)"), GRID(["Inlet pH", "Outlet pH", "Outlet TSS (mg/l)", "Outlet BOD (mg/l)", "Outlet COD (mg/l)"], [[avg("inlet_ph"), avg("outlet_ph"), avg("outlet_tss"), avg("outlet_bod"), avg("outlet_cod")]]),
    H("Chemical consumption"), GRID(["Chemical", "Quantity"], chem.map((c) => [c.chemical, `${fmtNum(c.qty)} ${c.uom}`])),
    H("Daily log"), GRID(["Date", "Manpower", "Water (m³)", "Energy (kWh)", "Status", "Remarks"], logs.map((l) => [fmtDate(l.log_date), `${l.present_count}/${s.required_manpower}`, fmtNum(l.water_treated_m3, 0), fmtNum(l.energy_kwh, 0), lbl(l.operation_status), l.issue_note ?? l.remarks ?? ""]), [14, 12, 14, 14, 12, 34]),
    H("Complaints and tickets"), GRID(["Ticket", "Raised by", "Complaint", "Status", "Resolution"], tickets.map((t) => [t.ticket_no, t.source === "CLIENT" ? `Client — ${t.client_name}` : "Operator", t.title, lbl(t.status), t.resolution ?? ""])),
    H("Spares"), GRID(["Spare", "Used this month", "In stock"], spares.map((x) => [x.name, `${fmtNum(x.used)} ${x.uom}`, `${fmtNum(x.qty)} ${x.uom}`])),
    H("Material and service requisitions"), GRID(["Requisition", "Type", "Reason", "Status"], reqs.map((r) => [r.req_no, lbl(r.kind), r.reason, lbl(r.status)])),
    SIGN(["For Enversys", "O&M supervisor"], [`For ${s.customer}`, "Client representative"]),
  ]);
  return { buf, name: `${s.code} O&M Report ${period}.docx`, site: s };
}

export async function addVisitReport(u: CurrentUser, siteId: string, inp: { date: string; observations: string; recommendations?: string }) {
  await assertSite(u, siteId);
  if (!inp.date || !inp.observations?.trim()) throw new BizError("Visit date and observations are required");
  const r = await one(`insert into om_report(site_id, kind, visit_date, visited_by, observations, recommendations) values ($1,'VISIT',$2,$3,$4,$5) returning *`, [siteId, inp.date, u.id, inp.observations.trim(), inp.recommendations || null]);
  await audit(u.id, "CREATE", "om_report", r!.id, null, { kind: "VISIT", date: inp.date });
  return r!;
}
export async function visitReportDoc(reportId: string) {
  const r = await one(`select r.*, s.name site, s.code, s.plant_type, s.capacity_kld, c.name customer, e.name visitor from om_report r join om_site s on s.id=r.site_id join customer c on c.id=s.customer_id left join employee e on e.id=r.visited_by where r.id=$1 and r.kind='VISIT'`, [reportId]);
  if (!r) throw new BizError("Visit report not found");
  const [log, open] = await Promise.all([
    one(`select * from om_daily_log where site_id=$1 and log_date=$2`, [r.site_id, r.visit_date]),
    q(`select ticket_no, title, status from om_ticket where site_id=$1 and status in ('OPEN','IN_PROGRESS') order by created_at`, [r.site_id]),
  ]);
  const buf = await buildDoc(await company(), "Site Visit Report", `${r.site} · ${fmtDate(r.visit_date)}`, [
    KV([["Client", r.customer], ["Site", `${r.site} (${r.code})`], ["Plant", `${r.plant_type}${r.capacity_kld ? `, ${fmtNum(r.capacity_kld, 0)} KLD` : ""}`], ["Visit date", fmtDate(r.visit_date)], ["Visited by", r.visitor ?? "—"]]),
    H("Plant on the day"), log ? GRID(["Manpower", "Water treated (m³)", "Energy (kWh)", "Status", "Outlet pH / TSS / BOD"], [[log.present_count, fmtNum(log.water_treated_m3, 0), fmtNum(log.energy_kwh, 0), lbl(log.operation_status), [log.outlet_ph, log.outlet_tss, log.outlet_bod].map((v) => v ?? "—").join(" / ")]]) : P("No daily log for the visit date."),
    H("Observations"), P(r.observations), H("Recommendations"), P(r.recommendations || "—"),
    H("Open points"), GRID(["Ticket", "Issue", "Status"], open.map((t) => [t.ticket_no, t.title, lbl(t.status)])),
    SIGN(["For Enversys", r.visitor ?? "Visiting engineer"], [`For ${r.customer}`, "Client representative"]),
  ]);
  return { buf, name: `${r.code} Visit Report ${String(r.visit_date instanceof Date ? r.visit_date.toISOString() : r.visit_date).slice(0, 10)}.docx`, report: r };
}

/** Saves the monthly or visit report to the site file and emails it to the client */
export async function submitReport(u: CurrentUser, inp: { siteId: string; kind: "MONTHLY" | "VISIT"; period?: string; reportId?: string; to: string }) {
  const site = await assertSite(u, inp.siteId);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(inp.to?.trim() ?? "")) throw new BizError("Enter the client's email address");
  const doc = inp.kind === "MONTHLY" ? await monthlyReportDoc(inp.siteId, inp.period ?? "") : await visitReportDoc(inp.reportId ?? "");
  const att = await saveAttachment({ entity: "om_site", entityId: inp.siteId, fileName: doc.name, buf: doc.buf, folder: "O&M Reports", docType: `OM_${inp.kind}_REPORT`, userId: u.id });
  await sendMail({ to: inp.to.trim(), sentBy: u.id, attachmentIds: [att.id],
    subject: `${site.name}: ${inp.kind === "MONTHLY" ? `O&M report for ${inp.period}` : "Site visit report"}`,
    html: `<p>Dear Sir / Madam,</p><p>Please find attached the ${inp.kind === "MONTHLY" ? `monthly O&M report for ${inp.period}` : "site visit report"} for ${site.name}.</p><p>Regards,<br/>${u.name}<br/>Enversys O&M</p>` });
  if (inp.kind === "MONTHLY") {
    await pool.query(`insert into om_report(site_id, kind, period, attachment_id, submitted_at, submitted_to, submitted_by) values ($1,'MONTHLY',$2,$3,now(),$4,$5)`, [inp.siteId, inp.period, att.id, inp.to.trim(), u.id]);
  } else await pool.query(`update om_report set attachment_id=$2, submitted_at=now(), submitted_to=$3, submitted_by=$4 where id=$1`, [inp.reportId, att.id, inp.to.trim(), u.id]);
  await audit(u.id, "SUBMIT_REPORT", "om_site", inp.siteId, null, { kind: inp.kind, period: inp.period, to: inp.to });
  return att;
}
