// Operations: visibility rules, purchase → GRN → bill → payment, stores issue to jobs, dispatch guards,
// invoicing caps, field-service flow with manager approval + client OTP, two-step expenses, performance.
import { describe, it, expect, afterAll } from "vitest";
import { pool, one, q } from "@/lib/db";
import { expandMatrix } from "@/lib/rbac";
import { proposalScopeSql } from "@/lib/access";
import { recordGrn, recordVendorBill, recordVendorPayment, issueMaterial, createDispatch, raiseInvoice, stockOf } from "@/lib/ops";
import * as T from "@/lib/tasks";
import { decideApproval, submitPoForApproval, jobCategory } from "@/lib/workflow";
import type { CurrentUser } from "@/lib/auth";

afterAll(() => pool.end());
const emp = (mobile: string) => one(`select e.*, r.code role, r.name role_name from employee e join role r on r.id=e.role_id where mobile=$1`, [mobile]);
const asUser = async (mobile: string): Promise<CurrentUser> => {
  const e = await emp(mobile);
  const team = await q(`with recursive t as (select id from employee where manager_id=$1 union select x.id from employee x join t on x.manager_id=t.id) select id from t`, [e.id]);
  return { id: e.id, name: e.name, mobile, email: e.email, empCode: e.emp_code, roleCode: e.role, roleName: e.role_name, verticalId: e.vertical_id, verticalName: null,
    departmentId: e.department_id, locationId: e.location_id, managerId: e.manager_id, perms: expandMatrix(e.role), teamIds: team.map((x) => x.id), sessionId: "t", hasPin: false };
};
const visibleProposals = async (u: CurrentUser) => { const p: unknown[] = []; return q(`select p.id, p.owner_id, p.created_by from proposal p where ${proposalScopeSql(u, p)}`, p); };

describe("visibility: only the MD sees every lead and proposal", () => {
  it("MD sees all proposals; a sales engineer sees only the ones they created or are assigned", async () => {
    const all = await q(`select id from proposal`);
    expect((await visibleProposals(await asUser("9800000001"))).length).toBe(all.length);
    const se = await asUser("9800000007");
    const mine = await visibleProposals(se);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.length).toBeLessThan(all.length);
    expect(mine.every((p) => p.owner_id === se.id || p.created_by === se.id)).toBe(true);
  });
  it("a sales manager no longer sees the team's proposals unless asked to approve them", async () => {
    const sm = await asUser("9800000006");
    const seen = await visibleProposals(sm);
    const pending = await q(`select entity_id from approval where entity='proposal' and status='PENDING'`);
    for (const p of seen) expect(p.owner_id === sm.id || p.created_by === sm.id || pending.some((x) => x.entity_id === p.id) || (await one(`select 1 from approval where entity_id=$1 and decided_by=$2`, [p.id, sm.id]))).toBeTruthy();
  });
});

