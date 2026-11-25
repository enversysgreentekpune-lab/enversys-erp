// Demo data for operations: receipts & bills, Markal jobs and stock, dispatch, daily/field tasks,
// locations, expense claims, service-order milestones, completed historic orders and new clients.
// Uses the same engines as the app (lib/ops, lib/tasks, lib/workflow) so the data is consistent.
import fs from "node:fs";
import path from "node:path";
import { pool, q, one } from "../src/lib/db";
import { iso } from "../src/lib/period";
import { nextNo } from "../src/lib/numbering";
import { saveAttachment } from "../src/lib/attachments";
import { recordGrn, recordVendorBill, recordVendorPayment, issueMaterial, createDispatch, markDelivered, deployManpower, addSiteVisit, achieveMilestone } from "../src/lib/ops";
import * as T from "../src/lib/tasks";
import { decideApproval } from "../src/lib/workflow";

const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const img = (name: string) => fs.readFileSync(path.resolve("templates/demo", `${name}.jpg`));
const attach = (entity: string, entityId: string, file: string, as: string, docType: string | null, userId: string, folder = "08 Dispatch Documents") =>
  saveAttachment({ entity, entityId, fileName: as, buf: img(file), folder, docType: docType ?? undefined, userId });
const todayIst = () => iso(new Date(Date.now() + (330 + new Date().getTimezoneOffset()) * 60000));

/** Approved PO → material receipt (GRN) with challan photo → vendor bill → payment */
export async function receiveAndBill(po: any, wo: any, i: number, E: any, loc: any) {
  const lines = await q(`select * from po_line where po_id=$1`, [po.id]);
  const recd = daysAgo(Math.max(wo.age - 18, 2));
  const location = wo.v === "MFG" ? loc.MKL.id : wo.v === "OM" ? loc["SITE-SNR"].id : loc["SITE-RJN"].id;
  const g = await recordGrn(po.id, {
    lines: lines.map((l) => ({ poLineId: l.id, received: Number(l.qty), accepted: Number(l.qty) })), locationId: location, receivedDate: iso(recd),
    challanNo: `DC-${Math.floor(1000 + Math.random() * 8999)}`, challanDate: iso(recd), vehicleNo: "MH14 GT 4521", vendorInvoiceNo: `INV/${po.po_no.slice(-4)}`,
  }, E.store.id);
  await attach("grn", g.id, "vendor-challan", `Vendor challan ${g.grn_no}.jpg`, null, E.store.id, "05 Purchase Orders & Vendor Docs");
  const p = await one(`select * from purchase_order where id=$1`, [po.id]);
  const bill = await recordVendorBill({ poId: po.id, billNo: `VB-${po.po_no.slice(-4)}-${i + 1}`, billDate: iso(recd), taxable: Number(p.total), gst: Number(p.gst_total), grnId: g.id }, E.acc.id);
  await recordVendorPayment(bill.id, { amount: i % 2 === 0 ? Number(bill.total) : Math.round(Number(bill.total) * 0.5), payDate: iso(daysAgo(Math.max(wo.age - 40, 1))), mode: "NEFT", reference: `UTR${Math.floor(1e8 + Math.random() * 9e8)}` }, E.acm.id);
}

