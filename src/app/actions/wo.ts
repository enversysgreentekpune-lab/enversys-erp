"use server";
import { revalidatePath } from "next/cache";
import { requireUser, can, need } from "@/lib/auth";
import { one, q, tx, pool } from "@/lib/db";
import { audit } from "@/lib/audit";
import { safe, s, n, opt } from "@/lib/action";
import { BizError, submitPoForApproval } from "@/lib/workflow";
import { loadWo } from "@/lib/access";
import { saveUploads } from "@/lib/attachments";
import { notify } from "@/lib/notify";

export async function assignTeamAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const wo = await loadWo(u, s(fd, "id"), "edit");
    const pm = s(fd, "pm_id"), execs = fd.getAll("executors").map(String).filter(Boolean), support = fd.getAll("support").map(String).filter(Boolean);
    const old = await q(`select employee_id, team_role from wo_team where wo_id=$1`, [wo.id]);
    await tx(async (c) => {
      await c.query(`delete from wo_team where wo_id=$1`, [wo.id]);
      if (pm) await c.query(`insert into wo_team values ($1,$2,'PM')`, [wo.id, pm]);
      for (const e of execs) await c.query(`insert into wo_team values ($1,$2,'EXECUTOR') on conflict do nothing`, [wo.id, e]);
      for (const e of support) await c.query(`insert into wo_team values ($1,$2,'SUPPORT') on conflict do nothing`, [wo.id, e]);
      const added = [pm, ...execs, ...support].filter((x) => x && !old.some((o) => o.employee_id === x));
      await notify(added, `Assigned to ${wo.wo_no}`, wo.title, `/work-orders/${wo.id}`, c);
      await audit(u.id, "ASSIGN_TEAM", "work_order", wo.id, old, { pm, execs, support }, c);
    });
    revalidatePath(`/work-orders/${wo.id}`);
    return { ok: true, message: "Team updated" };
  });
}

export async function progressAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const wo = await loadWo(u, s(fd, "id"), "edit");
    const pctv = n(fd, "pct");
    if (pctv < 0 || pctv > 100) throw new BizError("Progress must be 0–100");
    await pool.query(`update work_order set pct_complete=$2, status=$3, end_date=coalesce($4, end_date) where id=$1`, [wo.id, pctv, s(fd, "status"), opt(fd, "end_date")]);
    await audit(u.id, "PROGRESS", "work_order", wo.id, { pct: wo.pct_complete, status: wo.status }, { pct: pctv, status: s(fd, "status") });
    revalidatePath(`/work-orders/${wo.id}`);
    return { ok: true, message: "Progress updated" };
  });
}

export async function addCostAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const wo = await loadWo(u, s(fd, "id"), "view");
    if (!can(u, "work_orders", "edit") && !can(u, "finance", "create")) throw new BizError("Not permitted to book costs");
    const amt = n(fd, "amount");
    if (amt <= 0) throw new BizError("Amount must be positive");
    const bill = await saveUploads(fd.getAll("bill") as File[], { entity: "work_order", entityId: wo.id, folder: "11 Invoices & Payments", userId: u.id });
    const r = await one(`insert into cost_entry(cost_centre, wo_id, category, description, amount, gst_amount, entry_date, source_type, bill_attachment_id, created_by)
      values ('WO',$1,$2,$3,$4,$5,coalesce($6::date,current_date),'MANUAL',$7,$8) returning id`,
      [wo.id, s(fd, "category"), s(fd, "description"), amt, n(fd, "gst"), opt(fd, "date"), bill[0]?.id ?? null, u.id]);
    await audit(u.id, "CREATE", "cost_entry", r!.id, null, { wo: wo.wo_no, category: s(fd, "category"), amount: amt });
    const pnl = await one(`select consumed_pct, budget_cost from v_wo_pnl where id=$1`, [wo.id]);
    if (Number(pnl?.consumed_pct) > 100) {
      const pm = await q(`select employee_id from wo_team where wo_id=$1 and team_role='PM'`, [wo.id]);
      await notify(pm.map((x) => x.employee_id), `Budget overrun on ${wo.wo_no}`, `${pnl!.consumed_pct}% of budget consumed`, `/work-orders/${wo.id}`);
    }
    revalidatePath(`/work-orders/${wo.id}`);
    return { ok: true, message: "Cost booked to WO" };
  });
}

