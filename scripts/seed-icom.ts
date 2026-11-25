// Demo data for Installation & Commissioning (after dispatch) and O&M field operations.
// Uses the same engines as the app (lib/ic, lib/om) so documents, tickets and dashboards are consistent.
import fs from "node:fs";
import path from "node:path";
import { pool, q, one } from "../src/lib/db";
import { iso } from "../src/lib/period";
import { expandMatrix } from "../src/lib/rbac";
import { saveAttachment } from "../src/lib/attachments";
import * as IC from "../src/lib/ic";
import * as OM from "../src/lib/om";
import type { CurrentUser } from "../src/lib/auth";

const daysAgo = (n: number) => { const d = new Date(Date.now() + (330 + new Date().getTimezoneOffset()) * 60000); d.setDate(d.getDate() - n); return d; };
const img = (name: string) => fs.readFileSync(path.resolve("templates/demo", `${name}.jpg`));
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const between = (a: number, b: number) => a + rnd() * (b - a);

async function asUser(id: string): Promise<CurrentUser> {
  const e = await one(`select e.*, r.code role, r.name role_name from employee e join role r on r.id=e.role_id where e.id=$1`, [id]);
  return { id: e.id, name: e.name, mobile: e.mobile, email: e.email, empCode: e.emp_code, roleCode: e.role, roleName: e.role_name, verticalId: e.vertical_id, verticalName: null,
    departmentId: e.department_id, locationId: e.location_id, managerId: e.manager_id, perms: expandMatrix(e.role), teamIds: [], sessionId: "seed", hasPin: false } as CurrentUser;
}

export async function seedIcOm(E: Record<string, any>, C: any[]) {
  await seedIc(E);
  await seedOm(E, C);
}

