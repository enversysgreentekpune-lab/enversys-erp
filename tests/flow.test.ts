// Critical flow: lead -> proposal (spec + cost) -> approval -> submitted -> WON -> WO (budget) -> PR -> draft PO (edit) -> PO approval -> committed cost
//                -> DWR labour cost -> WO P&L; plus guards (stage remarks, lost reason, approval authority, cost-centre rule, audit trail)
import { describe, it, expect, afterAll } from "vitest";
import { pool, one, q } from "@/lib/db";
import { nextNo } from "@/lib/numbering";
import { createProposal, saveRevision, submitForApproval, decideApproval, setProposalStatus, markWon, changeLeadStage, submitPoForApproval, DEFAULT_TERMS } from "@/lib/workflow";
import { submitDwr, todayIST } from "@/lib/hr";
import { DEFAULT_PARAMS } from "@/lib/costing";

const emp = (mobile: string) => one(`select e.*, r.code role from employee e join role r on r.id=e.role_id where mobile=$1`, [mobile]);
afterAll(() => pool.end());

describe("lead → proposal → won → WO → purchase → costs", async () => {
  const se = await emp("9800000007"), bh = await emp("9800000003"), sm = await emp("9800000006"), pe = await emp("9800000011"), pmu = await emp("9800000010");
  const pm = await emp("9800000012"), site = await emp("9800000014"), fw = await emp("9800000017");
  const cust = await one(`select id from customer order by code limit 1`);
  const vert = await one(`select id from vertical where code='PRJ'`);
  let leadId = "", proposalId = "", woId = "";

  it("registers a lead and enforces stage-change rules", async () => {
    const l = await one(`insert into lead(enquiry_no, customer_id, vertical_id, title, est_value, assigned_to, created_by) values ($1,$2,$3,'TEST 30 KLD ETP',4000000,$4,$4) returning id`,
      [await nextNo(pool, "LEAD"), cust.id, vert.id, se.id]);
    leadId = l!.id;
    await expect(changeLeadStage(leadId, "QUALIFIED", "", se.id)).rejects.toThrow(/remark/i);
    await expect(changeLeadStage(leadId, "LOST", "lost it", se.id)).rejects.toThrow(/Lost reason/);
    await changeLeadStage(leadId, "QUALIFIED", "Budget confirmed", se.id);
    expect((await one(`select stage from lead where id=$1`, [leadId])).stage).toBe("QUALIFIED");
  });

  it("creates a proposal with material spec + cost sheet and moves lead to Estimation", async () => {
    const p = await createProposal(leadId, se.id);
    proposalId = p.id;
    expect(p.proposal_no).toMatch(/^ENV\/QT\/\d{2}-\d{2}\/\d{4}$/);
    expect((await one(`select stage from lead where id=$1`, [leadId])).stage).toBe("ESTIMATION");
    const rev = await one(`select id from proposal_revision where proposal_id=$1 and rev_no=0`, [p.id]);
    // sales engineer cannot change margin
    await expect(saveRevision(rev.id, { spec: [], cost: [], params: { ...DEFAULT_PARAMS, margin_pct: 30 }, terms: DEFAULT_TERMS }, se.id, { canOverrideMargin: false })).rejects.toThrow(/margin/);
    const totals = await saveRevision(rev.id, {
      spec: [
        { sl: 1, item_code: "BO-PUMP-CF10", description: "Pump", qty: 2, uom: "NOS", gst_pct: 18 },
        { sl: 2, item_code: "FB-SKID-01", description: "Dosing skid", qty: 1, uom: "SET", gst_pct: 18, is_fabricated: true },
      ],
      cost: [
        { spec_sl: 1, category: "BOUGHT_OUT", description: "Pumps", qty: 2, rate: 68000 },
        { spec_sl: 2, category: "FABRICATION", description: "Markal skid", qty: 1, rate: 165000 },
        { spec_sl: null, category: "FREIGHT", description: "Freight", qty: 1, rate: 20000 },
      ],
      params: { ...DEFAULT_PARAMS, discount_pct: 6 }, terms: DEFAULT_TERMS,
    }, se.id, { canOverrideMargin: false });
    expect(totals.direct).toBe(321000);
    expect((await one(`select quoted_value from proposal where id=$1`, [p.id])).quoted_value).toBeCloseTo(totals.netSelling, 2);
  });

  it("routes approval by discount (6% → Business Head) and enforces approver authority", async () => {
    const a = await submitForApproval(proposalId, se.id);
    expect(a.approver_role).toBe("BUSINESS_HEAD");
    await expect(decideApproval(a.id, true, "", { id: sm.id, roleCode: "SALES_MANAGER" })).rejects.toThrow(/BUSINESS_HEAD/);
    await decideApproval(a.id, true, "OK", { id: bh.id, roleCode: "BUSINESS_HEAD" });
    const p = await one(`select status from proposal where id=$1`, [proposalId]);
    expect(p.status).toBe("APPROVED");
    expect((await one(`select locked from proposal_revision where proposal_id=$1 and rev_no=0`, [proposalId])).locked).toBe(true);
  });

  it("submitting the proposal syncs the lead stage", async () => {
    await setProposalStatus(proposalId, "SUBMITTED", "Emailed", se.id);
    await setProposalStatus(proposalId, "IN_NEGOTIATION", "Price discussion", se.id);
    expect((await one(`select stage from lead where id=$1`, [leadId])).stage).toBe("IN_NEGOTIATION");
  });

  it("marking Won auto-creates the WO with the cost sheet as budget, PR split and editable draft POs", async () => {
    await expect(markWon(proposalId, { poNo: "", poDate: "2026-11-01", poValue: 0, woType: "PROJECT" }, sm.id)).rejects.toThrow(/required/);
    const wo = await markWon(proposalId, { poNo: "4500999999", poDate: "2026-11-01", poValue: 500000, woType: "PROJECT", pmId: pm.id, executorIds: [site.id] }, sm.id);
    woId = wo.id;
    const rev = await one(`select totals from proposal_revision where proposal_id=$1 and rev_no=0`, [proposalId]);
    expect(wo.wo_no).toMatch(/^ENV\/WO\//);
    expect(Number(wo.budget_cost)).toBeCloseTo(rev.totals.totalCost, 2);
    expect(wo.has_fabrication).toBe(true);
    const bsum = await one(`select sum(amount) s from wo_budget_line where wo_id=$1`, [woId]);
    expect(Number(bsum.s)).toBeCloseTo(rev.totals.totalCost, 0);
    expect((await one(`select stage from lead where id=$1`, [leadId])).stage).toBe("WON");
    expect((await one(`select status from proposal where id=$1`, [proposalId])).status).toBe("WON");
    const team = await q(`select team_role from wo_team where wo_id=$1`, [woId]);
    expect(team.map((t) => t.team_role).sort()).toEqual(["EXECUTOR", "PM", "SUPPORT"]);
    const prl = await q(`select route from pr_line l join purchase_requisition pr on pr.id=l.pr_id where pr.wo_id=$1 order by route`, [woId]);
    expect(prl.map((r) => r.route)).toEqual(["MARKAL", "VENDOR"]);
    const pos = await q(`select * from purchase_order where wo_id=$1`, [woId]);
    expect(pos.length).toBe(1);
    expect(pos[0].status).toBe("DRAFT");
    expect(pos[0].vendor_id).not.toBeNull(); // preferred vendor from item master
    const notified = await q(`select e.mobile from notification n join employee e on e.id=n.employee_id where n.title like 'Order won%' and n.link=$1`, [`/work-orders/${woId}`]);
    const mobiles = notified.map((x) => x.mobile);
    expect(mobiles).toEqual(expect.arrayContaining(["9800000010", "9800000015", "9800000022", "9800000012"])); // purchase, factory, accounts, PM
    const tasks = await q(`select assigned_to from task where entity='work_order' and entity_id=$1`, [woId]);
    expect(tasks.length).toBeGreaterThanOrEqual(4);
  });

  it("PO approval follows the value matrix and commits cost to the WO", async () => {
    const po = await one(`select * from purchase_order where wo_id=$1`, [woId]);
    await pool.query(`update po_line set rate = rate * 1.01 where po_id=$1`, [po.id]); // edited draft
    await submitPoForApproval(po.id, pe.id);
    const a = await one(`select * from approval where entity_id=$1 and status='PENDING'`, [po.id]);
    expect(a.approver_role).toBe("PURCHASE_MANAGER");
    await decideApproval(a.id, true, "ok", { id: pmu.id, roleCode: "PURCHASE_MANAGER" });
    const ce = await one(`select * from cost_entry where source_id=$1`, [po.id]);
    expect(ce.status).toBe("COMMITTED");
    expect(ce.wo_id).toBe(woId);
  });

  it("DWR hours are costed to the WO and roll into the WO P&L", async () => {
    await submitDwr(fw.id, todayIST(), "Skid fit-up", "", [{ woId, hours: 8, description: "Welding" }, { woId: null, hours: 1, description: "5S" }]);
    const ce = await one(`select * from cost_entry where wo_id=$1 and source_type='DWR'`, [woId]);
    expect(Number(ce.amount)).toBe(8 * Number(fw.hourly_cost));
    // re-submitting the same day replaces (no double counting)
    await submitDwr(fw.id, todayIST(), "Skid fit-up", "", [{ woId, hours: 6, description: "Welding" }]);
    const n = await one(`select count(*)::int n, sum(amount) s from cost_entry where wo_id=$1 and source_type='DWR'`, [woId]);
    expect(n.n).toBe(1);
    const pnl = await one(`select * from v_wo_pnl where id=$1`, [woId]);
    expect(Number(pnl.actual_cost)).toBe(6 * Number(fw.hourly_cost));
    expect(Number(pnl.committed_cost)).toBeGreaterThan(0);
  });

  it("every cost entry must have exactly one cost centre", async () => {
    await expect(pool.query(`insert into cost_entry(cost_centre, category, amount) values ('WO','X',1)`)).rejects.toThrow(/cost_entry_one_centre/);
    await expect(pool.query(`insert into cost_entry(cost_centre, wo_id, category, amount) values ('OFFICE_ADMIN',$1,'X',1)`, [woId])).rejects.toThrow(/cost_entry_one_centre/);
  });

  it("writes an audit trail and lead timeline for the whole flow", async () => {
    const acts = await q(`select action from audit_log where entity_id in ($1,$2,$3)`, [leadId, proposalId, woId]);
    const actions = acts.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["STAGE_CHANGE", "CREATE", "SUBMIT_APPROVAL", "APPROVE", "STATUS", "WON"]));
    const tl = await q(`select kind from activity where entity='lead' and entity_id=$1`, [leadId]);
    expect(tl.filter((t) => t.kind === "STAGE").length).toBeGreaterThanOrEqual(4);
  });
});