export async function seedJobsAndStores(E: any, loc: any, wos: any[]) {
  // Opening stock at Markal stores
  const opening: Record<string, number> = { "RM-SS304-PL6": 12000, "RM-SS304-PL10": 8000, "RM-SS-SHEET-3": 1500, "RM-MS-PL8": 6000, "RM-MS-SHEET-5": 5000, "RM-MS-ANGLE-65": 6000,
    "CON-WELD-E6013": 400, "CON-WELD-SS308": 140, "CON-GW-4": 130, "CON-CW-14": 60, "CON-PPE-KIT": 25, "CON-PAINT-EP": 300 };
  for (const [code, qty] of Object.entries(opening)) {
    const it = await one(`select id, standard_rate from item where code=$1`, [code]);
    await pool.query(`insert into stock_txn(item_id, location_id, txn_date, qty, rate, txn_type, ref, created_by) values ($1,$2,$3,$4,$5,'OPENING','Opening stock',$6)`, [it.id, loc.MKL.id, iso(daysAgo(70)), qty, it.standard_rate, E.store.id]);
  }
  // One job per tank: split multi-quantity tank jobs
  for (const j of await q(`select * from job_order where category='TANK' and qty > 1`)) {
    const n = Number(j.qty), w = Number(j.weight_kg) / n, b = Number(j.budget_cost) / n;
    await pool.query(`update job_order set qty=1, weight_kg=$2, budget_cost=$3, title=$4, project_item_code=$5 where id=$1`, [j.id, w, b, `${j.title} — 1 of ${n}`, `${j.project_item_code}/1`]);
    for (let k = 2; k <= n; k++)
      await pool.query(`insert into job_order(job_no, wo_id, wo_spec_line_id, project_item_code, category, title, qty, uom, weight_kg, budget_cost, target_date, created_by) values ($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10,$11)`,
        [await nextNo(pool, "JOB"), j.wo_id, j.wo_spec_line_id, `${j.project_item_code}/${k}`, j.category, `${j.title} — ${k} of ${n}`, j.uom, w, b, j.target_date, j.created_by]);
  }
  // Plan: [status, stage, pct, startDaysAgo, doneDaysAgo]
  const mfg = wos.filter((w) => w.v === "MFG").sort((a, b) => b.age - a.age);
  const prj = wos.find((w) => w.v === "PRJ");
  const plan: [string, any][] = [];
  const jobsOf = (wo: any) => q(`select * from job_order where wo_id=$1 order by project_item_code`, [wo.id]);
  if (mfg[0]) (await jobsOf(mfg[0])).forEach((j, k) => plan.push([j.id, [["COMPLETED", "DONE", 100, 40, 22], ["COMPLETED", "DONE", 100, 38, 15], ["COMPLETED", "DONE", 100, 30, 8], ["IN_PROGRESS", "WELDING", 70, 20, null]][k] ?? ["NEW", "PLANNING", 0, null, null]]));
  if (mfg[1]) (await jobsOf(mfg[1])).forEach((j, k) => plan.push([j.id, [["IN_PROGRESS", "CUTTING", 25, 6, null]][k] ?? ["NEW", "PLANNING", 0, null, null]]));
  if (prj) for (const j of await jobsOf(prj)) {
    const p = j.category === "SKID" ? ["COMPLETED", "DONE", 100, 35, 18] : j.category === "OTHER" ? ["COMPLETED", "DONE", 100, 28, 10] : j.category === "OWC_SKID" ? ["IN_PROGRESS", "ASSEMBLY", 55, 16, null] : ["NEW", "PLANNING", 0, null, null];
    plan.push([j.id, p]);
  }
  // Material issues for jobs that have started (before marking them complete)
  const MAT_SS: [string, number][] = [["RM-SS304-PL6", 0.6], ["RM-SS304-PL10", 0.45], ["CON-WELD-SS308", 0.012], ["CON-GW-4", 0.01], ["CON-CW-14", 0.0025]];
  const MAT_MS: [string, number][] = [["RM-MS-SHEET-5", 0.45], ["RM-MS-ANGLE-65", 0.5], ["CON-WELD-E6013", 0.015], ["CON-GW-4", 0.01], ["CON-CW-14", 0.0025], ["CON-PAINT-EP", 0.02]];
  for (const [jobId, [status, , pct, start]] of plan) {
    if (status === "NEW") continue;
    const j = await one(`select * from job_order where id=$1`, [jobId]);
    const kg = Number(j.weight_kg) * (Number(pct) / 100);
    const recipe = j.category === "TANK" ? MAT_SS : MAT_MS;
    let day = Number(start);
    for (const [code, factor] of recipe) {
      const it = await one(`select id from item where code=$1`, [code]);
      const qty = Math.max(1, Math.round(kg * factor * (code.startsWith("CON-GW") || code.startsWith("CON-CW") ? 1 : 1)));
      await issueMaterial({ jobId, itemId: it.id, locationId: loc.MKL.id, qty, date: iso(daysAgo(Math.max(day, 1))) }, E.store.id);
      day = Math.max(day - 2, 1);
    }
    const ppe = await one(`select id from item where code='CON-PPE-KIT'`);
    await issueMaterial({ jobId, itemId: ppe.id, locationId: loc.MKL.id, qty: 2, date: iso(daysAgo(Math.max(Number(start), 1))) }, E.store.id);
  }
  for (const [jobId, [status, stage, pct, start, done]] of plan)
    await pool.query(`update job_order set status=$2, stage=$3, pct=$4, start_date=$5, completed_at=$6, supervisor_id=$7, target_date=coalesce(target_date, current_date + 20) where id=$1`,
      [jobId, status, stage, pct, start == null ? null : iso(daysAgo(start)), done == null ? null : iso(daysAgo(done)), E.ps.id]);

  // Dispatch: 2 tanks delivered, 1 in transit (oldest manufacturing order); skid + platforms from the project
  const dispatchSet = async (wo: any, lines: { item: string; qty: number }[], ago: number, delivered: boolean, vehicle: string) => {
    const spec = await q(`select id, item_code from wo_spec_line where wo_id=$1`, [wo.id]);
    const d = await createDispatch(wo.id, { lines: lines.map((l) => ({ specLineId: spec.find((s) => s.item_code === l.item)!.id, qty: l.qty })), date: iso(daysAgo(ago)), vehicleNo: vehicle, transporter: "Shree Ganesh Roadlines",
      lrNo: `LR${Math.floor(10000 + Math.random() * 89999)}`, ewayBillNo: `3410${Math.floor(10000000 + Math.random() * 89999999)}`, invoiceNo: `ENV/INV/${wo.wo_no.slice(-4)}-${ago}`, freight: 18000 + ago * 300 }, E.fm.id);
    await attach("dispatch", d.id, "loading-photo", `Loading ${d.dispatch_no}.jpg`, "PHOTO", E.fm.id);
    await attach("dispatch", d.id, "delivery-challan", `Delivery challan ${d.dispatch_no}.jpg`, "DELIVERY_CHALLAN", E.fm.id);
    await attach("dispatch", d.id, "eway-bill", `E-way bill ${d.dispatch_no}.jpg`, "EWAY_BILL", E.fm.id);
    await attach("dispatch", d.id, "tax-invoice", `Invoice ${d.dispatch_no}.jpg`, "INVOICE", E.fm.id);
    if (delivered) {
      await markDelivered(d.id, { date: iso(daysAgo(Math.max(ago - 2, 0))), receivedBy: "Site in-charge (client)" }, E.fm.id);
      await attach("dispatch", d.id, "client-receipt", `Client received copy ${d.dispatch_no}.jpg`, "CLIENT_RECEIPT", E.fm.id);
    }
  };
  if (mfg[0]) { await dispatchSet(mfg[0], [{ item: "FB-TANK-SS10", qty: 2 }], 12, true, "MH12 KT 7788"); await dispatchSet(mfg[0], [{ item: "FB-TANK-SS10", qty: 1 }], 4, false, "MH14 LD 2231"); }
  if (prj) await dispatchSet(prj, [{ item: "FB-SKID-01", qty: 1 }, { item: "FB-PLAT-01", qty: 1 }, { item: "BO-BLOWER-TL", qty: 2 }], 7, false, "MH12 RS 5510");
}

