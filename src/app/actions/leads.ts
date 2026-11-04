"use server";
import { revalidatePath } from "next/cache";
import { requireUser, need, can } from "@/lib/auth";
import { tx, one, q, pool } from "@/lib/db";
import { nextNo } from "@/lib/numbering";
import { audit, diff } from "@/lib/audit";
import { safe, s, n, opt } from "@/lib/action";
import { changeLeadStage, BizError, createProposal } from "@/lib/workflow";
import { saveUploads } from "@/lib/attachments";
import { notify, createTask } from "@/lib/notify";
import { sendMail } from "@/lib/email";
import { loadLead } from "@/lib/access";

export async function createLeadAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    need(u, "leads", "create");
    let customerId = s(fd, "customer_id");
    const title = s(fd, "title");
    if (!title) throw new BizError("Title is required");
    if (!s(fd, "vertical_id")) throw new BizError("Select a business vertical");
    const id = await tx(async (c) => {
      if (!customerId) {
        const name = s(fd, "new_customer");
        if (!name) throw new BizError("Select a customer or enter a new customer name");
        const dup = await one(`select id, name from customer where lower(name)=lower($1)`, [name], c);
        if (dup) customerId = dup.id;
        else {
          const code = await nextNo(c, "CUSTOMER");
          customerId = (await one(`insert into customer(code, name, owner_id, source, created_by) values ($1,$2,$3,$4,$3) returning id`, [code, name, u.id, s(fd, "source") || "MANUAL"], c))!.id;
          await audit(u.id, "CREATE", "customer", customerId, null, { code, name, via: "lead" }, c);
        }
      }
      let contactId = opt(fd, "contact_id");
      if (!contactId && s(fd, "contact_name"))
        contactId = (await one(`insert into contact(customer_id, name, email, mobile) values ($1,$2,$3,$4) returning id`, [customerId, s(fd, "contact_name"), opt(fd, "contact_email"), opt(fd, "contact_mobile")], c))!.id;
      const no = await nextNo(c, "LEAD");
      const assigned = opt(fd, "assigned_to") ?? u.id;
      const l = await one(`insert into lead(enquiry_no, enquiry_date, customer_id, contact_id, vertical_id, category, title, scope, site_location, est_value, expected_closure, priority, source, assigned_to,
          tender_no, emd_amount, bid_due_date, prebid_date, next_followup_at, created_by)
        values ($1,coalesce($2::date, current_date),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) returning id`,
        [no, opt(fd, "enquiry_date"), customerId, contactId, s(fd, "vertical_id"), opt(fd, "category"), title, opt(fd, "scope"), opt(fd, "site_location"), n(fd, "est_value"),
          opt(fd, "expected_closure"), s(fd, "priority") || "MEDIUM", s(fd, "source") || "MANUAL", assigned, opt(fd, "tender_no"), n(fd, "emd_amount") || null,
          opt(fd, "bid_due_date"), opt(fd, "prebid_date"), opt(fd, "next_followup_at"), u.id], c);
      await c.query(`insert into activity(entity, entity_id, kind, subject, body, created_by) values ('lead',$1,'SYSTEM','Enquiry registered',$2,$3)`, [l!.id, `Source: ${s(fd, "source") || "MANUAL"}`, u.id]);
      await saveUploads(fd.getAll("files") as File[], { entity: "lead", entityId: l!.id, folder: "01 Enquiry & RFQ", userId: u.id, db: c });
      if (assigned !== u.id) await notify([assigned], "New lead assigned", `${no}: ${title}`, `/leads/${l!.id}`, c);
      if (s(fd, "next_followup_at")) await createTask({ title: `Follow up: ${no}`, entity: "lead", entityId: l!.id, link: `/leads/${l!.id}`, assignedTo: assigned, createdBy: u.id, dueAt: s(fd, "next_followup_at") }, c);
      await audit(u.id, "CREATE", "lead", l!.id, null, { enquiry_no: no, title, est_value: n(fd, "est_value") }, c);
      return l!.id;
    });
    return { ok: true, redirect: `/leads/${id}` };
  });
}

