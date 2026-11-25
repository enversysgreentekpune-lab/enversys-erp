// Operations engine: stores (GRN, stock, issues), vendor bills & payments, manufacturing jobs & manpower,
// dispatch, customer invoicing. Pure DB logic (no request context) — used by actions, seed and tests.
import { one, q, tx, type Db } from "./db";
import { nextNo } from "./numbering";
import { audit } from "./audit";
import { notify, idsByRole } from "./notify";
import { BizError } from "./workflow";
import { submitDwr } from "./hr";

const r2 = (n: number) => Math.round(n * 100) / 100;

// ---------------- Material receipt (GRN) -------------------------------------------
export interface GrnLineIn { poLineId: string; received: number; accepted: number }
export async function recordGrn(poId: string, inp: { lines: GrnLineIn[]; locationId: string; receivedDate?: string; challanNo?: string; challanDate?: string; vehicleNo?: string; vendorInvoiceNo?: string; remarks?: string }, actorId: string) {
  return tx(async (c) => {
    const po = await one(`select * from purchase_order where id=$1 for update`, [poId], c);
    if (!po) throw new BizError("PO not found");
    if (!["APPROVED", "SENT", "PARTIAL"].includes(po.status)) throw new BizError(`Material can be received only against an approved PO (this one is ${po.status})`);
    const lines = inp.lines.filter((l) => Number(l.received) > 0);
    if (!lines.length) throw new BizError("Enter the received quantity for at least one line");
    if (!inp.challanNo?.trim()) throw new BizError("Delivery challan number is required");
    let anyRejected = false;
    const grnNo = await nextNo(c, "GRN");
    const g = await one(`insert into grn(grn_no, po_id, vendor_id, wo_id, location_id, received_date, challan_no, challan_date, vehicle_no, vendor_invoice_no, remarks, received_by)
      values ($1,$2,$3,$4,$5,coalesce($6::date,current_date),$7,$8,$9,$10,$11,$12) returning *`,
      [grnNo, poId, po.vendor_id, po.wo_id, inp.locationId, inp.receivedDate || null, inp.challanNo, inp.challanDate || null, inp.vehicleNo || null, inp.vendorInvoiceNo || null, inp.remarks || null, actorId], c);
    for (const l of lines) {
      const pl = await one(`select pl.*, coalesce((select sum(qty_accepted) from grn_line gl where gl.po_line_id=pl.id),0) done from po_line pl where pl.id=$1 and pl.po_id=$2`, [l.poLineId, poId], c);
      if (!pl) throw new BizError("PO line not found");
      const accepted = Math.min(Number(l.accepted), Number(l.received));
      if (accepted < 0) throw new BizError("Accepted quantity cannot be negative");
      if (Number(pl.done) + accepted > Number(pl.qty) * 1.05) throw new BizError(`${pl.description}: receiving more than ordered (ordered ${pl.qty}, already received ${pl.done})`);
      if (accepted < Number(l.received)) anyRejected = true;
      await c.query(`insert into grn_line(grn_id, po_line_id, qty_received, qty_accepted, qty_rejected, rate) values ($1,$2,$3,$4,$5,$6)`,
        [g!.id, l.poLineId, l.received, accepted, Number(l.received) - accepted, pl.rate]);
      const item = pl.item_code ? await one(`select id from item where code=$1`, [pl.item_code], c) : null;
      if (item && accepted > 0)
        await c.query(`insert into stock_txn(item_id, location_id, txn_date, qty, rate, txn_type, wo_id, grn_id, ref, created_by) values ($1,$2,coalesce($3::date,current_date),$4,$5,'GRN',$6,$7,$8,$9)`,
          [item.id, inp.locationId, inp.receivedDate || null, accepted, pl.rate, po.wo_id, g!.id, grnNo, actorId]);
      if (item) await c.query(`update item set last_purchase_rate=$2 where id=$1`, [item.id, pl.rate]);
    }
    const bal = await one(`select bool_and(coalesce((select sum(qty_accepted) from grn_line gl where gl.po_line_id=pl.id),0) >= pl.qty * 0.999) full from po_line pl where pl.po_id=$1`, [poId], c);
    await c.query(`update purchase_order set status=$2 where id=$1`, [poId, bal?.full ? "RECEIVED" : "PARTIAL"]);
    if (anyRejected) await c.query(`update grn set status='PARTIAL_ACCEPTED' where id=$1`, [g!.id]);
    await notify(await idsByRole(["PURCHASE_MANAGER"], c), `Material received: ${po.po_no}`, `${grnNo} · challan ${inp.challanNo}${anyRejected ? " · some quantity rejected" : ""}`, `/purchase/${poId}`, c);
    await audit(actorId, "CREATE", "grn", g!.id, null, { grn_no: grnNo, po: po.po_no, lines: lines.length }, c);
    return g!;
  });
}

