// Business workflow engine: Lead -> Proposal -> Approval -> Won -> WO -> PR -> draft POs.
// Pure DB logic (no request context) so it is reusable from server actions, APIs, jobs and tests.
import type { PoolClient } from "pg";
import { one, q, tx, pool, type Db } from "./db";
import { nextNo } from "./numbering";
import { audit } from "./audit";
import { notify, idsByRole, createTask } from "./notify";
import { computeCostSheet, DEFAULT_PARAMS, type CostParams } from "./costing";

export const LEAD_STAGES = [
  { code: "NEW", label: "New", prob: 5 }, { code: "QUALIFIED", label: "Qualified", prob: 10 },
  { code: "SITE_VISIT", label: "Site Visit / Clarification", prob: 20 }, { code: "ESTIMATION", label: "Estimation in Progress", prob: 30 },
  { code: "PROPOSAL_SUBMITTED", label: "Proposal Submitted", prob: 40 }, { code: "IN_DISCUSSION", label: "In Discussion", prob: 50 },
  { code: "IN_NEGOTIATION", label: "In Negotiation", prob: 70 }, { code: "WON", label: "Won", prob: 100 },
  { code: "LOST", label: "Lost", prob: 0 }, { code: "ON_HOLD", label: "On Hold", prob: 10 },
  { code: "DROPPED", label: "Dropped", prob: 0 }, { code: "REGRETTED", label: "Regretted", prob: 0 },
] as const;
export const OPEN_STAGES = ["NEW", "QUALIFIED", "SITE_VISIT", "ESTIMATION", "PROPOSAL_SUBMITTED", "IN_DISCUSSION", "IN_NEGOTIATION", "ON_HOLD"];
export const LOST_REASONS = ["Price", "Technical", "Delivery", "Competitor", "Budget dropped", "Project cancelled", "No response", "Other"];
export const LEAD_SOURCES = ["MANUAL", "WEBSITE", "EMAIL", "EXCEL_IMPORT", "REFERRAL", "EXHIBITION", "INDIAMART", "TRADEINDIA", "TENDER", "EXISTING_CUSTOMER"];
export const PROPOSAL_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SUBMITTED", "IN_DISCUSSION", "IN_NEGOTIATION", "WON", "LOST", "ON_HOLD", "CANCELLED"];
export const WO_TYPES = ["PROJECT", "MANUFACTURING", "IC", "OM", "MAINTENANCE", "CONSULTANCY", "TRADING"];
export const stageProb = (s: string) => LEAD_STAGES.find((x) => x.code === s)?.prob ?? 0;
export const stageLabel = (s: string) => LEAD_STAGES.find((x) => x.code === s)?.label ?? s;

export class BizError extends Error {}
const ROLE_RANK: Record<string, number> = { SALES_MANAGER: 1, PURCHASE_MANAGER: 1, PROJECT_MANAGER: 1, HR_MANAGER: 1, ACCOUNTS_MANAGER: 1, BUSINESS_HEAD: 2, MD: 3, SUPER_ADMIN: 3 };
export const canApproveAs = (userRole: string, approverRole: string) =>
  userRole === approverRole || (ROLE_RANK[userRole] ?? 0) > (ROLE_RANK[approverRole] ?? 0);

export const DEFAULT_TERMS = {
  price_basis: "Ex-works Markal Factory, Pune. Packing included.", validity: "30 days from the date of offer",
  payment: "30% advance with PO, 60% against proforma before dispatch, 10% after commissioning",
  delivery: "10–12 weeks from receipt of techno-commercially clear PO and approved drawings",
  warranty: "12 months from commissioning or 18 months from dispatch, whichever is earlier",
  ld: "0.5% per week of delay, max 5% of undelivered portion", exclusions: "Civil works, unloading at site, statutory approvals",
  deviations: "Nil",
};

