// Material control: a project may only buy what its cost sheet lists. Anything extra needs an
// additional material requisition raised by Purchase and approved by a proposal head.
import { one, q, tx, type Db } from "./db";
import { nextNo } from "./numbering";
import { audit } from "./audit";
import { notify, idsByRole } from "./notify";
import { BizError } from "./workflow";

/** Role that approves additional requisitions (proposal head); BH / MD rank above and can also approve */
export const MR_APPROVER_ROLE = "SALES_MANAGER";
const key = (itemCode: string | null, description: string) => (itemCode?.trim() ? `I:${itemCode.trim().toUpperCase()}` : `D:${description.trim().toLowerCase()}`);

/** Quantity each item may be bought for a project: cost-sheet (bought-out) lines + approved additional requisitions */
export async function allowedMaterial(woId: string, db?: Db) {
  const rows = await q(`select item_code, description, qty, 'COST_SHEET' src from wo_spec_line where wo_id=$1 and not is_fabricated
      union all
      select l.item_code, l.description, l.qty, 'ADDITIONAL' from pr_line l join purchase_requisition pr on pr.id=l.pr_id
       where pr.wo_id=$1 and pr.kind='ADDITIONAL' and pr.status in ('APPROVED','PO_RAISED')`, [woId], db);
  const m = new Map<string, { description: string; qty: number; costSheet: number; additional: number }>();
  for (const r of rows) {
    const k = key(r.item_code, r.description);
    const e = m.get(k) ?? { description: r.description, qty: 0, costSheet: 0, additional: 0 };
    e.qty += Number(r.qty);
    if (r.src === "COST_SHEET") e.costSheet += Number(r.qty); else e.additional += Number(r.qty);
    m.set(k, e);
  }
  return m;
}

/** Throws if the project's purchase orders (incl. this one) buy an item not on the cost sheet, or more than allowed */
export async function assertPoWithinRequisition(poId: string, db: Db) {
  const po = await one(`select wo_id, po_no from purchase_order where id=$1`, [poId], db);
  if (!po) throw new BizError("PO not found");
  const allowed = await allowedMaterial(po.wo_id, db);
  const bought = await q(`select pl.item_code, pl.description, sum(pl.qty) qty from po_line pl join purchase_order p on p.id=pl.po_id
      where p.wo_id=$1 and p.status<>'CANCELLED' group by 1,2`, [po.wo_id], db);
  const used = new Map<string, number>();
  for (const b of bought) { const k = key(b.item_code, b.description); used.set(k, (used.get(k) ?? 0) + Number(b.qty)); }
  for (const [k, qty] of used) {
    const a = allowed.get(k);
    const name = bought.find((b) => key(b.item_code, b.description) === k)?.description ?? k;
    if (!a) throw new BizError(`"${name}" is not on this project's cost sheet. Raise an additional material requisition and get it approved by the proposal head first.`);
    if (qty > a.qty + 0.0005) throw new BizError(`"${name}": purchase orders total ${qty} but the cost sheet and approved requisitions allow ${a.qty}. Raise an additional material requisition for the extra quantity.`);
  }
}

export interface MrLineIn { itemCode?: string | null; description: string; specification?: string; qty: number; uom: string; budgetRate?: number }