// ---------------- I&C ----------------
async function seedIc(E: Record<string, any>) {
  const projects = await q(`select ic.id, w.id wid, w.wo_no, w.wo_type, c.id cid from ic_project ic join work_order w on w.id=ic.wo_id join customer c on c.id=w.customer_id order by w.created_at`);
  const prj = projects.find((p) => p.wo_type === "PROJECT"), mfg = projects.find((p) => p.wo_type === "MANUFACTURING");
  const evidence = async (updateId: string, file: string, name: string, docType = "IC_EVIDENCE") =>
    saveAttachment({ entity: "ic_update", entityId: updateId, fileName: name, buf: img(file), folder: "09 I&C and Handover", docType, userId: E.site1.id });
  const step = async (icId: string, ago: number, stage: string, pct: number, activity: string, o: { photo?: boolean; signed?: string; manpower?: number; issues?: string } = {}) => {
    const u = await IC.addIcUpdate(icId, { date: iso(daysAgo(ago)), stage, pct, activity, manpower: o.manpower ?? 4, issues: o.issues, clientSigned: !!o.signed, clientRep: o.signed }, E.site1.id);
    if (o.photo) await evidence(u.id, "site-photo", `Site photo ${iso(daysAgo(ago))}.jpg`);
    if (o.signed) await evidence(u.id, "service-report", `Client-signed report ${iso(daysAgo(ago))}.jpg`, IC.IC_DOCS.clientReport);
  };
  const actor = { id: E.pm1.id, name: "Kiran Bhosale" };

  if (prj) {   // project: installation in progress
    await IC.setIcDetails(prj.id, { engineerId: E.site1.id, siteAddress: "Plot D-12, MIDC Ranjangaon, Pune", targetDate: iso(daysAgo(-21)) }, E.pm1.id);
    await step(prj.id, 6, "MATERIAL_AT_SITE", 10, "Skid, platforms and blowers received at site and checked against packing list. Civil foundations inspected.", { photo: true });
    await step(prj.id, 4, "ERECTION", 25, "Chemical dosing skid placed on foundation, levelled and anchored. Platform erection started.", { photo: true, manpower: 6 });
    await step(prj.id, 1, "ERECTION", 40, "Platforms and pipe supports erected. Blower installation 50% complete. Joint inspection with client.", { photo: true, signed: "Mr. Arvind Iyer, Plant Engineer", manpower: 6, issues: "Crane availability delayed blower lifting by one day" });
  }
  if (mfg) {   // supply: commissioned, documents sent, handover signed, appreciation awaited
    await pool.query(`update ic_project set engineer_id=$2, site_address='Godrej Infinity site, Hinjewadi Phase 2, Pune', target_date=$3 where id=$1`, [mfg.id, E.site1.id, iso(daysAgo(2))]);
    await step(mfg.id, 10, "MATERIAL_AT_SITE", 15, "Two SS304 tanks received at site in good condition.", { photo: true });
    await step(mfg.id, 8, "ERECTION", 50, "Tanks placed on RCC pedestals, levelled and anchored; nozzles oriented as per GA drawing.", { photo: true, manpower: 5 });
    await step(mfg.id, 5, "COMMISSIONING", 80, "Hydro test of both tanks at 1.5x working pressure for 2 hours — no leakage.", { signed: "Ms. Vandana Pillai, Projects Manager", photo: true });
    await step(mfg.id, 3, "HANDOVER", 100, "Third tank installed and tested. Punch points closed. Plant handed over for operation.", { signed: "Ms. Vandana Pillai, Projects Manager", photo: true });
    await IC.generateHandoverDocs(mfg.id, E.pm1.id);
    const ct = await one(`select email from contact where customer_id=$1 and email is not null order by is_decision_maker desc limit 1`, [mfg.cid]);
    await IC.sendHandoverDocs(mfg.id, ct?.email ?? "projects@client.example", undefined, "Thank you for your support during installation.", actor);
    const a = await saveAttachment({ entity: "ic_project", entityId: mfg.id, fileName: "Signed handover certificate.jpg", buf: img("client-receipt"), folder: "09 I&C and Handover", docType: IC.IC_DOCS.signedHandover, userId: E.pm1.id });
    await IC.recordSignedCertificate(mfg.id, "HANDOVER", a.id, E.pm1.id);
  }
  // historic project: fully handed over and completed last year
  const hist = await one(`select w.id, c.id cid from work_order w join customer c on c.id=w.customer_id where w.wo_type='PROJECT' and w.status='CLOSED' order by w.created_at limit 1`);
  if (hist) {
    await pool.query(`insert into ic_project(wo_id, engineer_id, site_address) values ($1,$2,'Customer site, Pune') on conflict do nothing`, [hist.id, E.site1.id]);
    const h = await one(`select id from ic_project where wo_id=$1`, [hist.id]);
    await step(h.id, 160, "ERECTION", 40, "STP equipment erected.", { photo: true });
    await step(h.id, 140, "TRIAL_RUN", 85, "Seeding and trial run completed; outlet BOD below 10 mg/l.", { signed: "Mr. Sunil Mane, Facility Head" });
    await step(h.id, 130, "HANDOVER", 100, "Performance demonstrated and plant handed over.", { signed: "Mr. Sunil Mane, Facility Head" });
    await IC.generateHandoverDocs(h.id, E.pm1.id);
    const ct = await one(`select email from contact where customer_id=$1 and email is not null limit 1`, [hist.cid]);
    await IC.sendHandoverDocs(h.id, ct?.email ?? "projects@client.example", undefined, undefined, actor);
    for (const [kind, file] of [["HANDOVER", "client-receipt"], ["APPRECIATION", "service-report"]] as const) {
      const a = await saveAttachment({ entity: "ic_project", entityId: h.id, fileName: `Signed ${kind.toLowerCase()} certificate.jpg`, buf: img(file), folder: "09 I&C and Handover", docType: kind === "HANDOVER" ? IC.IC_DOCS.signedHandover : IC.IC_DOCS.signedAppreciation, userId: E.pm1.id });
      await IC.recordSignedCertificate(h.id, kind, a.id, E.pm1.id);
    }
    await pool.query(`update ic_project set completed_at=now() - interval '125 days', docs_sent_at=now() - interval '128 days', docs_generated_at=now() - interval '129 days' where id=$1`, [h.id]);
    await pool.query(`update ic_update set created_at = update_date where ic_id=$1`, [h.id]);
  }
}