// ---------------- Leads ----------------------------------------------------
export async function changeLeadStage(leadId: string, stage: string, remark: string, actorId: string,
  lost?: { reason?: string; competitor?: string; competitorPrice?: number | null }, db?: Db) {
  if (!LEAD_STAGES.some((s) => s.code === stage)) throw new BizError("Unknown stage");
  if (!remark?.trim()) throw new BizError("A remark is required for every stage change");
  if (stage === "LOST" && !lost?.reason) throw new BizError("Lost reason is mandatory");
  const run = async (c: Db) => {
    const lead = await one(`select * from lead where id=$1 for update`, [leadId], c);
    if (!lead) throw new BizError("Lead not found");
    if (lead.stage === stage) return lead;
    await c.query(
      `update lead set stage=$2, stage_changed_at=now(), updated_at=now(),
         lost_reason = case when $2='LOST' then $3 else lost_reason end,
         competitor_name = coalesce($4, competitor_name), competitor_price = coalesce($5, competitor_price)
       where id=$1`, [leadId, stage, lost?.reason ?? null, lost?.competitor || null, lost?.competitorPrice ?? null]);
    await c.query(`insert into activity(entity, entity_id, kind, subject, body, meta, created_by) values ('lead',$1,'STAGE',$2,$3,$4,$5)`,
      [leadId, `${stageLabel(lead.stage)} → ${stageLabel(stage)}`, remark, JSON.stringify({ from: lead.stage, to: stage, ...lost }), actorId]);
    await audit(actorId, "STAGE_CHANGE", "lead", leadId, { stage: lead.stage }, { stage, remark, ...lost }, c);
    return { ...lead, stage };
  };
  return db ? run(db) : tx(run);
}

// ---------------- Proposals ------------------------------------------------
export async function createProposal(leadId: string, actorId: string, title?: string) {
  return tx(async (c) => {
    const lead = await one(`select * from lead where id=$1`, [leadId], c);
    if (!lead) throw new BizError("Lead not found");
    const no = await nextNo(c, "PROPOSAL");
    const p = await one(`insert into proposal(proposal_no, lead_id, customer_id, title, owner_id, created_by) values ($1,$2,$3,$4,$5,$6) returning *`,
      [no, leadId, lead.customer_id, title || lead.title, lead.assigned_to ?? actorId, actorId], c);
    await c.query(`insert into proposal_revision(proposal_id, rev_no, params, terms, created_by, notes) values ($1,0,$2,$3,$4,'Initial offer')`,
      [p!.id, JSON.stringify(DEFAULT_PARAMS), JSON.stringify(DEFAULT_TERMS), actorId]);
    if (["NEW", "QUALIFIED", "SITE_VISIT"].includes(lead.stage))
      await changeLeadStage(leadId, "ESTIMATION", `Proposal ${no} started`, actorId, undefined, c);
    await c.query(`insert into activity(entity, entity_id, kind, subject, created_by) values ('lead',$1,'DOC',$2,$3)`, [leadId, `Proposal ${no} created`, actorId]);
    await audit(actorId, "CREATE", "proposal", p!.id, null, { proposal_no: no }, c);
    return p!;
  });
}

export interface SpecIn { sl: number; item_code?: string; description: string; specification?: string; make?: string; moc?: string; size_rating?: string; standard?: string; qty: number; uom: string; drawing_ref?: string; remarks?: string; hsn?: string; gst_pct: number; is_fabricated?: boolean }
export interface CostIn { spec_sl: number | null; category: string; description: string; qty: number; uom?: string; rate: number; rate_source?: string }

