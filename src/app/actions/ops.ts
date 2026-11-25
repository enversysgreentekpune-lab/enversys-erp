"use server";
import { revalidatePath } from "next/cache";
import { requireUser, need, can } from "@/lib/auth";
import { one, pool } from "@/lib/db";
import { safe, s, n, opt } from "@/lib/action";
import { BizError } from "@/lib/workflow";
import { saveUploads } from "@/lib/attachments";
import { audit } from "@/lib/audit";
import { loadWo, loadProposal } from "@/lib/access";
import * as O from "@/lib/ops";

const up = (fd: FormData, key: string) => (fd.getAll(key) as File[]).filter((f) => f && typeof f !== "string" && f.size > 0);

export async function grnAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    if (!can(u, "stores", "create") && !can(u, "purchase", "create")) throw new BizError("Only Stores / Purchase can record material receipts");
    const ids = fd.getAll("po_line_id").map(String), rec = fd.getAll("received").map(Number), acc = fd.getAll("accepted").map(Number);
    const g = await O.recordGrn(s(fd, "po_id"), {
      lines: ids.map((id, i) => ({ poLineId: id, received: rec[i] || 0, accepted: Number.isFinite(acc[i]) && String(fd.getAll("accepted")[i]) !== "" ? acc[i] : rec[i] || 0 })),
      locationId: s(fd, "location_id"), receivedDate: opt(fd, "date") ?? undefined, challanNo: s(fd, "challan_no"), challanDate: opt(fd, "challan_date") ?? undefined,
      vehicleNo: s(fd, "vehicle_no"), vendorInvoiceNo: s(fd, "vendor_invoice_no"), remarks: s(fd, "remarks"),
    }, u.id);
    await saveUploads(up(fd, "evidence"), { entity: "grn", entityId: g.id, folder: "05 Purchase Orders & Vendor Docs", userId: u.id });
    revalidatePath(`/purchase/${s(fd, "po_id")}`); revalidatePath("/store"); revalidatePath("/purchase");
    return { ok: true, message: `${g.grn_no} recorded. Stock updated.` };
  });
}

export async function vendorBillAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    if (!can(u, "finance", "create") && !can(u, "purchase", "edit")) throw new BizError("Only Accounts / Purchase can enter vendor bills");
    const b = await O.recordVendorBill({ poId: s(fd, "po_id"), billNo: s(fd, "bill_no"), billDate: s(fd, "bill_date"), dueDate: opt(fd, "due_date") ?? undefined, taxable: n(fd, "taxable"), gst: n(fd, "gst"), grnId: opt(fd, "grn_id") }, u.id);
    await saveUploads(up(fd, "bill_file"), { entity: "vendor_bill", entityId: b.id, folder: "11 Invoices & Payments", userId: u.id, docType: "VENDOR_BILL" });
    revalidatePath(`/purchase/${s(fd, "po_id")}`); revalidatePath("/purchase");
    return { ok: true, message: `Bill ${b.bill_no} recorded (₹${Math.round(b.total).toLocaleString("en-IN")})` };
  });
}

export async function vendorPaymentAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    need(u, "finance", "create");
    await O.recordVendorPayment(s(fd, "bill_id"), { amount: n(fd, "amount"), payDate: s(fd, "date"), mode: s(fd, "mode"), reference: s(fd, "reference") }, u.id);
    revalidatePath("/purchase"); revalidatePath("/accounts");
    return { ok: true, message: "Payment recorded" };
  });
}

export async function issueMaterialAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    if (!can(u, "stores", "create")) throw new BizError("Only Stores / Production can issue material");
    await O.issueMaterial({ jobId: s(fd, "job_id"), itemId: s(fd, "item_id"), locationId: s(fd, "location_id"), qty: n(fd, "qty"), date: opt(fd, "date") ?? undefined }, u.id);
    revalidatePath("/store"); revalidatePath("/manufacturing");
    return { ok: true, message: "Material issued and costed to the job" };
  });
}