// ---------------- Vendor bills & payments -------------------------------------------
export async function recordVendorBill(inp: { poId: string; billNo: string; billDate: string; dueDate?: string; taxable: number; gst: number; grnId?: string | null }, actorId: string) {
  if (!inp.billNo?.trim() || !inp.billDate || !(inp.taxable > 0)) throw new BizError("Bill no., date and amount are required");
  return tx(async (c) => {
    const po = await one(`select * from purchase_order where id=$1`, [inp.poId], c);
    if (!po?.vendor_id) throw new BizError("PO not found or has no vendor");
    const billed = await one(`select coalesce(sum(taxable),0) s from vendor_bill where po_id=$1`, [po.id], c);
    if (Number(billed!.s) + inp.taxable > Number(po.total) * 1.02) throw new BizError(`Bills would exceed the PO value (₹${Math.round(po.total).toLocaleString("en-IN")}); already billed ₹${Math.round(billed!.s).toLocaleString("en-IN")}`);
    const b = await one(`insert into vendor_bill(bill_no, vendor_id, po_id, wo_id, grn_id, bill_date, due_date, taxable, gst, total, created_by)
      values ($1,$2,$3,$4,$5,$6,coalesce($7::date, $6::date + 30),$8,$9,$10,$11) returning *`,
      [inp.billNo.trim(), po.vendor_id, po.id, po.wo_id, inp.grnId || null, inp.billDate, inp.dueDate || null, inp.taxable, inp.gst, r2(inp.taxable + inp.gst), actorId], c);
    // the bill turns committed cost into actual cost on the project
    await c.query(`insert into cost_entry(cost_centre, wo_id, category, description, amount, gst_amount, entry_date, source_type, source_id, vendor_id, status, created_by)
      values ('WO',$1,'MATERIAL',$2,$3,$4,$5,'VENDOR_BILL',$6,$7,'POSTED',$8)`, [po.wo_id, `Bill ${inp.billNo} · ${po.po_no}`, inp.taxable, inp.gst, inp.billDate, b!.id, po.vendor_id, actorId]);
    await c.query(`update cost_entry set amount = greatest($2::numeric - $3::numeric, 0) where source_type='PURCHASE_ORDER' and source_id=$1 and status='COMMITTED'`, [po.id, po.total, Number(billed!.s) + inp.taxable]);
    await audit(actorId, "CREATE", "vendor_bill", b!.id, null, { bill_no: inp.billNo, po: po.po_no, total: b!.total }, c);
    return b!;
  });
}

export async function recordVendorPayment(billId: string, inp: { amount: number; payDate: string; mode?: string; reference?: string }, actorId: string) {
  return tx(async (c) => {
    const b = await one(`select b.*, coalesce((select sum(amount) from vendor_payment p where p.bill_id=b.id),0) paid from vendor_bill b where b.id=$1 for update`, [billId], c);
    if (!b) throw new BizError("Bill not found");
    if (!(inp.amount > 0)) throw new BizError("Amount must be positive");
    if (Number(b.paid) + inp.amount > Number(b.total) + 0.5) throw new BizError(`Payment exceeds the balance due (₹${Math.round(b.total - b.paid).toLocaleString("en-IN")})`);
    const p = await one(`insert into vendor_payment(bill_id, pay_date, amount, mode, reference, created_by) values ($1,$2,$3,$4,$5,$6) returning *`, [billId, inp.payDate, inp.amount, inp.mode || null, inp.reference || null, actorId], c);
    await audit(actorId, "CREATE", "vendor_payment", p!.id, null, { bill: b.bill_no, amount: inp.amount }, c);
    return p!;
  });
}