export async function saveRevision(revisionId: string, data: { spec: SpecIn[]; cost: CostIn[]; params: CostParams; terms: Record<string, string>; notes?: string },
  actorId: string, opts: { canOverrideMargin: boolean }) {
  return tx(async (c) => {
    const rev = await one(`select r.*, p.status, p.id pid from proposal_revision r join proposal p on p.id=r.proposal_id where r.id=$1 for update`, [revisionId], c);
    if (!rev) throw new BizError("Revision not found");
    if (rev.locked) throw new BizError("This revision is locked. Create a new revision to make changes.");
    if (!["DRAFT", "IN_DISCUSSION", "IN_NEGOTIATION", "ON_HOLD"].includes(rev.status))
      throw new BizError(`Proposal is ${rev.status}; it cannot be edited now`);
    const oldParams = rev.params as CostParams;
    const params = { ...DEFAULT_PARAMS, ...data.params };
    if (!opts.canOverrideMargin && Number(params.margin_pct) !== Number(oldParams.margin_pct ?? DEFAULT_PARAMS.margin_pct))
      throw new BizError("You are not permitted to change the margin %");
    const spec = data.spec.map((s, i) => ({ ...s, sl: i + 1 }));
    const totals = computeCostSheet(spec, data.cost, params);
    await c.query(`delete from spec_line where revision_id=$1`, [revisionId]);
    await c.query(`delete from cost_line where revision_id=$1`, [revisionId]);
    for (const s of spec)
      await c.query(`insert into spec_line(revision_id, sl, item_code, description, specification, make, moc, size_rating, standard, qty, uom, drawing_ref, remarks, hsn, gst_pct, is_fabricated)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [revisionId, s.sl, s.item_code || null, s.description, s.specification || null, s.make || null, s.moc || null, s.size_rating || null, s.standard || null, s.qty, s.uom || "NOS", s.drawing_ref || null, s.remarks || null, s.hsn || null, s.gst_pct ?? 18, !!s.is_fabricated]);
    for (const l of data.cost)
      await c.query(`insert into cost_line(revision_id, spec_sl, category, description, qty, uom, rate, rate_source, amount) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [revisionId, l.spec_sl, l.category, l.description, l.qty, l.uom || null, l.rate, l.rate_source || null, Math.round(l.qty * l.rate * 100) / 100]);
    await c.query(`update proposal_revision set params=$2, terms=$3, totals=$4, notes=coalesce($5, notes) where id=$1`,
      [revisionId, JSON.stringify(params), JSON.stringify(data.terms), JSON.stringify(totals), data.notes ?? null]);
    await c.query(`update proposal set quoted_value=$2, quoted_margin_pct=$3 where id=$1`, [rev.pid, totals.netSelling, totals.marginPct]);
    await audit(actorId, "EDIT", "proposal_revision", revisionId,
      { net: (rev.totals as any)?.netSelling, margin: oldParams.margin_pct, discount: oldParams.discount_pct },
      { net: totals.netSelling, margin: params.margin_pct, discount: params.discount_pct, lines: spec.length }, c);
    return totals;
  });
}