export async function seedPeopleOps(E: any, loc: any, wos: any[], C: any[], leads: any[]) {
  const today = todayIst();
  // Today's attendance (morning check-ins) — a realistic day in progress
  const emps = await q(`select e.id, e.location_id, l.code loc, l.lat, l.lng, r.code role from employee e join location l on l.id=e.location_id join role r on r.id=e.role_id where e.is_active order by e.emp_code`);
  for (const [k, e] of emps.entries()) {
    if (k === 6) { await pool.query(`insert into attendance(employee_id, att_date, status, source) values ($1,$2,'A','MANUAL') on conflict do nothing`, [e.id, today]); continue; }
    if (k === 11 || k === 19) continue; // not marked yet
    const factory = e.loc === "MKL";
    const mins = (factory ? 8 * 60 + 15 : 9 * 60 + 12) + ((k * 7) % 25);
    const late = k % 9 === 4;
    const checkIn = new Date(`${today}T${String(Math.floor((mins + (late ? 30 : 0)) / 60)).padStart(2, "0")}:${String((mins + (late ? 30 : 0)) % 60).padStart(2, "0")}:00+05:30`);
    if (checkIn > new Date()) continue;
    await pool.query(`insert into attendance(employee_id, att_date, location_id, check_in, status, is_late, source) values ($1,$2,$3,$4,'P',$5,$6) on conflict do nothing`, [e.id, today, e.location_id, checkIn, late, factory ? "BIOMETRIC" : "GEO"]);
  }
  // Last known locations (check-in / app login)
  const jitter = (n: number, k: number) => Number(n) + (((k * 37) % 17) - 8) * 0.0009;
  for (const [k, e] of emps.entries()) {
    let lat = jitter(e.lat, k), lng = jitter(e.lng, k + 3);
    if (e.role === "SALES_ENGINEER") { lat = 18.5308 + k * 0.004; lng = 73.8475 - k * 0.003; }   // client meetings in Pune
    await pool.query(`insert into employee_location(employee_id, lat, lng, accuracy_m, source, at) values ($1,$2,$3,$4,$5, now() - ($6 || ' minutes')::interval) on conflict (employee_id) do nothing`,
      [e.id, lat, lng, 12 + (k % 20), k % 3 === 0 ? "LOGIN" : "CHECK_IN", String(15 + k * 11)]);
  }
  // Today's factory deployment: who works on which project code
  const wip = await q(`select id from job_order where status='IN_PROGRESS' order by job_no`);
  if (wip.length) {
    await deployManpower(E.fw1.id, today, [{ jobId: wip[0].id, hours: 8 }], E.ps.id);
    await deployManpower(E.fw2.id, today, [{ jobId: wip[Math.min(1, wip.length - 1)].id, hours: 8 }], E.ps.id);
    await deployManpower(E.ps.id, today, [{ jobId: wip[0].id, hours: 4 }, { jobId: wip[wip.length - 1].id, hours: 4 }], E.fm.id);
  }

  // Site visit report with photo on an open proposal
  const prop = await one(`select id, lead_id from proposal where status in ('IN_DISCUSSION','IN_NEGOTIATION') order by proposal_no limit 1`);
  if (prop) {
    const owner = await one(`select owner_id from proposal where id=$1`, [prop.id]);
    const v = await addSiteVisit(prop.id, { visitDate: iso(daysAgo(18)), location: "Customer plant — effluent collection sump", contact: "Plant engineer", lat: 18.7601, lng: 74.2391,
      observations: "Existing collection sump 6 x 4 x 3 m. Effluent pH 9.5–10, oil & grease visible. Space available for aeration tank on the east side (18 x 9 m). 415 V supply available within 40 m.",
      recommendations: "Add oil skimmer and pH correction before equalisation. Provide covered blower room. Revise blower sizing to 300 m3/h." }, owner.owner_id);
    await attach("site_visit", v.id, "site-photo", "Site survey photo.jpg", null, owner.owner_id, "01 Enquiry & RFQ");
  }

  // Daily task templates and the last 20 days of daily tasks
  const templates: [string, string, string][] = [
    ["fw1", "Daily: welding inspection checklist & job card update", "Update job card with welding done, rods used and NDT status"],
    ["fw2", "Daily: cutting plan & scrap record", "Record plates cut, offcuts returned to store and scrap weight"],
    ["ps", "Daily: shop-floor progress photo report", "Photograph each running job and update stage / % on the manufacturing board"],
    ["store", "Daily: material issue & receipt reconciliation", "Reconcile issues to jobs and GRNs with physical stock of fast-moving consumables"],
    ["site1", "Daily: site DPR with photos", "Manpower, work done, hindrances and photos of erection progress"],
    ["omt", "Daily: ETP log sheet", "Record flow, pH, DO, MLSS and chemical consumption"],
    ["se1", "Daily: follow up open enquiries", "Call or email every enquiry due for follow-up today"],
    ["est", "Daily: costing queue update", "Update status of proposals under estimation"],
  ];
  for (const [k, title, desc] of templates) await T.addTemplate(E[k].id, title, desc, [1, 2, 3, 4, 5, 6], E[k === "fw1" || k === "fw2" || k === "store" ? "fm" : k === "site1" ? "pm1" : k === "omt" ? "om" : k === "se1" || k === "est" ? "sm" : "fm"].id);
  for (let back = 20; back >= 0; back--) {
    const d = iso(daysAgo(back));
    await T.ensureDailyTasks(d);
  }
  const daily = await q(`select t.id, t.assigned_to, t.task_date, t.due_at from task t where t.kind='DAILY' and t.task_date < $1 order by t.task_date`, [today]);
  for (const [k, t] of daily.entries()) {
    const r = (k * 7919) % 100;
    if (r < 8) continue;                                  // lapsed (not done)
    const late = r < 18;
    const doneAt = new Date(new Date(t.due_at).getTime() + (late ? 14 : -3) * 3600000);
    const ev = r % 4 === 0 ? 0 : 1 + (r % 3);
    await pool.query(`update task set status='DONE', done_at=$2, completion_note=$3, evidence_count=$4, created_at=$5 where id=$1`,
      [t.id, doneAt, ev ? "Done as per checklist; photos attached." : "Done as per checklist.", ev, new Date(`${t.task_date}T08:00:00+05:30`)]);
  }

  // Field service tasks at each stage of the flow
  const cust = C.find((c) => c.name.startsWith("Alkyl")) ?? C[0];
  const prjWo = wos.find((w) => w.v === "PRJ"), omWo = wos.find((w) => w.v === "OM");
  const mk = (who: string, by: string, title: string, due: number, extra: any = {}) => T.createTask({ title, assignedTo: E[who].id, dueAt: daysAgo(due).toISOString(), priority: "HIGH", kind: "FIELD_SERVICE",
    customerId: cust.id, clientName: "Mr. Arvind Iyer", clientEmail: "projects@alkyl.example", clientMobile: "9822012345", siteAddress: "Kurkumbh MIDC, Daund", woId: omWo?.id ?? null, ...extra }, E[by].id);
  const done = await mk("omt", "om", "Quarterly PM of ETP blowers & diffusers", 6);
  await T.startTask(done.id, E.omt.id);
  await T.submitServiceReport(done.id, "Checked both blowers: belts re-tensioned, oil topped up. Replaced 6 clogged diffuser membranes. DO in aeration tank 2.1 mg/L after service. Recommend sludge wasting twice a week.", 2, E.omt.id);
  await attach("task", done.id, "service-report", "Signed job sheet.jpg", null, E.omt.id, "Service report");
  const otp1 = await T.reviewServiceReport(done.id, true, "Good report", E.om.id);
  if (otp1.devOtp) await T.verifyClientOtp(done.id, otp1.devOtp, E.omt.id);
  const awaiting = await mk("site1", "pm1", "Commissioning support: blower trial run", 2, { clientName: "Mr. Rajesh Kumar", clientEmail: "projects@thermax.example", clientMobile: "9822098765", siteAddress: "Ranjangaon MIDC", woId: prjWo?.id ?? null });
  await T.startTask(awaiting.id, E.site1.id);
  await T.submitServiceReport(awaiting.id, "Trial run of both blowers for 4 hours each. Current 11.8 A / 12.1 A, discharge 0.38 kg/cm2, no abnormal noise. Interlocks with DO probe verified.", 1, E.site1.id);
  await attach("task", awaiting.id, "site-photo", "Trial run photo.jpg", null, E.site1.id, "Service report");
  await T.reviewServiceReport(awaiting.id, true, "Approved — send to client", E.pm1.id);
  const toApprove = await mk("omt", "om", "Breakdown call: dosing pump not delivering", 1);
  await T.startTask(toApprove.id, E.omt.id);
  await T.submitServiceReport(toApprove.id, "Diaphragm of dosing pump P-301 torn. Replaced diaphragm and check valves from site spares. Calibrated to 6 LPH. Pump running normally.", 1, E.omt.id);
  const progress = await mk("site1", "pm1", "Install diffuser grid in aeration tank 2", -1, { clientName: "Mr. Rajesh Kumar", clientEmail: "projects@thermax.example", clientMobile: "9822098765", siteAddress: "Ranjangaon MIDC", woId: prjWo?.id ?? null });
  await T.startTask(progress.id, E.site1.id);
  await mk("omt", "om", "Monthly ETP performance report visit", 1);   // lapsed, not started
  await pool.query(`update task_update set created_at = created_at - interval '1 day' * (random() * 3)`);

  // Expense claims: two-step approval (reporting manager → accounts head)
  const claim = async (who: string, desc: string, amt: number, woId: string | null, headCentre: "WO" | "OFFICE_ADMIN", stage: 0 | 1 | 2) => {
    const emp = await one(`select id, manager_id from employee where id=$1`, [E[who].id]);
    const ce = await one(`insert into cost_entry(cost_centre, wo_id, category, expense_head, description, amount, entry_date, source_type, status, created_by) values ($1,$2,$3,'TRAVEL',$4,$5,$6,'EXPENSE_CLAIM','PENDING_APPROVAL',$7) returning id`,
      [headCentre, woId, headCentre === "WO" ? "TRAVEL" : "ADMIN", desc, amt, iso(daysAgo(4)), emp.id]);
    await attach("cost_entry", ce!.id, "tax-invoice", "Bill.jpg", null, emp.id, "11 Invoices & Payments");
    const a = await one(`insert into approval(entity, entity_id, doc_type, approver_role, approver_id, requested_by, value, step) values ('cost_entry',$1,'EXPENSE_CLAIM','REPORTING_MANAGER',$2,$3,$4,1) returning id`, [ce!.id, emp.manager_id, emp.id, amt]);
    if (stage >= 1) await decideApproval(a!.id, true, "OK", { id: emp.manager_id, roleCode: "PROJECT_MANAGER" });
    if (stage >= 2) { const a2 = await one(`select id from approval where entity_id=$1 and step=2`, [ce!.id]); await decideApproval(a2.id, true, "Verified with bill", { id: E.acm.id, roleCode: "ACCOUNTS_MANAGER" }); }
  };
  await claim("site1", "Site travel Pune–Ranjangaon & lodging (3 nights)", 6850, prjWo?.id ?? null, "WO", 0);
  await claim("omt", "Spares courier & local conveyance", 2340, omWo?.id ?? null, "WO", 1);
  await claim("se1", "Client visit travel — Baner to Chakan", 1450, null, "OFFICE_ADMIN", 2);

  // Service-order milestone achieved and waiting to be billed (shows in SO due list)
  const soMs = await one(`select m.id from milestone m join work_order w on w.id=m.wo_id where w.order_kind='SO' and m.status='PENDING' order by w.created_at desc, m.due_date limit 1`);
  if (soMs) { await achieveMilestone(soMs.id, "Monthly O&M report accepted by client", E.om.id); await pool.query(`update milestone set due_date=current_date - 3 where id=$1`, [soMs.id]); }

  // Completed historic orders (one PO, one SO) from last year — closed and fully paid
  const hist = async (kind: "PROJECT" | "OM", title: string, value: number, custIdx: number, vertical: string) => {
    const woNo = await nextNo(pool, "WORK_ORDER", daysAgo(250));
    const v = await one(`select id from vertical where code=$1`, [vertical]);
    const cpo = await one(`insert into customer_po(customer_id, po_no, po_date, po_value, created_by, order_kind) values ($1,$2,$3,$4,$5,$6) returning id`, [C[custIdx].id, `HIST-${Math.floor(1e5 + Math.random() * 9e5)}`, iso(daysAgo(330)), value, E.sm.id, kind === "OM" ? "SO" : "PO"]);
    const w = await one(`insert into work_order(wo_no, wo_type, title, customer_id, vertical_id, customer_po_id, contract_value, budget_cost, quoted_margin_pct, status, pct_complete, start_date, end_date, created_by, created_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,18,'CLOSED',100,$9,$10,$11,$12) returning id`, [woNo, kind, title, C[custIdx].id, v.id, cpo!.id, value, Math.round(value * 0.82), iso(daysAgo(325)), iso(daysAgo(120)), E.sm.id, daysAgo(330)]);
    await pool.query(`insert into wo_budget_line(wo_id, category, description, amount) values ($1,'MATERIAL','Historic',$2)`, [w!.id, Math.round(value * 0.82)]);
    await pool.query(`insert into cost_entry(cost_centre, wo_id, category, description, amount, entry_date, source_type, created_by) values ('WO',$1,'MATERIAL','Historic costs',$2,$3,'MANUAL',$4)`, [w!.id, Math.round(value * 0.8), iso(daysAgo(200)), E.acc.id]);
    const inv = await one(`insert into invoice(invoice_no, wo_id, customer_id, invoice_date, due_date, taxable, gst, total) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, total`,
      [await nextNo(pool, "INVOICE"), w!.id, C[custIdx].id, iso(daysAgo(150)), iso(daysAgo(120)), value, Math.round(value * 0.18), Math.round(value * 1.18)]);
    await pool.query(`insert into receipt(invoice_id, receipt_date, amount, mode) values ($1,$2,$3,'RTGS')`, [inv!.id, iso(daysAgo(118)), inv!.total]);
    await pool.query(`insert into milestone(wo_id, name, pct, amount, due_date, status, done_at) values ($1,'Final bill',100,$2,$3,'INVOICED',$3)`, [w!.id, value, iso(daysAgo(150))]);
  };
  await hist("PROJECT", "25 KLD STP — supply, erection & commissioning", 2850000, 6, "PRJ");
  await hist("OM", "AMC of 100 KLD ETP — FY 25-26", 960000, 3, "OM");

  // New clients this month with fresh enquiries
  const vPrj = await one(`select id from vertical where code='PRJ'`);
  for (const [k, [name, ind, title, val]] of ([["Kumar Urban Developers", "Real Estate", "OWC 1 TPD for residential township", 1850000], ["Sahyadri Hospitals – Hadapsar", "Hospitals", "60 KLD STP with tertiary treatment", 4200000]] as const).entries()) {
    const c = await one(`insert into customer(code, name, industry, owner_id, source, rating, created_by, created_at) values ($1,$2,$3,$4,'WEBSITE','B',$4,$5) returning id`,
      [await nextNo(pool, "CUSTOMER"), name, ind, E.se1.id, daysAgo(3 + k * 6)]);
    const ct = await one(`insert into contact(customer_id, name, designation, email, mobile, is_decision_maker) values ($1,$2,'Projects Head',$3,$4,true) returning id`, [c!.id, k ? "Dr. Meena Joshi" : "Mr. Vivek Kumar", k ? "projects@sahyadri.example" : "vivek@kumarurban.example", `98${22000000 + k * 1111}`]);
    const l = await one(`insert into lead(enquiry_no, enquiry_date, customer_id, contact_id, vertical_id, category, title, est_value, source, assigned_to, created_by, created_at, next_followup_at) values ($1,$2,$3,$4,$5,$6,$7,$8,'WEBSITE',$9,$9,$10, now() + interval '1 day') returning id`,
      [await nextNo(pool, "LEAD"), iso(daysAgo(3 + k * 6)), c!.id, ct!.id, vPrj.id, k ? "Sewage Treatment" : "OWC", title, val, E.se1.id, daysAgo(3 + k * 6)]);
    await pool.query(`insert into activity(entity, entity_id, kind, subject, body, created_by) values ('lead',$1,'SYSTEM','Enquiry received from website',$2,$3)`, [l!.id, title, E.se1.id]);
  }
  void leads;
}