// ---------------- O&M ----------------
const SITES = [
  { code: "OM-ALK", name: "Alkyl Amines — 200 KLD ETP", cust: 7, type: "ETP", kld: 200, req: 2, sup: "omsc", ops: ["op1", "op2"], lat: 18.4985, lng: 74.6402, wo: "Alkyl" },
  { code: "OM-TML", name: "Tata Motors — CETP", cust: 1, type: "CETP", kld: 1000, req: 3, sup: "omvm", ops: ["op3", "op4"], lat: 18.6298, lng: 73.8131, wo: "Tata" },
  { code: "OM-MHL", name: "Mahindra Lifespaces — 300 KLD STP", cust: 2, type: "STP", kld: 300, req: 2, sup: "omrc", ops: ["op5", "op6"], lat: 18.5793, lng: 73.7389 },
  { code: "OM-GDJ", name: "Godrej Hinjewadi — 250 KLD STP", cust: 6, type: "STP", kld: 250, req: 2, sup: "omap", ops: ["op7", "op8"], lat: 18.5912, lng: 73.7380 },
  { code: "OM-RJN", name: "MIDC Ranjangaon — 2.5 MLD CETP", cust: 8, type: "CETP", kld: 2500, req: 3, sup: "omaj", ops: ["op9", "op10", "omt"], lat: 18.7550, lng: 74.2420 },
];
const CHEM: Record<string, [string, number, number, string][]> = {
  STP: [["Sodium hypochlorite", 8, 15, "L"], ["Polyelectrolyte", 0.4, 1, "KG"]],
  ETP: [["Alum", 35, 60, "KG"], ["Caustic soda", 15, 30, "KG"], ["Polyelectrolyte", 1.5, 3, "KG"]],
  CETP: [["Alum", 120, 200, "KG"], ["Polyelectrolyte", 5, 9, "KG"], ["Sodium hypochlorite", 30, 50, "L"]],
};
const SPARES: [string, string, string, number, number][] = [
  ["Diffuser membrane 9 in", "DM-9", "NOS", 24, 8], ["Blower V-belt B-52", "VB-B52", "NOS", 6, 2], ["Pump mechanical seal 32 mm", "MS-32", "NOS", 4, 1],
  ["Dosing pump diaphragm", "DPD-10", "NOS", 4, 1], ["pH electrode", "PHE-1", "NOS", 2, 1], ["Bag filter 25 micron", "BF-25", "NOS", 20, 6],
];