export async function updateLeadAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const old = await loadLead(u, s(fd, "id"), "edit");
    const next = { title: s(fd, "title"), scope: opt(fd, "scope"), est_value: n(fd, "est_value"), expected_closure: opt(fd, "expected_closure"), priority: s(fd, "priority"),
      assigned_to: opt(fd, "assigned_to") ?? old.assigned_to, site_location: opt(fd, "site_location"), category: opt(fd, "category"),
      tender_no: opt(fd, "tender_no"), bid_due_date: opt(fd, "bid_due_date") };
    await pool.query(`update lead set title=$2, scope=$3, est_value=$4, expected_closure=$5, priority=$6, assigned_to=$7, site_location=$8, category=$9, tender_no=$10, bid_due_date=$11, updated_at=now() where id=$1`,
      [old.id, ...Object.values(next)]);
    const d = diff(old, next);
    if (d.changed) await audit(u.id, "EDIT", "lead", old.id, d.old, d.new);
    if (next.assigned_to !== old.assigned_to) {
      await notify([next.assigned_to], "Lead re-assigned to you", `${old.enquiry_no}: ${next.title}`, `/leads/${old.id}`);
      await pool.query(`insert into activity(entity, entity_id, kind, subject, created_by) values ('lead',$1,'SYSTEM','Lead re-assigned',$2)`, [old.id, u.id]);
    }
    revalidatePath(`/leads/${old.id}`);
    return { ok: true, message: "Lead updated" };
  });
}

export async function changeStageAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const lead = await loadLead(u, s(fd, "id"), "edit");
    if (s(fd, "stage") === "WON") throw new BizError("Mark the proposal as Won (with customer PO) to win the lead");
    await changeLeadStage(lead.id, s(fd, "stage"), s(fd, "remark"), u.id,
      { reason: opt(fd, "lost_reason") ?? undefined, competitor: opt(fd, "competitor") ?? undefined, competitorPrice: n(fd, "competitor_price") || null });
    revalidatePath(`/leads/${lead.id}`);
    return { ok: true, message: "Stage updated" };
  });
}

export async function logActivityAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const lead = await loadLead(u, s(fd, "id"), "edit");
    const kind = s(fd, "kind");
    if (!["CALL", "MEETING", "NOTE", "FOLLOWUP"].includes(kind)) throw new BizError("Bad activity type");
    const lat = n(fd, "lat") || null, lng = n(fd, "lng") || null;
    await pool.query(`insert into activity(entity, entity_id, kind, subject, body, lat, lng, created_by) values ('lead',$1,$2,$3,$4,$5,$6,$7)`,
      [lead.id, kind, s(fd, "subject") || kind, opt(fd, "body"), lat, lng, u.id]);
    const nf = opt(fd, "next_followup_at");
    if (nf) {
      await pool.query(`update lead set next_followup_at=$2, updated_at=now() where id=$1`, [lead.id, nf]);
      await pool.query(`update task set status='DONE', done_at=now() where entity='lead' and entity_id=$1 and status in ('TODO','IN_PROGRESS') and title like 'Follow up:%'`, [lead.id]);
      await createTask({ title: `Follow up: ${lead.enquiry_no}`, description: lead.title, entity: "lead", entityId: lead.id, link: `/leads/${lead.id}`, assignedTo: lead.assigned_to ?? u.id, createdBy: u.id, dueAt: nf });
    }
    await audit(u.id, "LOG_" + kind, "lead", lead.id, null, { subject: s(fd, "subject"), next_followup_at: nf, geo: lat ? [lat, lng] : null });
    revalidatePath(`/leads/${lead.id}`);
    return { ok: true, message: "Logged" };
  });
}

