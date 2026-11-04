"use server";
import { revalidatePath } from "next/cache";
import ExcelJS from "exceljs";
import { requireUser, can, need } from "@/lib/auth";
import { one, q, pool } from "@/lib/db";
import { audit } from "@/lib/audit";
import { safe, s, n, opt } from "@/lib/action";
import { saveRevision, newRevision, submitForApproval, setProposalStatus, markWon, BizError, type SpecIn, type CostIn } from "@/lib/workflow";
import { loadProposal } from "@/lib/access";
import { generateQuoteDocs } from "@/lib/quote";
import { saveUploads } from "@/lib/attachments";
import type { CostParams } from "@/lib/costing";

export async function saveRevisionAction(revisionId: string, payload: { spec: SpecIn[]; cost: CostIn[]; params: CostParams; terms: Record<string, string> }) {
  const u = await requireUser();
  return safe(async () => {
    const rev = await one(`select * from proposal_revision where id=$1`, [revisionId]);
    if (!rev) throw new BizError("Revision not found");
    await loadProposal(u, rev.proposal_id, "edit");
    let { cost, params } = payload;
    // users without cost-sheet edit rights cannot alter cost lines or commercial parameters
    if (!can(u, "costing", "edit")) {
      cost = (await q(`select spec_sl, category, description, qty, uom, rate, rate_source from cost_line where revision_id=$1`, [revisionId])) as CostIn[];
      params = rev.params;
    }
    const totals = await saveRevision(revisionId, { spec: payload.spec, cost, params, terms: payload.terms }, u.id, { canOverrideMargin: !!can(u, "costing", "approve") });
    revalidatePath(`/proposals/${rev.proposal_id}`);
    return { ok: true, message: `Saved. Net ₹${Math.round(totals.netSelling).toLocaleString("en-IN")}`, data: totals };
  });
}

export async function newRevisionAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const p = await loadProposal(u, s(fd, "id"), "edit");
    await newRevision(p.id, u.id, s(fd, "notes"));
    revalidatePath(`/proposals/${p.id}`);
    return { ok: true, message: `Revision R${p.current_rev + 1} created` };
  });
}

export async function submitApprovalAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const p = await loadProposal(u, s(fd, "id"), "edit");
    const a = await submitForApproval(p.id, u.id);
    revalidatePath(`/proposals/${p.id}`);
    return { ok: true, message: `Sent for internal approval to ${a.approver_role.replace(/_/g, " ").toLowerCase()}` };
  });
}

export async function setStatusAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const p = await loadProposal(u, s(fd, "id"), "edit");
    await setProposalStatus(p.id, s(fd, "status"), s(fd, "remark"), u.id,
      { reason: opt(fd, "lost_reason") ?? undefined, competitor: opt(fd, "competitor") ?? undefined, competitorPrice: n(fd, "competitor_price") || null });
    revalidatePath(`/proposals/${p.id}`);
    return { ok: true, message: "Status updated" };
  });
}

export async function generateDocsAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const p = await loadProposal(u, s(fd, "id"), "view");
    const kinds = fd.getAll("kind").map(String) as ("docx" | "xlsx")[];
    const docs = await generateQuoteDocs(p.id, u.id, kinds.length ? kinds : ["docx", "xlsx"]);
    await pool.query(`insert into activity(entity, entity_id, kind, subject, body, created_by) values ('lead',$1,'DOC',$2,$3,$4)`,
      [p.lead_id, `Quote documents generated for ${p.proposal_no} R${p.current_rev}`, docs.map((d) => d.file_name).join(", "), u.id]);
    await audit(u.id, "GENERATE_DOCS", "proposal", p.id, null, { files: docs.map((d) => d.file_name) });
    revalidatePath(`/proposals/${p.id}`);
    return { ok: true, message: `Generated: ${docs.map((d) => d.file_name).join(", ")}` };
  });
}

export async function markWonAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const p = await loadProposal(u, s(fd, "id"), "edit");
    need(u, "leads", "approve");
    const up = await saveUploads(fd.getAll("po_file") as File[], { entity: "proposal", entityId: p.id, folder: "03 Customer PO & LOI", userId: u.id });
    const wo = await markWon(p.id, {
      poNo: s(fd, "po_no"), poDate: s(fd, "po_date"), poValue: n(fd, "po_value"), agreedChanges: s(fd, "changes"), woType: s(fd, "wo_type"),
      pmId: opt(fd, "pm_id"), executorIds: fd.getAll("executors").map(String).filter(Boolean), startDate: opt(fd, "start_date") ?? undefined, endDate: opt(fd, "end_date") ?? undefined,
      attachmentId: up[0]?.id ?? null,
    }, u.id);
    return { ok: true, redirect: `/work-orders/${wo.id}` };
  });
}

/** Material spec import: Sl | Item code | Description | Specification | Make | MOC | Size/Rating | Standard | Qty | UOM | Drawing ref | Remarks | GST% */
export async function importSpecAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const rev = await one(`select * from proposal_revision where id=$1`, [s(fd, "revision_id")]);
    if (!rev) throw new BizError("Revision not found");
    await loadProposal(u, rev.proposal_id, "edit");
    const f = fd.get("file") as File | null;
    if (!f?.size) throw new BizError("Choose an .xlsx file");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await f.arrayBuffer()) as any);
    const ws = wb.worksheets[0];
    const spec: SpecIn[] = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const v = (c: number) => { const x = ws.getRow(r).getCell(c).value; return x == null ? "" : String((x as any).result ?? (x as any).text ?? x).trim(); };
      if (!v(3)) continue;
      spec.push({ sl: spec.length + 1, item_code: v(2), description: v(3), specification: v(4), make: v(5), moc: v(6), size_rating: v(7), standard: v(8), qty: Number(v(9)) || 1, uom: v(10) || "NOS", drawing_ref: v(11), remarks: v(12), gst_pct: Number(v(13)) || 18 });
    }
    if (!spec.length) throw new BizError("No rows found (row 1 must be headers; description in column C)");
    const cost = (await q(`select spec_sl, category, description, qty, uom, rate, rate_source from cost_line where revision_id=$1`, [rev.id])) as CostIn[];
    await saveRevision(rev.id, { spec, cost: cost.filter((c) => c.spec_sl == null || c.spec_sl <= spec.length), params: rev.params, terms: rev.terms }, u.id, { canOverrideMargin: true });
    revalidatePath(`/proposals/${rev.proposal_id}`);
    return { ok: true, message: `Imported ${spec.length} spec line(s)` };
  });
}