async function seedOm(E: Record<string, any>, C: any[]) {
  const today = iso(daysAgo(0));
  const woOf = async (k?: string) => (k ? (await one(`select w.id from work_order w join customer c on c.id=w.customer_id where w.wo_type='OM' and w.status<>'CLOSED' and c.name ilike $1 limit 1`, [`${k}%`]))?.id : null) ?? null;
  const sites: any[] = [];
  for (const s of SITES) {
    const loc = await one(`insert into location(code, name, kind, lat, lng, geofence_m, shift_start, shift_end) values ($1,$2,'SITE',$3,$4,400,'08:00','20:00') returning id`, [s.code, `O&M: ${s.name}`, s.lat, s.lng]);
    const ct = await one(`select email, name from contact where customer_id=$1 order by is_decision_maker desc limit 1`, [C[s.cust].id]);
    const row = await one(`insert into om_site(code, name, customer_id, wo_id, location_id, plant_type, capacity_kld, required_manpower, supervisor_id, client_contact, client_email)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`, [s.code, s.name, C[s.cust].id, await woOf(s.wo), loc!.id, s.type, s.kld, s.req, E[s.sup].id, ct?.name, ct?.email]);
    for (const o of s.ops) {
      await pool.query(`insert into om_site_staff(site_id, employee_id, duty) values ($1,$2,'OPERATOR')`, [row!.id, E[o].id]);
      await pool.query(`update employee set location_id=$2 where id=$1`, [E[o].id, loc!.id]);
    }
    sites.push({ ...s, ...row });
  }

  // 30 days of daily reports (direct inserts for history); today's reports through the app engine
  for (const s of sites) {
    for (let d = 30; d >= 1; d--) {
      const date = iso(daysAgo(d));
      const staff = s.ops.map((o: string) => E[o].id);
      const present = staff.filter(() => rnd() > 0.08);
      const issue = rnd() < 0.06;
      const water = Math.round(s.kld * between(0.72, 0.95));
      const log = await one(`insert into om_daily_log(site_id, log_date, operator_id, present_ids, present_count, water_treated_m3, energy_kwh, operation_status, issue_note, inlet_ph, outlet_ph, outlet_tss, outlet_bod, outlet_cod, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$2::date + time '20:00') returning id`,
        [s.id, date, staff[0], present, present.length, water, Math.round(water * between(s.type === "STP" ? 0.55 : 0.8, s.type === "STP" ? 0.75 : 1.1)), issue ? "ISSUE" : "NORMAL",
          issue ? "Sludge carry-over in clarifier; desludging done" : null, between(6.4, 8.2).toFixed(1), between(6.8, 7.8).toFixed(1), Math.round(between(8, 28)), Math.round(between(5, 18)), Math.round(between(40, 95))]);
      for (const [chem, lo, hi, uom] of CHEM[s.type === "CETP" ? "CETP" : s.type]) await pool.query(`insert into om_chemical_use(log_id, chemical, qty, uom) values ($1,$2,$3,$4)`, [log!.id, chem, (between(lo, hi) * (s.kld > 1000 ? 2 : 1)).toFixed(1), uom]);
    }
  }
  const users: Record<string, CurrentUser> = {};
  for (const k of ["omsc", "omvm", "omrc", "omap", "omaj", "op1", "op3", "op5", "op7", "op9", "om"]) users[k] = await asUser(E[k].id);
  const todays: [number, string, number, "NORMAL" | "ISSUE" | "SHUTDOWN", string?][] = [
    [0, "op1", 2, "NORMAL"], [1, "op3", 2, "NORMAL"], [2, "op5", 2, "NORMAL"], [3, "op7", 2, "ISSUE", "Blower-2 tripped on overload; aeration on single blower, DO dropped to 1.2 mg/l"],
  ];
  for (const [i, opKey, presentN, status, note] of todays) {
    const s = sites[i];
    const present = s.ops.slice(0, presentN).map((o: string) => E[o].id);
    for (const pid of present) await pool.query(`insert into attendance(employee_id, att_date, location_id, check_in, source, status) values ($1,$2,$3,now() - interval '6 hours','MANUAL','P') on conflict (employee_id, att_date) do nothing`, [pid, today, s.location_id]);
    const water = Math.round(s.kld * between(0.75, 0.9));
    await OM.saveDailyLog(users[opKey], s.id, { date: today, presentIds: present, waterTreated: water, energyKwh: Math.round(water * 0.7), status, issueNote: note,
      chemicals: CHEM[s.type === "CETP" ? "CETP" : s.type].map(([chemical, lo, hi, uom]) => ({ chemical, qty: Number(between(lo, hi).toFixed(1)), uom })), inletPh: 7.4, outletPh: 7.2, outletTss: 18, outletBod: 12, outletCod: 64, remarks: "" });
  }

  // Spares register with movements
  for (const s of sites) {
    for (const [name, partNo, uom, qty, min] of SPARES) {
      const sp = await OM.addSpare(users[s.sup], s.id, { name, partNo, uom, qty, minQty: min });
      if (rnd() < 0.4) await OM.spareMove(users[s.sup], sp.id, "OUT", Math.max(1, Math.round(qty * between(0.1, 0.4))), "Replaced during preventive maintenance");
    }
  }

  // A couple of spares run low (shows in the dashboard and the monthly report)
  for (const [si, name] of [[3, "Blower V-belt B-52"], [4, "pH electrode"]] as const) {
    const sp = await one(`select id, qty, min_qty from om_spare where site_id=$1 and name=$2`, [sites[si].id, name]);
    const use = Number(sp.qty) - Number(sp.min_qty);
    if (use > 0) await OM.spareMove(users[sites[si].sup], sp.id, "OUT", use, "Breakdown replacement");
  }

  // Tickets by operators and clients, open and closed
  const tickets: [number, string, "OPERATOR" | "CLIENT", string, string, string, string, number, "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED", string?][] = [
    [1, "op3", "OPERATOR", "EQUIPMENT", "HIGH", "Raw effluent pump P-2 mechanical seal leaking", "Seal leaking since morning; standby pump in service.", 6, "CLOSED", "Mechanical seal replaced from site spares; pump tested for 2 hours."],
    [1, "omvm", "CLIENT", "WATER_QUALITY", "HIGH", "Treated water turbidity high", "Client EHS reported hazy treated water in garden line.", 4, "RESOLVED", "Pressure sand filter backwashed and media topped up; turbidity now 3 NTU. Backwash frequency increased to daily."],
    [0, "op1", "OPERATOR", "OPERATION", "MEDIUM", "Alum stock low — 2 days left", "", 3, "CLOSED", "Material requisition raised and 500 kg received."],
    [0, "omsc", "CLIENT", "OPERATION", "MEDIUM", "Odour near equalisation tank", "Reported by client admin during morning round.", 1, "IN_PROGRESS"],
    [2, "omrc", "CLIENT", "OTHER", "LOW", "Request for monthly lab analysis report", "Client asked for third-party lab report for last month.", 9, "CLOSED", "NABL lab report shared by email on the 5th."],
    [2, "op5", "OPERATOR", "SAFETY", "MEDIUM", "Handrail loose at clarifier walkway", "", 2, "OPEN"],
    [3, "omap", "CLIENT", "WATER_QUALITY", "CRITICAL", "Foul smell in flushing water", "Residents complained of smell in flushing water in Tower C.", 0, "OPEN"],
    [4, "op9", "OPERATOR", "MANPOWER", "HIGH", "Third operator not deployed for night shift", "Night shift running with 2 operators.", 2, "OPEN"],
    [4, "omaj", "CLIENT", "EQUIPMENT", "MEDIUM", "Flow meter not displaying", "", 12, "CLOSED", "Flow meter transmitter replaced under warranty; calibration certificate submitted."],
  ];
  for (const [si, by, source, category, priority, title, description, ago, status, resolution] of tickets) {
    const t = await OM.createTicket(users[by], sites[si].id, { source, clientName: source === "CLIENT" ? sites[si].client_contact ?? "Client" : undefined, category, priority, title, description });
    await pool.query(`update om_ticket set created_at = now() - make_interval(days => $2) where id=$1`, [t.id, ago]);
    if (status !== "OPEN") await OM.updateTicket(users[sites[si].sup], t.id, { status: status === "CLOSED" ? "RESOLVED" : status, resolution });
    if (status === "CLOSED") await OM.updateTicket(users[sites[si].sup], t.id, { status: "CLOSED" });
    if (status === "CLOSED" || status === "RESOLVED") await pool.query(`update om_ticket set resolved_at = created_at + interval '20 hours', closed_at = case when status='CLOSED' then created_at + interval '30 hours' end where id=$1`, [t.id]);
  }

  // Material & service requisitions
  const r1 = await OM.raiseOmRequisition(users.op1, sites[0].id, { kind: "MATERIAL", reason: "Alum stock low — 2 days left", lines: [{ description: "Alum (ferric free)", qty: 500, uom: "KG" }, { description: "Polyelectrolyte (anionic)", qty: 25, uom: "KG" }] });
  await OM.decideOmRequisition(users.omsc, r1.id, "APPROVED", "Order on regular vendor");
  await OM.decideOmRequisition(users.omsc, r1.id, "FULFILLED", "Received at site");
  const r2 = await OM.raiseOmRequisition(users.op3, sites[1].id, { kind: "SERVICE", reason: "Raw effluent pump P-1 vibration high", lines: [{ description: "Pump overhaul and alignment by OEM service engineer", qty: 1, uom: "JOB" }] });
  await OM.decideOmRequisition(users.omvm, r2.id, "APPROVED", "OEM visit scheduled Friday");
  await OM.raiseOmRequisition(users.op7, sites[3].id, { kind: "MATERIAL", reason: "Blower-2 belt worn out, tripping on overload", lines: [{ description: "Blower V-belt B-52", qty: 4, uom: "NOS" }] });
  await OM.raiseOmRequisition(users.op9, sites[4].id, { kind: "SERVICE", reason: "Quarterly lab analysis due", lines: [{ description: "NABL lab sampling and analysis — inlet & outlet", qty: 1, uom: "JOB" }] });

  // Site visit reports and last month's report submitted to the client
  const v1 = await OM.addVisitReport(users.omsc, sites[0].id, { date: iso(daysAgo(5)), observations: "Plant running normally. Log books up to date. Housekeeping good. Clarifier sludge blanket at 0.8 m.", recommendations: "Replace pH electrode within 2 weeks. Paint handrails before monsoon." });
  await OM.submitReport(users.omsc, { siteId: sites[0].id, kind: "VISIT", reportId: v1.id, to: sites[0].client_email ?? "client@example.com" });
  await OM.addVisitReport(users.omap, sites[3].id, { date: iso(daysAgo(1)), observations: "Blower-2 belt slipping; aeration DO 1.2 mg/l on single blower. Odour near collection sump.", recommendations: "Replace blower belts (requisition raised). Increase sludge wasting to 15 m³/day." });
  const lastMonth = (() => { const d = daysAgo(0); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();
  for (const i of [0, 2]) await OM.submitReport(users[sites[i].sup], { siteId: sites[i].id, kind: "MONTHLY", period: lastMonth, to: sites[i].client_email ?? "client@example.com" });
}