/** Purchase raises an additional material requisition; it goes to the proposal head for approval */
export async function raiseAdditionalRequisition(woId: string, inp: { reason: string; lines: MrLineIn[]; requiredBy?: string }, actorId: string) {
  if (!inp.reason?.trim()) throw new BizError("Give the reason for the additional material");
  const lines = inp.lines.filter((l) => l.description?.trim() && l.qty > 0);
  if (!lines.length) throw new BizError("Add at least one item with a quantity");
  return tx(async (c) => {
    const wo = await one(`select id, wo_no, status, vertical_id from work_order where id=$1`, [woId], c);
    if (!wo) throw new BizError("Project not found");
    if (["CLOSED", "CANCELLED"].includes(wo.status)) throw new BizError(`Project ${wo.wo_no} is ${wo.status.toLowerCase()}`);
    const prNo = await nextNo(c, "PR");
    const pr = await one(`insert into purchase_requisition(pr_no, wo_id, kind, status, reason, created_by) values ($1,$2,'ADDITIONAL','PENDING_APPROVAL',$3,$4) returning *`, [prNo, woId, inp.reason.trim(), actorId], c);
    let value = 0;
    for (const l of lines) {
      await c.query(`insert into pr_line(pr_id, route, item_code, description, specification, qty, uom, budget_rate, required_by) values ($1,'VENDOR',$2,$3,$4,$5,$6,$7,$8)`,
        [pr!.id, l.itemCode || null, l.description.trim(), l.specification || null, l.qty, l.uom || "NOS", l.budgetRate ?? 0, inp.requiredBy || null]);
      value += l.qty * (l.budgetRate ?? 0);
    }
    await c.query(`insert into approval(entity, entity_id, doc_type, approver_role, requested_by, value) values ('purchase_requisition',$1,'MATERIAL_REQUISITION',$2,$3,$4)`, [pr!.id, MR_APPROVER_ROLE, actorId, Math.round(value)]);
    await notify(await idsByRole([MR_APPROVER_ROLE, "BUSINESS_HEAD"], c, wo.vertical_id), "Additional material requisition", `${prNo} for ${wo.wo_no}: ${inp.reason.trim()}`, "/approvals", c);
    await audit(actorId, "CREATE", "purchase_requisition", pr!.id, null, { pr_no: prNo, kind: "ADDITIONAL", lines: lines.length }, c);
    return pr!;
  });
}

/** Called from decideApproval: approval creates a draft PO for the extra items, rejection closes the requisition */
export async function onRequisitionDecision(prId: string, approve: boolean, actorId: string, remarks: string, c: Db) {
  const pr = await one(`select pr.*, w.wo_no from purchase_requisition pr join work_order w on w.id=pr.wo_id where pr.id=$1`, [prId], c);
  if (!pr || pr.status !== "PENDING_APPROVAL") throw new BizError("Requisition is not awaiting approval");
  if (!approve) {
    await c.query(`update purchase_requisition set status='REJECTED', decided_by=$2, decided_at=now() where id=$1`, [prId, actorId]);
    await notify([pr.created_by], "Material requisition rejected", `${pr.pr_no} (${pr.wo_no}): ${remarks}`, `/dispatch?tab=requisitions&project=${pr.wo_id}`, c);
    return;
  }
  const lines = await q(`select * from pr_line where pr_id=$1`, [prId], c);
  const poNo = await nextNo(c, "PO");
  let total = 0, gst = 0;
  const priced = [];
  for (const l of lines) {
    const item = l.item_code ? await one(`select last_purchase_rate, gst_pct from item where code=$1`, [l.item_code], c) : null;
    const rate = Number(item?.last_purchase_rate ?? 0) || Number(l.budget_rate);
    const g = Number(item?.gst_pct ?? 18);
    total += rate * Number(l.qty); gst += (rate * Number(l.qty) * g) / 100;
    priced.push({ ...l, rate, g });
  }
  const po = await one(`insert into purchase_order(po_no, wo_id, pr_id, terms, total, gst_total, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [poNo, pr.wo_id, prId, "Payment: 30 days from GRN. Delivery: as per schedule.", Math.round(total * 100) / 100, Math.round(gst * 100) / 100, actorId], c);
  for (const l of priced)
    await c.query(`insert into po_line(po_id, item_code, description, specification, qty, uom, rate, gst_pct, budget_rate) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [po!.id, l.item_code, l.description, l.specification, l.qty, l.uom, l.rate, l.g, l.budget_rate]);
  await c.query(`update purchase_requisition set status='PO_RAISED', decided_by=$2, decided_at=now() where id=$1`, [prId, actorId]);
  await notify([pr.created_by], "Material requisition approved", `${pr.pr_no} (${pr.wo_no}) — draft ${poNo} created`, `/purchase/${po!.id}`, c);
}