/** Additional material requisitions: one approved (draft PO raised), one awaiting the proposal head */
export async function seedRequisitions(E: any) {
  const { raiseAdditionalRequisition } = await import("../src/lib/material");
  const wos = await q(`select id, wo_no from work_order where order_class in ('PO','SUPPLY') and status not in ('CLOSED','COMPLETED','CANCELLED') and exists (select 1 from purchase_order p where p.wo_id=work_order.id) order by wo_no limit 2`);
  if (!wos.length) return;
  const a = await raiseAdditionalRequisition(wos[0].id, { reason: "Client asked for additional inlet valve after site visit (drawing R2)",
    lines: [{ description: "Butterfly valve DN150 PN10, CI body", qty: 2, uom: "NOS", budgetRate: 14500 }, { description: "SS 304 flange DN150", qty: 4, uom: "NOS", budgetRate: 2200 }] }, E.pe.id);
  const ap = await one(`select id from approval where entity='purchase_requisition' and entity_id=$1`, [a.id]);
  await decideApproval(ap.id, true, "Approved — billable to client as variation", { id: E.sm.id, roleCode: "SALES_MANAGER" });
  await raiseAdditionalRequisition((wos[1] ?? wos[0]).id, { reason: "Extra MS angle for skid base stiffening after load check",
    lines: [{ description: "MS angle 65x65x6", qty: 0.4, uom: "MT", budgetRate: 68000 }] }, E.pe.id);
}