export async function uploadLeadDocsAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const lead = await loadLead(u, s(fd, "id"), "edit");
    const saved = await saveUploads(fd.getAll("files") as File[], { entity: "lead", entityId: lead.id, folder: s(fd, "folder") || "01 Enquiry & RFQ", userId: u.id });
    if (!saved.length) throw new BizError("Choose at least one file");
    await pool.query(`insert into activity(entity, entity_id, kind, subject, body, created_by) values ('lead',$1,'DOC',$2,$3,$4)`, [lead.id, `${saved.length} document(s) uploaded`, saved.map((x) => `${x.file_name} (v${x.version})`).join(", "), u.id]);
    await audit(u.id, "UPLOAD", "lead", lead.id, null, { files: saved.map((x) => x.file_name) });
    revalidatePath(`/leads/${lead.id}`);
    return { ok: true, message: "Uploaded" };
  });
}

/** Email from a lead (optionally on behalf of a proposal): templates, existing attachments and new uploads */
export async function sendLeadEmailAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const lead = await loadLead(u, s(fd, "lead_id"), "send");
    const to = s(fd, "to");
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+(\s*,\s*[^@\s]+@[^@\s]+\.[^@\s]+)*$/.test(to)) throw new BizError("Enter valid recipient email(s), comma-separated");
    if (!s(fd, "subject")) throw new BizError("Subject is required");
    const uploaded = await saveUploads(fd.getAll("files") as File[], { entity: "lead", entityId: lead.id, folder: "13 Correspondence", userId: u.id });
    const ids = [...fd.getAll("att").map(String).filter(Boolean), ...uploaded.map((x) => x.id)];
    const proposalId = opt(fd, "proposal_id");
    // threading: reply to latest inbound on this lead if present
    const lastIn = await one(`select message_id from email_message where lead_id=$1 and direction='IN' order by created_at desc limit 1`, [lead.id]);
    const subject = s(fd, "subject").includes(lead.enquiry_no) ? s(fd, "subject") : `[${lead.enquiry_no}] ${s(fd, "subject")}`;
    const body = s(fd, "body").includes("<") ? s(fd, "body") : s(fd, "body").split("\n").map((l) => `<p>${l.replace(/</g, "&lt;")}</p>`).join("");
    const m = await sendMail({ leadId: lead.id, proposalId, to, cc: s(fd, "cc"), subject, html: body, attachmentIds: ids, sentBy: u.id, inReplyTo: lastIn?.message_id });
    const names = ids.length ? (await q(`select file_name from attachment where id = any($1::uuid[])`, [ids])).map((a) => a.file_name) : [];
    await pool.query(`insert into activity(entity, entity_id, kind, subject, body, meta, created_by) values ('lead',$1,'EMAIL_OUT',$2,$3,$4,$5)`,
      [lead.id, subject, `To: ${to}${names.length ? `\nAttachments: ${names.join(", ")}` : ""}`, JSON.stringify({ email_id: m.id }), u.id]);
    await audit(u.id, "SEND_EMAIL", "lead", lead.id, null, { to, subject, attachments: names, proposal_id: proposalId });
    if (proposalId && s(fd, "mark_submitted") === "1") {
      const { setProposalStatus } = await import("@/lib/workflow");
      const p = await one(`select status from proposal where id=$1`, [proposalId]);
      if (p?.status === "APPROVED") await setProposalStatus(proposalId, "SUBMITTED", `Offer emailed to ${to}`, u.id);
    }
    revalidatePath(`/leads/${lead.id}`);
    if (proposalId) revalidatePath(`/proposals/${proposalId}`);
    return { ok: true, message: `Email sent to ${to}${names.length ? ` with ${names.length} attachment(s)` : ""}` };
  });
}

export async function startProposalAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const lead = await loadLead(u, s(fd, "id"), "create");
    const p = await createProposal(lead.id, u.id, s(fd, "title") || undefined);
    return { ok: true, redirect: `/proposals/${p.id}?tab=spec` };
  });
}