export async function stockAdjustAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    need(u, "stores", "edit");
    const qty = n(fd, "qty");
    if (!qty) throw new BizError("Enter a non-zero quantity (+ to add, − to reduce)");
    if (!s(fd, "reason")) throw new BizError("Give a reason for the adjustment");
    const r = await one(`insert into stock_txn(item_id, location_id, qty, rate, txn_type, ref, created_by) values ($1,$2,$3,$4,'ADJUST',$5,$6) returning id`,
      [s(fd, "item_id"), s(fd, "location_id"), qty, n(fd, "rate"), s(fd, "reason"), u.id]);
    await audit(u.id, "ADJUST", "stock_txn", r!.id, null, { qty, reason: s(fd, "reason") });
    revalidatePath("/store");
    return { ok: true, message: "Stock adjusted" };
  });
}

export async function jobUpdateAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    need(u, "manufacturing", "edit");
    await O.updateJob(s(fd, "id"), { stage: opt(fd, "stage") ?? undefined, pct: s(fd, "pct") === "" ? undefined : n(fd, "pct"), status: opt(fd, "status") ?? undefined,
      weightKg: s(fd, "weight") === "" ? undefined : n(fd, "weight"), supervisorId: opt(fd, "supervisor_id"), targetDate: opt(fd, "target_date") }, u.id);
    revalidatePath("/manufacturing");
    return { ok: true, message: "Job updated" };
  });
}

export async function createJobAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    need(u, "manufacturing", "create");
    const { nextNo } = await import("@/lib/numbering");
    const line = await one(`select s.*, w.wo_no from wo_spec_line s join work_order w on w.id=s.wo_id where s.id=$1`, [s(fd, "spec_line_id")]);
    if (!line) throw new BizError("Select a project item");
    const { jobCategory, projectItemCode } = await import("@/lib/workflow");
    const r = await one(`insert into job_order(job_no, wo_id, wo_spec_line_id, project_item_code, category, title, qty, uom, weight_kg, budget_cost, target_date, supervisor_id, created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning job_no`,
      [await nextNo(pool, "JOB"), line.wo_id, line.id, line.project_item_code ?? projectItemCode(line.wo_no, line.sl), s(fd, "category") || jobCategory(line.description), s(fd, "title") || line.description,
        n(fd, "qty") || line.qty, line.uom, n(fd, "weight"), Number(line.unit_cost) * Number(n(fd, "qty") || line.qty), opt(fd, "target_date"), opt(fd, "supervisor_id"), u.id]);
    await audit(u.id, "CREATE", "job_order", r!.job_no, null, { item: line.project_item_code });
    revalidatePath("/manufacturing");
    return { ok: true, message: `Job ${r!.job_no} created` };
  });
}

export async function deployAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    need(u, "manufacturing", "edit");
    const emp = s(fd, "employee_id");
    const jobs = fd.getAll("job_id").map(String), hrs = fd.getAll("hours").map(Number);
    await O.deployManpower(emp, s(fd, "date"), jobs.map((j, i) => ({ jobId: j, hours: hrs[i] || 0 })).filter((x) => x.jobId), u.id);
    revalidatePath("/manufacturing");
    return { ok: true, message: "Deployment saved; labour costed to the jobs" };
  });
}

export async function dispatchAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    need(u, "inspection", "create");
    const ids = fd.getAll("spec_line_id").map(String), qty = fd.getAll("qty").map(Number);
    const d = await O.createDispatch(s(fd, "wo_id"), {
      lines: ids.map((id, i) => ({ specLineId: id, qty: qty[i] || 0 })), date: opt(fd, "date") ?? undefined, vehicleNo: s(fd, "vehicle_no"), transporter: s(fd, "transporter"),
      lrNo: s(fd, "lr_no"), ewayBillNo: s(fd, "eway_bill_no"), invoiceNo: s(fd, "invoice_no"), dcNo: s(fd, "dc_no"), freight: n(fd, "freight"), remarks: s(fd, "remarks"),
    }, u.id);
    for (const [key, type] of [["photos", "PHOTO"], ["dc_file", "DELIVERY_CHALLAN"], ["eway_file", "EWAY_BILL"], ["invoice_file", "INVOICE"]] as const)
      await saveUploads(up(fd, key), { entity: "dispatch", entityId: d.id, folder: "08 Dispatch Documents", userId: u.id }).then(async (saved) => {
        for (const a of saved) await pool.query(`update attachment set doc_type=$2 where id=$1`, [a.id, type]);
      });
    revalidatePath("/dispatch");
    return { ok: true, message: `${d.dispatch_no} created`, redirect: `/dispatch?project=${s(fd, "wo_id")}` };
  });
}