export async function milestoneAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const m = await one(`select * from milestone where id=$1`, [s(fd, "mid")]);
    if (!m) throw new BizError("Milestone not found");
    await loadWo(u, m.wo_id, "edit");
    if (s(fd, "due")) await pool.query(`update milestone set due_date=$2 where id=$1`, [m.id, s(fd, "due")]);
    if (s(fd, "done") === "1") await pool.query(`update milestone set status='DONE', done_at=current_date where id=$1 and status='PENDING'`, [m.id]);
    await audit(u.id, "EDIT", "milestone", m.id, { status: m.status, due: m.due_date }, { done: s(fd, "done"), due: s(fd, "due") });
    if (s(fd, "done") === "1") await notify(await q(`select e.id from employee e join role r on r.id=e.role_id where r.code='ACCOUNTS_MANAGER'`).then((r) => r.map((x) => x.id)), "Milestone achieved — raise invoice", m.name, `/work-orders/${m.wo_id}`);
    revalidatePath(`/work-orders/${m.wo_id}`);
    return { ok: true };
  });
}

export async function uploadWoDocsAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const wo = await loadWo(u, s(fd, "id"), "view");
    const saved = await saveUploads(fd.getAll("files") as File[], { entity: "work_order", entityId: wo.id, folder: s(fd, "folder"), userId: u.id });
    if (!saved.length) throw new BizError("Choose files");
    await audit(u.id, "UPLOAD", "work_order", wo.id, null, { folder: s(fd, "folder"), files: saved.map((x) => x.file_name) });
    revalidatePath(`/work-orders/${wo.id}`);
    return { ok: true, message: `${saved.length} file(s) uploaded` };
  });
}

// ---- Purchase: editable auto-drafted POs ----
export async function savePoAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    need(u, "purchase", "edit");
    const po = await one(`select * from purchase_order where id=$1`, [s(fd, "id")]);
    if (!po || po.status !== "DRAFT") throw new BizError("Only draft POs can be edited");
    const ids = fd.getAll("line_id").map(String), qty = fd.getAll("qty").map(Number), rate = fd.getAll("rate").map(Number), gst = fd.getAll("gst").map(Number), spec = fd.getAll("spec").map(String);
    await tx(async (c) => {
      let total = 0, gstT = 0;
      for (let i = 0; i < ids.length; i++) {
        if (!(qty[i] > 0) || rate[i] < 0) throw new BizError(`Line ${i + 1}: invalid qty/rate`);
        await c.query(`update po_line set qty=$2, rate=$3, gst_pct=$4, specification=$5 where id=$1 and po_id=$6`, [ids[i], qty[i], rate[i], gst[i], spec[i], po.id]);
        total += qty[i] * rate[i]; gstT += (qty[i] * rate[i] * gst[i]) / 100;
      }
      await c.query(`update purchase_order set vendor_id=$2, delivery_date=$3, terms=$4, total=$5, gst_total=$6 where id=$1`, [po.id, opt(fd, "vendor_id"), opt(fd, "delivery_date"), s(fd, "terms"), Math.round(total * 100) / 100, Math.round(gstT * 100) / 100]);
      await audit(u.id, "EDIT", "purchase_order", po.id, { total: po.total, vendor: po.vendor_id }, { total, vendor: opt(fd, "vendor_id") }, c);
    });
    revalidatePath(`/purchase/${po.id}`);
    return { ok: true, message: "PO saved" };
  });
}

export async function submitPoAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    need(u, "purchase", "edit");
    const id = s(fd, "id");
    // budget control: warn if PO exceeds WO budget for these lines
    const over = await one(`select sum(qty*rate) po, sum(qty*budget_rate) budget from po_line where po_id=$1`, [id]);
    if (Number(over?.po) > Number(over?.budget) * 1.0001 && s(fd, "ack_over") !== "1")
      return { ok: false, error: `PO value ₹${Math.round(over!.po).toLocaleString("en-IN")} exceeds cost-sheet budget ₹${Math.round(over!.budget).toLocaleString("en-IN")} for these lines. Tick "Acknowledge budget overrun" to submit anyway (approver will see it).` };
    await submitPoForApproval(id, u.id);
    revalidatePath(`/purchase/${id}`);
    return { ok: true, message: "Submitted for approval as per PO value matrix" };
  });
}