// ---------------- Stores ---------------------------------------------------------
export async function stockOf(itemId: string, locationId: string, db?: Db) {
  const r = await one(`select coalesce(sum(qty),0) qty, coalesce(sum(qty*rate) filter (where qty>0) / nullif(sum(qty) filter (where qty>0),0), 0) avg_rate from stock_txn where item_id=$1 and location_id=$2`, [itemId, locationId], db);
  return { qty: Number(r!.qty), avgRate: Number(r!.avg_rate) };
}

/** Issue material from store to a manufacturing job: reduces stock and posts material cost to the job's project */
export async function issueMaterial(inp: { jobId: string; itemId: string; locationId: string; qty: number; date?: string }, actorId: string) {
  if (!(inp.qty > 0)) throw new BizError("Quantity must be positive");
  return tx(async (c) => {
    const job = await one(`select j.*, w.wo_no from job_order j join work_order w on w.id=j.wo_id where j.id=$1`, [inp.jobId], c);
    if (!job) throw new BizError("Job not found");
    if (job.status === "COMPLETED") throw new BizError("Job is already completed");
    const item = await one(`select * from item where id=$1`, [inp.itemId], c);
    const st = await stockOf(inp.itemId, inp.locationId, c);
    if (st.qty < inp.qty) throw new BizError(`Only ${st.qty} ${item.uom} of ${item.description} in stock at this location`);
    const rate = r2(st.avgRate || Number(item.last_purchase_rate ?? item.standard_rate ?? 0));
    await c.query(`insert into stock_txn(item_id, location_id, txn_date, qty, rate, txn_type, wo_id, job_id, ref, created_by) values ($1,$2,coalesce($3::date,current_date),$4,$5,'ISSUE',$6,$7,$8,$9)`,
      [inp.itemId, inp.locationId, inp.date || null, -inp.qty, rate, job.wo_id, job.id, job.job_no, actorId]);
    await c.query(`insert into cost_entry(cost_centre, wo_id, job_id, category, expense_head, description, amount, entry_date, source_type, created_by)
      values ('WO',$1,$2,'FABRICATION',$3,$4,$5,coalesce($6::date,current_date),'MATERIAL_ISSUE',$7)`,
      [job.wo_id, job.id, item.material_group, `${item.description}: ${inp.qty} ${item.uom} → ${job.job_no}`, r2(inp.qty * rate), inp.date || null, actorId]);
    if (job.status === "NEW") await c.query(`update job_order set status='IN_PROGRESS', start_date=coalesce(start_date, current_date) where id=$1`, [job.id]);
    await audit(actorId, "ISSUE", "stock_txn", job.id, null, { item: item.code, qty: inp.qty, rate, job: job.job_no }, c);
    const left = st.qty - inp.qty;
    if (item.reorder_level != null && left < Number(item.reorder_level))
      await notify(await idsByRole(["STOREKEEPER", "PURCHASE_MANAGER"], c), `Low stock: ${item.description}`, `${left} ${item.uom} left (reorder level ${item.reorder_level})`, "/store?tab=low", c);
  });
}

// ---------------- Manufacturing jobs -------------------------------------------
export const JOB_STAGES = ["PLANNING", "CUTTING", "FABRICATION", "WELDING", "ASSEMBLY", "TESTING", "PAINTING", "PACKING", "DONE"];