export async function deliveredAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    need(u, "inspection", "edit");
    await O.markDelivered(s(fd, "id"), { date: s(fd, "date"), receivedBy: s(fd, "received_by") }, u.id);
    const saved = await saveUploads(up(fd, "receipt_file"), { entity: "dispatch", entityId: s(fd, "id"), folder: "08 Dispatch Documents", userId: u.id });
    for (const a of saved) await pool.query(`update attachment set doc_type='CLIENT_RECEIPT' where id=$1`, [a.id]);
    revalidatePath("/dispatch");
    return { ok: true, message: "Marked delivered" };
  });
}

export async function invoiceAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    need(u, "finance", "create");
    const inv = await O.raiseInvoice(s(fd, "wo_id"), { milestoneId: opt(fd, "milestone_id"), taxable: n(fd, "taxable") || undefined, gstPct: s(fd, "gst_pct") ? n(fd, "gst_pct") : 18, date: opt(fd, "date") ?? undefined }, u.id);
    revalidatePath("/accounts"); revalidatePath("/so");
    return { ok: true, message: `Invoice ${inv.invoice_no} raised for ₹${Math.round(inv.total).toLocaleString("en-IN")}` };
  });
}

export async function receiptAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    need(u, "finance", "create");
    await O.recordReceipt(s(fd, "invoice_id"), { amount: n(fd, "amount"), date: s(fd, "date"), mode: s(fd, "mode") }, u.id);
    revalidatePath("/accounts"); revalidatePath("/so");
    return { ok: true, message: "Receipt recorded" };
  });
}

export async function milestoneAchievedAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const m = await one(`select wo_id from milestone where id=$1`, [s(fd, "id")]);
    if (!m) throw new BizError("Milestone not found");
    await loadWo(u, m.wo_id, "edit");
    await O.achieveMilestone(s(fd, "id"), s(fd, "note"), u.id);
    revalidatePath("/so"); revalidatePath(`/work-orders/${m.wo_id}`);
    return { ok: true, message: "Milestone marked achieved; Accounts notified to bill" };
  });
}

export async function siteVisitAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const p = await loadProposal(u, s(fd, "proposal_id"), "edit");
    const r = await O.addSiteVisit(p.id, { visitDate: s(fd, "visit_date"), location: s(fd, "location"), contact: s(fd, "contact"), observations: s(fd, "observations"), recommendations: s(fd, "recommendations"), lat: n(fd, "lat") || null, lng: n(fd, "lng") || null }, u.id);
    await saveUploads(up(fd, "evidence"), { entity: "site_visit", entityId: r.id, folder: "01 Enquiry & RFQ", userId: u.id });
    revalidatePath(`/proposals/${p.id}`);
    return { ok: true, message: "Site visit report saved" };
  });
}

export async function uploadPoCopyAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const wo = await loadWo(u, s(fd, "wo_id"), "edit");
    const saved = await saveUploads(up(fd, "po_file"), { entity: "work_order", entityId: wo.id, folder: "03 Customer PO & LOI", userId: u.id, docType: "CUSTOMER_PO" });
    if (!saved.length) throw new BizError("Choose the PO / SO copy to upload");
    await pool.query(`update customer_po set attachment_id=$2 where id=$1`, [wo.customer_po_id, saved[0].id]);
    await audit(u.id, "UPLOAD_PO", "work_order", wo.id, null, { file: saved[0].file_name });
    revalidatePath(`/work-orders/${wo.id}`);
    return { ok: true, message: "PO / SO copy uploaded" };
  });
}

export async function assignProposalAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const p = await loadProposal(u, s(fd, "id"), "edit");
    if (p.created_by !== u.id && can(u, "leads", "view") !== "company") throw new BizError("Only the creator or the MD can re-assign a proposal");
    const to = await one(`select id, name from employee where id=$1 and is_active`, [s(fd, "owner_id")]);
    if (!to) throw new BizError("Select an employee");
    await pool.query(`update proposal set owner_id=$2 where id=$1`, [p.id, to.id]);
    const { notify } = await import("@/lib/notify");
    await notify([to.id], "Proposal assigned to you", p.proposal_no, `/proposals/${p.id}`);
    await audit(u.id, "ASSIGN", "proposal", p.id, { owner_id: p.owner_id }, { owner_id: to.id });
    revalidatePath(`/proposals/${p.id}`);
    return { ok: true, message: `Assigned to ${to.name}` };
  });
}
