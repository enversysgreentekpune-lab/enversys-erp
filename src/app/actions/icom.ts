"use server";
import { revalidatePath } from "next/cache";
import { requireUser, need, can } from "@/lib/auth";
import { one } from "@/lib/db";
import { safe, s, n, opt } from "@/lib/action";
import { BizError } from "@/lib/workflow";
import { saveUploads } from "@/lib/attachments";
import * as IC from "@/lib/ic";
import * as OM from "@/lib/om";

const up = (fd: FormData, key: string) => (fd.getAll(key) as File[]).filter((f) => f && typeof f !== "string" && f.size > 0);
const numOrNull = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? "").trim(); return v === "" ? null : Number(v); };

// ---------------- I&C ----------------
async function icFor(id: string, action: "view" | "create" | "edit") {
  const u = await requireUser();
  const scope = need(u, "field_services", action === "view" ? "view" : action);
  const ic = await IC.loadIc(id);
  if (scope !== "company") {
    const mine = ic.engineer_id === u.id || (await one(`select 1 from wo_team where wo_id=$1 and employee_id=$2`, [ic.wo_id, u.id]));
    if (!mine) throw new BizError("You are not on this project's I&C team");
  }
  return { u, ic };
}

export async function icUpdateAction(_: any, fd: FormData) {
  return safe(async () => {
    const { u, ic } = await icFor(s(fd, "ic_id"), "create");
    const signed = fd.get("client_signed") === "on";
    const signedFiles = up(fd, "signed_report");
    if (signed && !signedFiles.length) throw new BizError("Upload the report signed by the client");
    const upd = await IC.addIcUpdate(ic.id, { date: opt(fd, "date") ?? undefined, stage: s(fd, "stage"), pct: n(fd, "pct"), activity: s(fd, "activity"), manpower: numOrNull(fd, "manpower"), issues: s(fd, "issues"), clientSigned: signed, clientRep: s(fd, "client_rep") }, u.id);
    await saveUploads(up(fd, "evidence"), { entity: "ic_update", entityId: upd.id, folder: "09 I&C and Handover", userId: u.id, docType: "IC_EVIDENCE" });
    await saveUploads(signedFiles, { entity: "ic_update", entityId: upd.id, folder: "09 I&C and Handover", userId: u.id, docType: IC.IC_DOCS.clientReport });
    revalidatePath(`/ic/${ic.id}`); revalidatePath("/ic");
    return { ok: true, message: "Progress updated" };
  });
}

export async function icDetailsAction(_: any, fd: FormData) {
  return safe(async () => {
    const { u, ic } = await icFor(s(fd, "ic_id"), "edit");
    await IC.setIcDetails(ic.id, { engineerId: opt(fd, "engineer_id"), siteAddress: s(fd, "site_address"), targetDate: opt(fd, "target_date"), observations: s(fd, "observations") }, u.id);
    revalidatePath(`/ic/${ic.id}`);
    return { ok: true, message: "Saved" };
  });
}

export async function icGenerateAction(_: any, fd: FormData) {
  return safe(async () => {
    const { u, ic } = await icFor(s(fd, "ic_id"), "edit");
    const files = await IC.generateHandoverDocs(ic.id, u.id);
    revalidatePath(`/ic/${ic.id}`); revalidatePath("/ic");
    return { ok: true, message: `${files.length} documents generated` };
  });
}

export async function icSendAction(_: any, fd: FormData) {
  return safe(async () => {
    const { u, ic } = await icFor(s(fd, "ic_id"), "edit");
    await IC.sendHandoverDocs(ic.id, s(fd, "to"), opt(fd, "cc") ?? undefined, s(fd, "note"), { id: u.id, name: u.name });
    revalidatePath(`/ic/${ic.id}`);
    return { ok: true, message: `Sent to ${s(fd, "to")}` };
  });
}

export async function icSignedAction(_: any, fd: FormData) {
  return safe(async () => {
    const { u, ic } = await icFor(s(fd, "ic_id"), "edit");
    const kind = s(fd, "kind") === "APPRECIATION" ? "APPRECIATION" : "HANDOVER";
    const files = up(fd, "file");
    if (!files.length) throw new BizError("Choose the signed copy (PDF or photo)");
    const [att] = await saveUploads(files.slice(0, 1), { entity: "ic_project", entityId: ic.id, folder: "09 I&C and Handover", userId: u.id, docType: kind === "HANDOVER" ? IC.IC_DOCS.signedHandover : IC.IC_DOCS.signedAppreciation });
    const r = await IC.recordSignedCertificate(ic.id, kind, att.id, u.id);
    revalidatePath(`/ic/${ic.id}`); revalidatePath("/ic"); revalidatePath("/md");
    return { ok: true, message: r.completed ? "Both signed certificates received — project completed" : `Signed ${kind === "HANDOVER" ? "handover" : "appreciation"} certificate saved` };
  });
}