export async function newRevision(proposalId: string, actorId: string, notes: string) {
  return tx(async (c) => {
    const p = await one(`select * from proposal where id=$1 for update`, [proposalId], c);
    if (!p) throw new BizError("Proposal not found");
    if (["WON", "LOST", "CANCELLED"].includes(p.status)) throw new BizError(`Proposal is ${p.status}`);
    const cur = await one(`select * from proposal_revision where proposal_id=$1 and rev_no=$2`, [proposalId, p.current_rev], c);
    const nr = await one(`insert into proposal_revision(proposal_id, rev_no, params, terms, totals, notes, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [proposalId, p.current_rev + 1, cur.params, cur.terms, cur.totals, notes || `Revision ${p.current_rev + 1}`, actorId], c);
    await c.query(`insert into spec_line(revision_id, sl, item_code, description, specification, make, moc, size_rating, standard, qty, uom, drawing_ref, remarks, hsn, gst_pct, is_fabricated)
      select $2, sl, item_code, description, specification, make, moc, size_rating, standard, qty, uom, drawing_ref, remarks, hsn, gst_pct, is_fabricated from spec_line where revision_id=$1`, [cur.id, nr!.id]);
    await c.query(`insert into cost_line(revision_id, spec_sl, category, description, qty, uom, rate, rate_source, amount)
      select $2, spec_sl, category, description, qty, uom, rate, rate_source, amount from cost_line where revision_id=$1`, [cur.id, nr!.id]);
    await c.query(`update proposal_revision set locked=true where id=$1`, [cur.id]);
    // a revision re-opens internal approval: commercial content may change
    const keep = ["IN_DISCUSSION", "IN_NEGOTIATION", "ON_HOLD"].includes(p.status) ? p.status : "DRAFT";
    await c.query(`update proposal set current_rev=$2, status=$3 where id=$1`, [proposalId, p.current_rev + 1, keep === "ON_HOLD" ? "DRAFT" : keep]);
    await c.query(`insert into activity(entity, entity_id, kind, subject, body, created_by) values ('lead',$1,'DOC',$2,$3,$4)`,
      [p.lead_id, `${p.proposal_no} revised to R${p.current_rev + 1}`, notes, actorId]);
    await audit(actorId, "REVISE", "proposal", proposalId, { rev: p.current_rev }, { rev: p.current_rev + 1, notes }, c);
    return nr!;
  });
}

export async function requiredApproverRole(docType: string, value: number, db: Db = pool): Promise<string> {
  const r = await one(`select approver_role from approval_rule where doc_type=$1 and is_active and $2 >= min_value and ($2 < max_value or max_value is null) order by sequence desc limit 1`, [docType, value], db);
  return r?.approver_role ?? "MD";
}

export async function submitForApproval(proposalId: string, actorId: string) {
  return tx(async (c) => {
    const p = await one(`select * from proposal where id=$1 for update`, [proposalId], c);
    if (!p) throw new BizError("Proposal not found");
    if (!["DRAFT", "IN_DISCUSSION", "IN_NEGOTIATION"].includes(p.status)) throw new BizError(`Cannot submit a ${p.status} proposal for approval`);
    const rev = await one(`select * from proposal_revision where proposal_id=$1 and rev_no=$2`, [proposalId, p.current_rev], c);
    const nLines = await one(`select count(*)::int n from spec_line where revision_id=$1`, [rev.id], c);
    if (!nLines?.n || !rev.totals?.netSelling) throw new BizError("Add material spec lines and a costed cost sheet before approval");
    const unpriced = (rev.totals.lines ?? []).filter((l: any) => !(l.amount > 0)).map((l: any) => l.sl);
    if (unpriced.length) throw new BizError(`Spec line(s) ${unpriced.join(", ")} have no cost and would be quoted at ₹0. Add cost lines for them first.`);
    const discount = Number(rev.params?.discount_pct ?? 0);
    const role = await requiredApproverRole("QUOTE_DISCOUNT", discount, c);
    await c.query(`update approval set status='REJECTED', remarks='Superseded', decided_at=now() where entity='proposal' and entity_id=$1 and status='PENDING'`, [proposalId]);
    const a = await one(`insert into approval(entity, entity_id, doc_type, approver_role, requested_by, value) values ('proposal',$1,'QUOTE_DISCOUNT',$2,$3,$4) returning *`,
      [proposalId, role, actorId, discount], c);
    await c.query(`update proposal set status='PENDING_APPROVAL' where id=$1`, [proposalId]);
    const lead = await one(`select vertical_id from lead where id=$1`, [p.lead_id], c);
    await notify(await idsByRole([role], c, lead?.vertical_id), "Proposal approval needed",
      `${p.proposal_no} R${p.current_rev} — ₹${Math.round(rev.totals.netSelling).toLocaleString("en-IN")}, margin ${rev.totals.marginPct}%, discount ${discount}%`, `/proposals/${proposalId}`, c);
    await audit(actorId, "SUBMIT_APPROVAL", "proposal", proposalId, { status: p.status }, { status: "PENDING_APPROVAL", approver_role: role }, c);
    return a!;
  });
}

export async function decideApproval(approvalId: string, approve: boolean, remarks: string, actor: { id: string; roleCode: string }) {
  return tx(async (c) => {
    const a = await one(`select * from approval where id=$1 for update`, [approvalId], c);
    if (!a || a.status !== "PENDING") throw new BizError("Approval is not pending");
    if (!canApproveAs(actor.roleCode, a.approver_role)) throw new BizError(`Requires ${a.approver_role} approval`);
    if (!approve && !remarks?.trim()) throw new BizError("Remarks are required when rejecting");
    await c.query(`update approval set status=$2, decided_by=$3, decided_at=now(), remarks=$4 where id=$1`, [approvalId, approve ? "APPROVED" : "REJECTED", actor.id, remarks || null]);
    if (a.entity === "proposal") {
      const p = await one(`select * from proposal where id=$1`, [a.entity_id], c);
      await c.query(`update proposal set status=$2 where id=$1`, [a.entity_id, approve ? "APPROVED" : "DRAFT"]);
      await c.query(`update proposal_revision set locked=$3 where proposal_id=$1 and rev_no=$2`, [a.entity_id, p.current_rev, approve]);
      await notify([a.requested_by, p.owner_id], `Proposal ${approve ? "approved" : "rejected"}`, `${p.proposal_no}: ${remarks || (approve ? "Approved" : "")}`, `/proposals/${p.id}`, c);
      await c.query(`insert into activity(entity, entity_id, kind, subject, body, created_by) values ('lead',$1,'STATUS',$2,$3,$4)`,
        [p.lead_id, `${p.proposal_no} R${p.current_rev} ${approve ? "approved" : "rejected"} internally`, remarks, actor.id]);
    }
    if (a.entity === "purchase_order") {
      await c.query(`update purchase_order set status=$2, approved_by=$3 where id=$1`, [a.entity_id, approve ? "APPROVED" : "DRAFT", approve ? actor.id : null]);
      if (approve) {
        const po = await one(`select * from purchase_order where id=$1`, [a.entity_id], c);
        await c.query(`insert into cost_entry(cost_centre, wo_id, category, description, amount, gst_amount, source_type, source_id, vendor_id, status, created_by)
          values ('WO',$1,'MATERIAL',$2,$3,$4,'PURCHASE_ORDER',$5,$6,'COMMITTED',$7)`, [po.wo_id, `PO ${po.po_no}`, po.total, po.gst_total, po.id, po.vendor_id, actor.id]);
      }
    }
    if (a.entity === "cost_entry") {
      const ce = await one(`update cost_entry set status=$2 where id=$1 returning created_by, amount`, [a.entity_id, approve ? "POSTED" : "REJECTED"], c);
      await notify([ce?.created_by], `Expense claim ${approve ? "approved" : "rejected"}`, `₹${Math.round(ce?.amount ?? 0).toLocaleString("en-IN")} ${remarks ?? ""}`, "/expenses", c);
    }
    await audit(actor.id, approve ? "APPROVE" : "REJECT", a.entity, a.entity_id, { status: "PENDING" }, { status: approve ? "APPROVED" : "REJECTED", remarks }, c);
  });
}

const PROPOSAL_TO_LEAD: Record<string, string> = { SUBMITTED: "PROPOSAL_SUBMITTED", IN_DISCUSSION: "IN_DISCUSSION", IN_NEGOTIATION: "IN_NEGOTIATION", LOST: "LOST", ON_HOLD: "ON_HOLD", WON: "WON" };

export async function setProposalStatus(proposalId: string, status: string, remark: string, actorId: string, lost?: { reason?: string; competitor?: string; competitorPrice?: number | null }, db?: PoolClient) {
  if (status === "WON") throw new BizError("Use 'Mark as Won' with the customer PO details");
  const run = async (c: Db) => {
    const p = await one(`select * from proposal where id=$1 for update`, [proposalId], c);
    if (!p) throw new BizError("Proposal not found");
    const allowed: Record<string, string[]> = {
      SUBMITTED: ["APPROVED", "SUBMITTED"], IN_DISCUSSION: ["SUBMITTED", "IN_NEGOTIATION", "ON_HOLD", "APPROVED"],
      IN_NEGOTIATION: ["SUBMITTED", "IN_DISCUSSION", "ON_HOLD", "APPROVED"], ON_HOLD: ["SUBMITTED", "IN_DISCUSSION", "IN_NEGOTIATION"],
      LOST: ["SUBMITTED", "IN_DISCUSSION", "IN_NEGOTIATION", "ON_HOLD", "APPROVED"], CANCELLED: ["DRAFT", "APPROVED", "PENDING_APPROVAL", "ON_HOLD"],
    };
    if (!allowed[status]?.includes(p.status)) throw new BizError(`Cannot move from ${p.status} to ${status}`);
    if (status === "LOST" && !lost?.reason) throw new BizError("Lost reason is mandatory");
    await c.query(`update proposal set status=$2, submitted_at = case when $2='SUBMITTED' then coalesce(submitted_at, now()) else submitted_at end,
      decided_at = case when $2 in ('LOST','CANCELLED') then now() else decided_at end, lost_reason = case when $2='LOST' then $3 else lost_reason end where id=$1`,
      [proposalId, status, lost?.reason ?? null]);
    if (PROPOSAL_TO_LEAD[status]) await changeLeadStage(p.lead_id, PROPOSAL_TO_LEAD[status], remark || `Proposal ${p.proposal_no} ${status}`, actorId, lost, c);
    await audit(actorId, "STATUS", "proposal", proposalId, { status: p.status }, { status, remark }, c);
  };
  return db ? run(db) : tx(run);
}

// ---------------- Won -> Work Order -> PR -> draft POs ---------------------
export interface WonInput {
  poNo: string; poDate: string; poValue: number; agreedChanges?: string; woType: string;
  pmId?: string | null; executorIds?: string[]; startDate?: string; endDate?: string; attachmentId?: string | null;
}

export async function markWon(proposalId: string, inp: WonInput, actorId: string) {
  if (!inp.poNo?.trim() || !inp.poDate || !(inp.poValue > 0)) throw new BizError("Customer PO no., date and value are required");
  if (!WO_TYPES.includes(inp.woType)) throw new BizError("Invalid order type");
  return tx(async (c) => {
    const p = await one(`select * from proposal where id=$1 for update`, [proposalId], c);
    if (!p) throw new BizError("Proposal not found");
    if (!["SUBMITTED", "IN_DISCUSSION", "IN_NEGOTIATION", "APPROVED", "ON_HOLD"].includes(p.status)) throw new BizError(`A ${p.status} proposal cannot be marked Won`);
    const lead = await one(`select * from lead where id=$1`, [p.lead_id], c);
    const rev = await one(`select * from proposal_revision where proposal_id=$1 and rev_no=$2`, [proposalId, p.current_rev], c);
    const spec = await q(`select * from spec_line where revision_id=$1 order by sl`, [rev.id], c);
    const costs = await q(`select * from cost_line where revision_id=$1`, [rev.id], c);
    const t = rev.totals ?? {};

    const cpo = await one(`insert into customer_po(proposal_id, customer_id, po_no, po_date, po_value, agreed_changes, attachment_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [proposalId, p.customer_id, inp.poNo.trim(), inp.poDate, inp.poValue, inp.agreedChanges || null, inp.attachmentId ?? null, actorId], c);
    const woNo = await nextNo(c, "WORK_ORDER");
    const hasFab = spec.some((s) => s.is_fabricated) || costs.some((x) => x.category === "FABRICATION");
    const budget = Number(t.totalCost ?? 0);
    const wo = await one(`insert into work_order(wo_no, wo_type, title, customer_id, vertical_id, proposal_id, customer_po_id, contract_value, budget_cost, quoted_margin_pct,
        start_date, end_date, has_fabrication, site_location, terms, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *`,
      [woNo, inp.woType, p.title, p.customer_id, lead.vertical_id, proposalId, cpo!.id, inp.poValue, budget, t.marginPct ?? null,
        inp.startDate || inp.poDate, inp.endDate || null, hasFab, lead.site_location, rev.terms, actorId], c);
    const woId = wo!.id;
    // Budget baseline = final cost sheet (direct by category + overhead provisions)
    for (const [cat, amt] of Object.entries<number>(t.byCategory ?? {}))
      await c.query(`insert into wo_budget_line(wo_id, category, description, amount) values ($1,$2,$3,$4)`, [woId, cat, `From ${p.proposal_no} R${p.current_rev}`, amt]);
    for (const [cat, key] of [["CONTINGENCY", "contingency"], ["OVERHEAD", "overhead"], ["FINANCE", "finance"], ["WARRANTY", "warranty"]] as const)
      if (Number(t[key]) > 0) await c.query(`insert into wo_budget_line(wo_id, category, description, amount) values ($1,$2,'Provision',$3)`, [woId, cat, t[key]]);
    // Frozen material spec with unit budget cost
    const lineCost = new Map<number, number>((t.lines ?? []).map((l: any) => [l.sl, l.cost]));
    for (const s of spec)
      await c.query(`insert into wo_spec_line(wo_id, sl, item_code, description, specification, make, moc, size_rating, standard, qty, uom, drawing_ref, is_fabricated, unit_cost)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [woId, s.sl, s.item_code, s.description, s.specification, s.make, s.moc, s.size_rating, s.standard, s.qty, s.uom, s.drawing_ref, s.is_fabricated, Math.round(((lineCost.get(s.sl) ?? 0) / Number(s.qty || 1)) * 100) / 100]);
    // Payment milestones from standard template (editable on WO)
    const ms: [string, number][] = inp.woType === "OM" ? Array.from({ length: 12 }, (_, i) => [`O&M billing – month ${i + 1}`, 100 / 12] as [string, number]) : [["Advance with PO", 30], ["Against proforma before dispatch", 60], ["After commissioning", 10]];
    const start = new Date(inp.startDate || inp.poDate);
    for (const [k, [name, pc]] of ms.entries()) {
      const due = new Date(start); due.setMonth(due.getMonth() + (inp.woType === "OM" ? k + 1 : [0, 3, 5][k] ?? k));
      await c.query(`insert into milestone(wo_id, name, pct, amount, due_date) values ($1,$2,$3,$4,$5)`, [woId, name, Math.round(pc * 100) / 100, Math.round(inp.poValue * pc) / 100, due.toISOString().slice(0, 10)]);
    }
    // Team
    if (inp.pmId) await c.query(`insert into wo_team values ($1,$2,'PM') on conflict do nothing`, [woId, inp.pmId]);
    for (const e of inp.executorIds ?? []) await c.query(`insert into wo_team values ($1,$2,'EXECUTOR') on conflict do nothing`, [woId, e]);
    await c.query(`insert into wo_team values ($1,$2,'SUPPORT') on conflict do nothing`, [woId, p.owner_id ?? actorId]);

    // Proposal & lead -> WON
    await c.query(`update proposal set status='WON', final_value=$2, decided_at=now() where id=$1`, [proposalId, inp.poValue]);
    await c.query(`update proposal_revision set locked=true where proposal_id=$1`, [proposalId]);
    await changeLeadStage(p.lead_id, "WON", `Customer PO ${inp.poNo} received. WO ${woNo} created.`, actorId, undefined, c);
    if (inp.attachmentId) await c.query(`update attachment set entity='work_order', entity_id=$2, folder='03 Customer PO & LOI' where id=$1`, [inp.attachmentId, woId]);

    // Purchase requisition with BOM split: fabricated -> Markal, rest -> vendors; then auto draft POs
    // service-type orders (O&M, consultancy, maintenance) have no material BOM to buy
    const prId = ["OM", "CONSULTANCY", "MAINTENANCE"].includes(inp.woType) ? null : await createPrAndDraftPos(c, woId, spec, lineCost, actorId, inp.endDate);

    // Notifications & tasks (kick-off)
    const link = `/work-orders/${woId}`;
    const bh = await idsByRole(["BUSINESS_HEAD"], c, lead.vertical_id);
    const purchase = await idsByRole(["PURCHASE_MANAGER"], c);
    const accounts = await idsByRole(["ACCOUNTS_MANAGER"], c);
    const factory = hasFab ? await idsByRole(["FACTORY_MANAGER"], c) : [];
    const md = await idsByRole(["MD"], c);
    await notify([...bh, ...purchase, ...accounts, ...factory, ...md, inp.pmId], `Order won: ${woNo}`,
      `${p.title} — PO ${inp.poNo}, ₹${Math.round(inp.poValue).toLocaleString("en-IN")}${hasFab ? " (Markal fabrication in scope)" : ""}`, link, c);
    // executors / shop-floor: no commercial values (sensitive fields)
    await notify((inp.executorIds ?? []).filter((e) => e !== inp.pmId), `Assigned to ${woNo}`, `${p.title}${hasFab ? " — Markal fabrication in scope" : ""}`, link, c);
    const due = new Date(Date.now() + 3 * 86400000);
    if (inp.pmId) await createTask({ title: `Kick-off meeting & baseline schedule for ${woNo}`, entity: "work_order", entityId: woId, link, assignedTo: inp.pmId, createdBy: actorId, dueAt: due, priority: "HIGH" }, c);
    for (const pm of purchase) await createTask({ title: `Review PR & draft POs for ${woNo}`, entity: "work_order", entityId: woId, link: `/work-orders/${woId}#purchase`, assignedTo: pm, createdBy: actorId, dueAt: due, priority: "HIGH" }, c);
    for (const fm of factory) await createTask({ title: `Plan Markal job order for ${woNo}`, entity: "work_order", entityId: woId, link, assignedTo: fm, createdBy: actorId, dueAt: due }, c);
    for (const ac of accounts) await createTask({ title: `Raise advance invoice for ${woNo}`, entity: "work_order", entityId: woId, link, assignedTo: ac, createdBy: actorId, dueAt: due }, c);

    await audit(actorId, "WON", "proposal", proposalId, { status: p.status }, { status: "WON", wo_no: woNo, po_no: inp.poNo, value: inp.poValue }, c);
    await audit(actorId, "CREATE", "work_order", woId, null, { wo_no: woNo, budget, contract_value: inp.poValue, pr_id: prId }, c);
    return wo!;
  });
}

async function createPrAndDraftPos(c: Db, woId: string, spec: any[], lineCost: Map<number, number>, actorId: string, requiredBy?: string) {
  if (!spec.length) return null;
  const prNo = await nextNo(c, "PR");
  const pr = await one(`insert into purchase_requisition(pr_no, wo_id, created_by) values ($1,$2,$3) returning id`, [prNo, woId, actorId], c);
  const byVendor = new Map<string, any[]>();
  for (const s of spec) {
    const budgetRate = Math.round(((lineCost.get(s.sl) ?? 0) / Number(s.qty || 1)) * 100) / 100;
    const route = s.is_fabricated ? "MARKAL" : "VENDOR";
    await c.query(`insert into pr_line(pr_id, route, item_code, description, specification, qty, uom, budget_rate, required_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [pr!.id, route, s.item_code, s.description, s.specification, s.qty, s.uom, budgetRate, requiredBy || null]);
    if (route === "VENDOR") {
      const item = s.item_code ? await one(`select * from item where code=$1`, [s.item_code], c) : null;
      const vendor = item?.preferred_vendor_id ?? "none";
      const rate = Number(item?.last_purchase_rate ?? 0) || budgetRate;
      if (!byVendor.has(vendor)) byVendor.set(vendor, []);
      byVendor.get(vendor)!.push({ ...s, rate, budgetRate, gst: Number(item?.gst_pct ?? s.gst_pct ?? 18) });
    }
  }
  for (const [vendor, lines] of byVendor) {
    const poNo = await nextNo(c, "PO");
    const total = lines.reduce((a, l) => a + l.rate * Number(l.qty), 0);
    const gst = lines.reduce((a, l) => a + (l.rate * Number(l.qty) * l.gst) / 100, 0);
    const po = await one(`insert into purchase_order(po_no, wo_id, pr_id, vendor_id, delivery_date, terms, total, gst_total, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [poNo, woId, pr!.id, vendor === "none" ? null : vendor, requiredBy || null, "Payment: 30 days from GRN. Delivery: as per schedule. Test certificates to accompany material.", Math.round(total * 100) / 100, Math.round(gst * 100) / 100, actorId], c);
    for (const l of lines)
      await c.query(`insert into po_line(po_id, item_code, description, specification, qty, uom, rate, gst_pct, budget_rate) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [po!.id, l.item_code, l.description, [l.specification, l.make, l.moc].filter(Boolean).join(" | "), l.qty, l.uom, l.rate, l.gst, l.budgetRate]);
  }
  return pr!.id;
}

export async function submitPoForApproval(poId: string, actorId: string) {
  return tx(async (c) => {
    const po = await one(`select * from purchase_order where id=$1 for update`, [poId], c);
    if (!po || po.status !== "DRAFT") throw new BizError("Only draft POs can be submitted");
    if (!po.vendor_id) throw new BizError("Select a vendor first");
    const role = await requiredApproverRole("PURCHASE_ORDER", Number(po.total), c);
    await c.query(`insert into approval(entity, entity_id, doc_type, approver_role, requested_by, value) values ('purchase_order',$1,'PURCHASE_ORDER',$2,$3,$4)`, [poId, role, actorId, po.total]);
    await c.query(`update purchase_order set status='PENDING_APPROVAL' where id=$1`, [poId]);
    await notify(await idsByRole([role], c), "PO approval needed", `${po.po_no} — ₹${Math.round(po.total).toLocaleString("en-IN")}`, `/purchase/${poId}`, c);
    await audit(actorId, "SUBMIT_APPROVAL", "purchase_order", poId, { status: "DRAFT" }, { status: "PENDING_APPROVAL", approver_role: role }, c);
  });
}