export async function updateJob(jobId: string, inp: { stage?: string; pct?: number; status?: string; weightKg?: number; supervisorId?: string | null; targetDate?: string | null }, actorId: string) {
  return tx(async (c) => {
    const j = await one(`select * from job_order where id=$1 for update`, [jobId], c);
    if (!j) throw new BizError("Job not found");
    const status = inp.status ?? (inp.pct === 100 || inp.stage === "DONE" ? "COMPLETED" : Number(inp.pct ?? j.pct) > 0 ? "IN_PROGRESS" : j.status);
    if (inp.pct != null && (inp.pct < 0 || inp.pct > 100)) throw new BizError("Progress must be 0–100");
    await c.query(`update job_order set stage=coalesce($2, stage), pct=coalesce($3, pct), status=$4, weight_kg=coalesce($5, weight_kg), supervisor_id=coalesce($6, supervisor_id), target_date=coalesce($7::date, target_date),
        start_date = case when $4 <> 'NEW' then coalesce(start_date, current_date) else start_date end,
        completed_at = case when $4='COMPLETED' then coalesce(completed_at, current_date) else null end where id=$1`,
      [jobId, inp.stage ?? null, status === "COMPLETED" ? 100 : inp.pct ?? null, status, inp.weightKg ?? null, inp.supervisorId ?? null, inp.targetDate ?? null]);
    if (status === "COMPLETED" && j.status !== "COMPLETED") {
      const pm = await q(`select employee_id from wo_team where wo_id=$1 and team_role='PM'`, [j.wo_id], c);
      await notify([...pm.map((x) => x.employee_id), ...(await idsByRole(["QA_INSPECTOR", "DISPATCH_INCHARGE"], c))], `Job completed: ${j.job_no}`, `${j.title} (${j.project_item_code}) is ready for inspection & dispatch`, "/manufacturing", c);
    }
    await audit(actorId, "EDIT", "job_order", jobId, { stage: j.stage, pct: j.pct, status: j.status }, { stage: inp.stage, pct: inp.pct, status }, c);
  });
}

/** Supervisor deploys a worker on jobs for a day; stored as that worker's DWR so labour is costed once */
export async function deployManpower(employeeId: string, date: string, entries: { jobId: string; hours: number }[], actorId: string) {
  const lines = [];
  for (const e of entries.filter((x) => Number(x.hours) > 0)) {
    const j = await one(`select j.id, j.wo_id, j.job_no, j.title from job_order j where j.id=$1`, [e.jobId]);
    if (!j) throw new BizError("Job not found");
    lines.push({ woId: j.wo_id, jobId: j.id, hours: Number(e.hours), description: `${j.job_no} · ${j.title}` });
  }
  if (!lines.length) throw new BizError("Enter hours for at least one job");
  await submitDwr(employeeId, date, `Deployed at Markal on ${lines.map((l) => l.description.split(" · ")[0]).join(", ")}`, "", lines);
  await audit(actorId, "DEPLOY", "employee", employeeId, null, { date, jobs: lines.map((l) => l.description) });
}

