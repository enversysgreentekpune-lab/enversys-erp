"use server";
import { revalidatePath } from "next/cache";
import { requireUser, can } from "@/lib/auth";
import { one, tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { safe, s, n, opt } from "@/lib/action";
import { BizError, requiredApproverRole } from "@/lib/workflow";
import { saveUploads } from "@/lib/attachments";
import { notify, idsByRole } from "@/lib/notify";


/**
 * Admin expense entry / employee expense claim. Exactly one cost centre: OFFICE_ADMIN, FACTORY_ADMIN or a WO.
 * Admin/Accounts entries post directly; employee claims go through the EXPENSE_CLAIM approval matrix.
 */
export async function addExpenseAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const centre = s(fd, "centre");
    const woId = opt(fd, "wo_id");
    if (!["OFFICE_ADMIN", "FACTORY_ADMIN", "WO"].includes(centre)) throw new BizError("Choose a cost centre");
    if (centre === "WO" && !woId) throw new BizError("Select the work order this expense belongs to");
    const amount = n(fd, "amount");
    if (amount <= 0) throw new BizError("Amount must be positive");
    const mod = centre === "FACTORY_ADMIN" ? "factory_admin" : "office_admin";
    const sc = can(u, mod, "create") ?? can(u, "office_admin", "create");
    if (!sc) throw new BizError("Not permitted");
    const isClaim = sc === "own" || s(fd, "claim") === "1";
    const head = s(fd, "head");
    const id = await tx(async (c) => {
      const ce = await one(`insert into cost_entry(cost_centre, wo_id, category, expense_head, description, amount, gst_amount, entry_date, source_type, status, created_by)
        values ($1,$2,$3,$4,$5,$6,$7,coalesce($8::date,current_date),$9,$10,$11) returning id`,
        [centre, centre === "WO" ? woId : null, centre === "WO" ? (head === "TRAVEL" ? "TRAVEL" : "SITE_EXP") : "ADMIN", head, s(fd, "description"), amount, n(fd, "gst"), opt(fd, "date"),
          isClaim ? "EXPENSE_CLAIM" : "MANUAL", isClaim ? "PENDING_APPROVAL" : "POSTED", u.id], c);
      const bill = await saveUploads(fd.getAll("bill") as File[], { entity: "cost_entry", entityId: ce!.id, folder: "11 Invoices & Payments", userId: u.id, db: c });
      if (bill[0]) await c.query(`update cost_entry set bill_attachment_id=$2 where id=$1`, [ce!.id, bill[0].id]);
      if (isClaim) {
        const role = await requiredApproverRole("EXPENSE_CLAIM", amount, c);
        await c.query(`insert into approval(entity, entity_id, doc_type, approver_role, requested_by, value) values ('cost_entry',$1,'EXPENSE_CLAIM',$2,$3,$4)`, [ce!.id, role, u.id, amount]);
        const mgr = await one(`select manager_id from employee where id=$1`, [u.id], c);
        await notify([mgr?.manager_id, ...(await idsByRole([role], c))], "Expense claim submitted", `${u.name}: ₹${Math.round(amount).toLocaleString("en-IN")} — ${s(fd, "description")}`, "/approvals", c);
      }
      await audit(u.id, isClaim ? "CLAIM" : "CREATE", "cost_entry", ce!.id, null, { centre, head, amount, wo: woId }, c);
      return ce!.id;
    });
    revalidatePath("/expenses");
    return { ok: true, message: isClaim ? "Claim submitted for approval" : `Expense ${id.slice(0, 8)} posted` };
  });
}