describe("purchase → material receipt → bill → payment", () => {
  it("receives material into stock, turns committed cost into actual and tracks paid/unpaid", async () => {
    const pe = await emp("9800000011"), pm = await emp("9800000010"), store = await emp("9800000027"), acm = await emp("9800000022");
    const po = await one(`select * from purchase_order where status='DRAFT' order by po_no limit 1`);
    if (!po.vendor_id) await pool.query(`update purchase_order set vendor_id=(select id from vendor limit 1) where id=$1`, [po.id]);
    await submitPoForApproval(po.id, pe.id);
    const a = await one(`select * from approval where entity_id=$1 and status='PENDING'`, [po.id]);
    await decideApproval(a.id, true, "ok", { id: a.approver_role === "PURCHASE_MANAGER" ? pm.id : (await emp("9800000001")).id, roleCode: a.approver_role === "PURCHASE_MANAGER" ? "PURCHASE_MANAGER" : "MD" });
    const lines = await q(`select * from po_line where po_id=$1`, [po.id]);
    const mkl = await one(`select id from location where code='MKL'`);
    await expect(recordGrn(po.id, { lines: lines.map((l) => ({ poLineId: l.id, received: Number(l.qty), accepted: Number(l.qty) })), locationId: mkl.id }, store.id)).rejects.toThrow(/challan/i);
    await expect(recordGrn(po.id, { lines: [{ poLineId: lines[0].id, received: Number(lines[0].qty) * 2, accepted: Number(lines[0].qty) * 2 }], locationId: mkl.id, challanNo: "X" }, store.id)).rejects.toThrow(/more than ordered/);
    const g = await recordGrn(po.id, { lines: lines.map((l) => ({ poLineId: l.id, received: Number(l.qty), accepted: Number(l.qty) })), locationId: mkl.id, challanNo: "DC-77" }, store.id);
    expect(g.grn_no).toMatch(/^ENV\/GRN\//);
    expect((await one(`select status from purchase_order where id=$1`, [po.id])).status).toBe("RECEIVED");
    const p = await one(`select * from purchase_order where id=$1`, [po.id]);
    await expect(recordVendorBill({ poId: po.id, billNo: "B1", billDate: "2026-11-01", taxable: Number(p.total) * 2, gst: 0 }, acm.id)).rejects.toThrow(/exceed/);
    const b = await recordVendorBill({ poId: po.id, billNo: "B1", billDate: "2026-11-01", taxable: Number(p.total), gst: Number(p.gst_total) }, acm.id);
    const committed = await one(`select coalesce(sum(amount),0) s from cost_entry where source_id=$1 and status='COMMITTED'`, [po.id]);
    expect(Number(committed.s)).toBe(0);
    await recordVendorPayment(b.id, { amount: Math.round(Number(b.total) / 2), payDate: "2026-11-05" }, acm.id);
    await expect(recordVendorPayment(b.id, { amount: Number(b.total), payDate: "2026-11-06" }, acm.id)).rejects.toThrow(/exceeds/);
  });
});

describe("stores and manufacturing", () => {
  it("issues material to a job only if in stock, and charges it to the job's project code", async () => {
    const store = await emp("9800000027");
    const job = await one(`select * from job_order where status='IN_PROGRESS' limit 1`);
    const item = await one(`select id from item where code='CON-WELD-E6013'`);
    const mkl = await one(`select id from location where code='MKL'`);
    const before = await stockOf(item.id, mkl.id);
    await expect(issueMaterial({ jobId: job.id, itemId: item.id, locationId: mkl.id, qty: before.qty + 1 }, store.id)).rejects.toThrow(/in stock/);
    await issueMaterial({ jobId: job.id, itemId: item.id, locationId: mkl.id, qty: 5 }, store.id);
    expect((await stockOf(item.id, mkl.id)).qty).toBe(before.qty - 5);
    const ce = await one(`select * from cost_entry where job_id=$1 and source_type='MATERIAL_ISSUE' order by created_at desc limit 1`, [job.id]);
    expect(ce.wo_id).toBe(job.wo_id);
    expect(ce.expense_head).toBe("WELDING_ROD");
  });
  it("classifies jobs into the five categories", () => {
    expect(jobCategory("SS304 storage tank 10 KL")).toBe("TANK");
    expect(jobCategory("Chemical dosing skid")).toBe("SKID");
    expect(jobCategory("OWC skid 500 kg/day")).toBe("OWC_SKID");
    expect(jobCategory("MCC control panel")).toBe("CONTROL_PANEL");
    expect(jobCategory("Platforms & pipe supports")).toBe("OTHER");
  });
});

describe("dispatch and invoicing guards", () => {
  it("cannot dispatch more than ordered, or invoice more than the order value", async () => {
    const fm = await emp("9800000015"), acm = await emp("9800000022");
    const line = await one(`select s.*, coalesce((select sum(qty) from dispatch_line dl where dl.wo_spec_line_id=s.id),0) sent from wo_spec_line s where s.item_code='FB-TANK-SS10' order by s.wo_id limit 1`);
    await expect(createDispatch(line.wo_id, { lines: [{ specLineId: line.id, qty: Number(line.qty) - Number(line.sent) + 1 }], vehicleNo: "MH12 1" }, fm.id)).rejects.toThrow(/more than the order/);
    await expect(createDispatch(line.wo_id, { lines: [{ specLineId: line.id, qty: 1 }] }, fm.id)).rejects.toThrow(/Vehicle/);
    const wo = await one(`select * from v_wo_pnl where id=$1`, [line.wo_id]);
    await expect(raiseInvoice(wo.id, { taxable: Number(wo.contract_value) - Number(wo.billed) + 1000 }, acm.id)).rejects.toThrow(/exceed/);
  });
});

describe("field service: report → manager approval → client OTP", () => {
  it("runs the complete flow and records evidence-based completion", async () => {
    const tech = await emp("9800000021"), mgr = await emp("9800000020"), other = await emp("9800000014");
    const t = await T.createTask({ title: "Test PM visit", assignedTo: tech.id, kind: "FIELD_SERVICE", clientName: "Client", clientEmail: "client@example.com", clientMobile: "9822011111" }, mgr.id);
    await expect(T.createTask({ title: "x", assignedTo: tech.id, kind: "FIELD_SERVICE", clientEmail: "bad" }, mgr.id)).rejects.toThrow(/email/);
    await expect(T.completeTask(t.id, "done", 0, tech.id)).rejects.toThrow(/client's OTP/);
    await T.startTask(t.id, tech.id);
    await T.submitServiceReport(t.id, "Serviced blowers", 2, tech.id);
    await expect(T.reviewServiceReport(t.id, true, "", tech.id)).rejects.toThrow(/manager/);
    await expect(T.reviewServiceReport(t.id, true, "", other.id)).rejects.toThrow(/manager/);
    const { devOtp } = await T.reviewServiceReport(t.id, true, "ok", mgr.id);
    expect(devOtp).toMatch(/^\d{6}$/);
    expect((await one(`select status from task where id=$1`, [t.id])).status).toBe("AWAITING_CLIENT");
    await expect(T.verifyClientOtp(t.id, devOtp === "000000" ? "111111" : "000000", tech.id)).rejects.toThrow(/Incorrect/);
    await T.verifyClientOtp(t.id, devOtp!, tech.id);
    const done = await one(`select * from task where id=$1`, [t.id]);
    expect(done.status).toBe("DONE");
    expect(done.client_verified_at).not.toBeNull();
    const mails = await q(`select subject from email_message where subject like $1`, [`%${String(t.id).slice(0, 8).toUpperCase()}%`]);
    expect(mails.length).toBeGreaterThanOrEqual(4);   // scheduled, started, report & OTP, completed
  });
  it("transfers a task and requires a completion report for normal tasks", async () => {
    const a = await emp("9800000017"), b = await emp("9800000018"), sup = await emp("9800000016");
    const t = await T.createTask({ title: "Grind weld seams", assignedTo: a.id }, sup.id);
    await expect(T.transferTask(t.id, b.id, "", sup.id)).rejects.toThrow(/reason/);
    await T.transferTask(t.id, b.id, "Ramesh on leave", sup.id);
    await expect(T.completeTask(t.id, "", 0, b.id)).rejects.toThrow(/report/);
    await T.completeTask(t.id, "Ground all seams on tank 2", 1, b.id);
    expect((await one(`select assigned_to, status, evidence_count from task where id=$1`, [t.id]))).toMatchObject({ assigned_to: b.id, status: "DONE", evidence_count: 1 });
  });
  it("generates daily tasks from templates once per day", async () => {
    const n1 = await T.ensureDailyTasks("2026-12-01");
    const n2 = await T.ensureDailyTasks("2026-12-01");
    expect(n1).toBeGreaterThan(0);
    expect(n2).toBe(0);
  });
});

describe("expense claims: reporting manager, then accounts head", () => {
  it("needs both approvals before the claim is posted", async () => {
    const claim = await one(`select a.*, ce.status ce_status from approval a join cost_entry ce on ce.id=a.entity_id where a.doc_type='EXPENSE_CLAIM' and a.step=1 and a.status='PENDING' limit 1`);
    const wrong = await emp("9800000022");
    await expect(decideApproval(claim.id, true, "", { id: wrong.id, roleCode: "ACCOUNTS_MANAGER" })).rejects.toThrow(/reporting manager/);
    await decideApproval(claim.id, true, "ok", { id: claim.approver_id, roleCode: "PROJECT_MANAGER" });
    expect((await one(`select status from cost_entry where id=$1`, [claim.entity_id])).status).toBe("PENDING_APPROVAL");
    const s2 = await one(`select * from approval where entity_id=$1 and step=2 and status='PENDING'`, [claim.entity_id]);
    await decideApproval(s2.id, true, "ok", { id: wrong.id, roleCode: "ACCOUNTS_MANAGER" });
    expect((await one(`select status from cost_entry where id=$1`, [claim.entity_id])).status).toBe("POSTED");
  });
});

describe("performance matrix", () => {
  it("scores employees from tasks, evidence, daily reports and attendance", async () => {
    const rows = await T.performance("2026-10-01", "2026-12-31");
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows) { expect(r.score).toBeGreaterThanOrEqual(0); expect(r.score).toBeLessThanOrEqual(100); }
    const fw = rows.find((r) => r.emp_code && r.name === "Ramesh Yadav")!;
    expect(fw.daily).toBeGreaterThan(5);
    expect(T.grade(90)).toBe("A");
    expect(T.grade(40)).toBe("D");
  });
});

describe("material control: only cost-sheet items unless an additional requisition is approved", () => {
  it("blocks extra items/quantity on a PO, and allows them after a proposal head approves an additional requisition", async () => {
    const { assertPoWithinRequisition, raiseAdditionalRequisition } = await import("@/lib/material");
    const pe = await emp("9800000011"), sm = await emp("9800000006");
    const po = await one(`select po.* from purchase_order po join work_order w on w.id=po.wo_id where po.status<>'CANCELLED' and w.status<>'CLOSED' order by po.po_no limit 1`);
    expect(po).toBeTruthy();
    await assertPoWithinRequisition(po.id, pool); // as drafted from the cost sheet: fine
    const line = await one(`select * from po_line where po_id=$1 limit 1`, [po.id]);
    // more quantity than the cost sheet
    await pool.query(`update po_line set qty=qty*2 where id=$1`, [line.id]);
    await expect(assertPoWithinRequisition(po.id, pool)).rejects.toThrow(/allow/);
    await pool.query(`update po_line set qty=$2 where id=$1`, [line.id, line.qty]);
    // an item that is not on the cost sheet
    const extra = await one(`insert into po_line(po_id, description, qty, uom, rate) values ($1,'Unlisted gasket kit',4,'NOS',500) returning id`, [po.id]);
    await expect(assertPoWithinRequisition(po.id, pool)).rejects.toThrow(/not on this project's cost sheet/);
    await pool.query(`delete from po_line where id=$1`, [extra.id]);
    // additional requisition: needs a reason, goes to the proposal head; purchase cannot approve it
    await expect(raiseAdditionalRequisition(po.wo_id, { reason: "", lines: [{ description: "Unlisted gasket kit", qty: 4, uom: "NOS" }] }, pe.id)).rejects.toThrow(/reason/);
    const pr = await raiseAdditionalRequisition(po.wo_id, { reason: "Client asked for spare gaskets", lines: [{ description: "Unlisted gasket kit", qty: 4, uom: "NOS", budgetRate: 500 }] }, pe.id);
    expect(pr.status).toBe("PENDING_APPROVAL");
    const a = await one(`select * from approval where entity='purchase_requisition' and entity_id=$1`, [pr.id]);
    await expect(decideApproval(a.id, true, "", { id: pe.id, roleCode: "PURCHASE_MANAGER" })).rejects.toThrow(/SALES_MANAGER/);
    await decideApproval(a.id, true, "ok", { id: sm.id, roleCode: "SALES_MANAGER" });
    expect((await one(`select status from purchase_requisition where id=$1`, [pr.id])).status).toBe("PO_RAISED");
    const newPo = await one(`select * from purchase_order where pr_id=$1`, [pr.id]);
    expect(newPo.status).toBe("DRAFT");
    await assertPoWithinRequisition(newPo.id, pool); // now allowed
  });
});