// ---------------- Dispatch -------------------------------------------------------
export async function createDispatch(woId: string, inp: { lines: { specLineId: string; qty: number }[]; date?: string; vehicleNo?: string; transporter?: string; lrNo?: string; ewayBillNo?: string; invoiceNo?: string; dcNo?: string; freight?: number; remarks?: string }, actorId: string) {
  return tx(async (c) => {
    const wo = await one(`select * from work_order where id=$1`, [woId], c);
    if (!wo) throw new BizError("Project not found");
    const lines = inp.lines.filter((l) => Number(l.qty) > 0);
    if (!lines.length) throw new BizError("Enter the quantity to dispatch for at least one item");
    if (!inp.vehicleNo?.trim()) throw new BizError("Vehicle number is required");
    for (const l of lines) {
      const s = await one(`select s.*, coalesce((select sum(qty) from dispatch_line dl where dl.wo_spec_line_id=s.id),0) sent from wo_spec_line s where s.id=$1 and s.wo_id=$2`, [l.specLineId, woId], c);
      if (!s) throw new BizError("Item not in this project");
      if (Number(s.sent) + Number(l.qty) > Number(s.qty) + 0.0001) throw new BizError(`${s.description}: dispatching more than the order quantity (ordered ${s.qty}, already sent ${s.sent})`);
    }
    const no = await nextNo(c, "DISPATCH");
    const d = await one(`insert into dispatch(dispatch_no, wo_id, dispatch_date, vehicle_no, transporter, lr_no, eway_bill_no, invoice_no, delivery_challan_no, freight, remarks, created_by)
      values ($1,$2,coalesce($3::date,current_date),$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
      [no, woId, inp.date || null, inp.vehicleNo, inp.transporter || null, inp.lrNo || null, inp.ewayBillNo || null, inp.invoiceNo || null, inp.dcNo || no, inp.freight || 0, inp.remarks || null, actorId], c);
    for (const l of lines) await c.query(`insert into dispatch_line(dispatch_id, wo_spec_line_id, qty) values ($1,$2,$3)`, [d!.id, l.specLineId, l.qty]);
    if (inp.freight && inp.freight > 0)
      await c.query(`insert into cost_entry(cost_centre, wo_id, category, description, amount, entry_date, source_type, source_id, created_by) values ('WO',$1,'FREIGHT',$2,$3,coalesce($4::date,current_date),'DISPATCH',$5,$6)`,
        [woId, `Freight ${no} · ${inp.vehicleNo}`, inp.freight, inp.date || null, d!.id, actorId]);
    if (wo.order_class !== "WO") await c.query(`insert into ic_project(wo_id) values ($1) on conflict (wo_id) do nothing`, [woId]); // enters I&C automatically
    const pm = await q(`select employee_id from wo_team where wo_id=$1 and team_role='PM'`, [woId], c);
    await notify([...pm.map((x) => x.employee_id), ...(await idsByRole(["ACCOUNTS_MANAGER"], c))], `Dispatched: ${wo.wo_no}`, `${no} · vehicle ${inp.vehicleNo}`, `/dispatch?project=${woId}`, c);
    await audit(actorId, "CREATE", "dispatch", d!.id, null, { dispatch_no: no, project: wo.wo_no, lines: lines.length }, c);
    return d!;
  });
}

export async function markDelivered(dispatchId: string, inp: { date: string; receivedBy: string }, actorId: string) {
  if (!inp.receivedBy?.trim()) throw new BizError("Enter who received the material at site");
  const d = await one(`update dispatch set status='DELIVERED', delivered_date=$2, received_by_name=$3 where id=$1 and status='DISPATCHED' returning *`, [dispatchId, inp.date, inp.receivedBy]);
  if (!d) throw new BizError("Dispatch not found or already delivered");
  await audit(actorId, "DELIVERED", "dispatch", dispatchId, null, inp);
  return d;
}

// ---------------- Customer invoicing (milestones / SO billing) -------------------------
export async function raiseInvoice(woId: string, inp: { milestoneId?: string | null; taxable?: number; gstPct?: number; date?: string; dueDays?: number }, actorId: string) {
  return tx(async (c) => {
    const wo = await one(`select * from work_order where id=$1`, [woId], c);
    if (!wo) throw new BizError("Project not found");
    let taxable = Number(inp.taxable ?? 0);
    if (inp.milestoneId) {
      const m = await one(`select * from milestone where id=$1 and wo_id=$2 for update`, [inp.milestoneId, woId], c);
      if (!m) throw new BizError("Milestone not found");
      if (m.status === "INVOICED") throw new BizError("This milestone is already invoiced");
      taxable = taxable || Number(m.amount);
    }
    if (!(taxable > 0)) throw new BizError("Invoice amount must be positive");
    const billed = await one(`select coalesce(sum(taxable),0) s from invoice where wo_id=$1`, [woId], c);
    if (Number(billed!.s) + taxable > Number(wo.contract_value) + 1) throw new BizError(`Invoice would exceed the order value; unbilled balance is ₹${Math.round(wo.contract_value - billed!.s).toLocaleString("en-IN")}`);
    const gst = r2((taxable * (inp.gstPct ?? 18)) / 100);
    const no = await nextNo(c, "INVOICE");
    const inv = await one(`insert into invoice(invoice_no, wo_id, customer_id, invoice_date, due_date, taxable, gst, total, milestone_id)
      values ($1,$2,$3,coalesce($4::date,current_date),coalesce($4::date,current_date) + $5::int,$6,$7,$8,$9) returning *`,
      [no, woId, wo.customer_id, inp.date || null, inp.dueDays ?? 30, taxable, gst, r2(taxable + gst), inp.milestoneId || null], c);
    if (inp.milestoneId) await c.query(`update milestone set status='INVOICED', done_at=coalesce(done_at, current_date) where id=$1`, [inp.milestoneId]);
    await audit(actorId, "CREATE", "invoice", inv!.id, null, { invoice_no: no, project: wo.wo_no, taxable, gst }, c);
    return inv!;
  });
}

export async function recordReceipt(invoiceId: string, inp: { amount: number; date: string; mode?: string }, actorId: string) {
  return tx(async (c) => {
    const i = await one(`select i.*, coalesce((select sum(amount) from receipt r where r.invoice_id=i.id),0) recd from invoice i where i.id=$1 for update`, [invoiceId], c);
    if (!i) throw new BizError("Invoice not found");
    if (!(inp.amount > 0) || Number(i.recd) + inp.amount > Number(i.total) + 0.5) throw new BizError(`Amount must be between ₹1 and the outstanding ₹${Math.round(i.total - i.recd).toLocaleString("en-IN")}`);
    const r = await one(`insert into receipt(invoice_id, receipt_date, amount, mode) values ($1,$2,$3,$4) returning *`, [invoiceId, inp.date, inp.amount, inp.mode || "NEFT"], c);
    await audit(actorId, "CREATE", "receipt", r!.id, null, { invoice: i.invoice_no, amount: inp.amount }, c);
    return r!;
  });
}

export async function achieveMilestone(milestoneId: string, note: string, actorId: string) {
  const m = await one(`update milestone set status='DONE', done_at=current_date, achieved_note=$2 where id=$1 and status='PENDING' returning *`, [milestoneId, note || null]);
  if (!m) throw new BizError("Milestone is not pending");
  await notify(await idsByRole(["ACCOUNTS_MANAGER"]), "Milestone achieved — ready to bill", m.name, "/accounts", undefined);
  await audit(actorId, "ACHIEVED", "milestone", milestoneId, null, { note });
  return m;
}

// ---------------- Site visit report ------------------------------------------------
export async function addSiteVisit(proposalId: string, inp: { visitDate: string; location?: string; contact?: string; observations: string; recommendations?: string; lat?: number | null; lng?: number | null }, actorId: string) {
  if (!inp.observations?.trim()) throw new BizError("Observations are required");
  const p = await one(`select * from proposal where id=$1`, [proposalId]);
  if (!p) throw new BizError("Proposal not found");
  const r = await one(`insert into site_visit_report(proposal_id, lead_id, visit_date, visited_by, site_location, contact_person, observations, recommendations, lat, lng, created_by)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$4) returning *`,
    [proposalId, p.lead_id, inp.visitDate, actorId, inp.location || null, inp.contact || null, inp.observations, inp.recommendations || null, inp.lat ?? null, inp.lng ?? null]);
  await one(`insert into activity(entity, entity_id, kind, subject, body, lat, lng, created_by) values ('lead',$1,'MEETING',$2,$3,$4,$5,$6) returning id`,
    [p.lead_id, `Site visit report for ${p.proposal_no}`, inp.observations, inp.lat ?? null, inp.lng ?? null, actorId]);
  await audit(actorId, "CREATE", "site_visit_report", r!.id, null, { proposal: p.proposal_no, date: inp.visitDate });
  return r!;
}