// ---------------- O&M ----------------
async function omUser() { const u = await requireUser(); need(u, "field_services", "view"); return u; }

export async function omLogAction(_: any, fd: FormData) {
  return safe(async () => {
    const u = await omUser();
    const chem = fd.getAll("chemical").map(String), cq = fd.getAll("chem_qty").map(Number), cu = fd.getAll("chem_uom").map(String);
    await OM.saveDailyLog(u, s(fd, "site_id"), {
      date: s(fd, "date"), presentIds: fd.getAll("present").map(String), waterTreated: n(fd, "water"), energyKwh: n(fd, "energy"),
      status: s(fd, "status") as any, issueNote: s(fd, "issue_note"), chemicals: chem.map((c, i) => ({ chemical: c, qty: cq[i] || 0, uom: cu[i] || "KG" })),
      inletPh: numOrNull(fd, "inlet_ph"), outletPh: numOrNull(fd, "outlet_ph"), outletTss: numOrNull(fd, "outlet_tss"), outletBod: numOrNull(fd, "outlet_bod"), outletCod: numOrNull(fd, "outlet_cod"), remarks: s(fd, "remarks"),
    });
    revalidatePath("/om");
    return { ok: true, message: "Daily report saved" };
  });
}

export async function omSpareAction(_: any, fd: FormData) {
  return safe(async () => {
    const u = await omUser();
    if (fd.get("spare_id")) await OM.spareMove(u, s(fd, "spare_id"), s(fd, "kind") === "IN" ? "IN" : "OUT", n(fd, "qty"), s(fd, "note"));
    else await OM.addSpare(u, s(fd, "site_id"), { name: s(fd, "name"), partNo: s(fd, "part_no"), uom: s(fd, "uom"), qty: n(fd, "qty"), minQty: n(fd, "min_qty") });
    revalidatePath("/om");
    return { ok: true, message: "Spares register updated" };
  });
}

export async function omRequisitionAction(_: any, fd: FormData) {
  return safe(async () => {
    const u = await omUser();
    const d = fd.getAll("description").map(String), q = fd.getAll("qty").map(Number), uom = fd.getAll("uom").map(String);
    const r = await OM.raiseOmRequisition(u, s(fd, "site_id"), { kind: s(fd, "kind") as any, reason: s(fd, "reason"), lines: d.map((x, i) => ({ description: x, qty: q[i] || 0, uom: uom[i] || "NOS" })) });
    revalidatePath("/om");
    return { ok: true, message: `${r.req_no} sent to the O&M supervisor` };
  });
}

export async function omRequisitionDecideAction(_: any, fd: FormData) {
  return safe(async () => {
    const u = await omUser();
    await OM.decideOmRequisition(u, s(fd, "id"), s(fd, "status") as any, s(fd, "note"));
    revalidatePath("/om");
    return { ok: true, message: "Requisition updated" };
  });
}

export async function omTicketAction(_: any, fd: FormData) {
  return safe(async () => {
    const u = await omUser();
    const t = await OM.createTicket(u, s(fd, "site_id"), { source: s(fd, "source") as any, clientName: s(fd, "client_name"), category: s(fd, "category"), priority: s(fd, "priority"), title: s(fd, "title"), description: s(fd, "description") });
    await saveUploads(up(fd, "photos"), { entity: "om_ticket", entityId: t.id, folder: "O&M Tickets", userId: u.id });
    revalidatePath("/om");
    return { ok: true, message: `Ticket ${t.ticket_no} raised` };
  });
}

export async function omTicketUpdateAction(_: any, fd: FormData) {
  return safe(async () => {
    const u = await omUser();
    await OM.updateTicket(u, s(fd, "id"), { status: s(fd, "status"), resolution: s(fd, "resolution") });
    revalidatePath("/om");
    return { ok: true, message: "Ticket updated" };
  });
}

export async function omVisitAction(_: any, fd: FormData) {
  return safe(async () => {
    const u = await omUser();
    const r = await OM.addVisitReport(u, s(fd, "site_id"), { date: s(fd, "date"), observations: s(fd, "observations"), recommendations: s(fd, "recommendations") });
    await saveUploads(up(fd, "photos"), { entity: "om_report", entityId: r.id, folder: "O&M Reports", userId: u.id });
    revalidatePath("/om");
    return { ok: true, message: "Visit report saved. Download it or submit it to the client below." };
  });
}

export async function omSubmitReportAction(_: any, fd: FormData) {
  return safe(async () => {
    const u = await omUser();
    if (!can(u, "field_services", "create")) throw new BizError("Not allowed");
    await OM.submitReport(u, { siteId: s(fd, "site_id"), kind: s(fd, "kind") === "VISIT" ? "VISIT" : "MONTHLY", period: s(fd, "period"), reportId: opt(fd, "report_id") ?? undefined, to: s(fd, "to") });
    revalidatePath("/om");
    return { ok: true, message: `Report emailed to ${s(fd, "to")}` };
  });
}
