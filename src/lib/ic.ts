// Installation & Commissioning: every dispatched project enters I&C automatically. Progress is
// updated with evidence and client-signed reports; the handover report, handover certificate and
// appreciation certificate are generated from project data and mailed to the client. The project is
// completed only after the signed handover and appreciation certificates are uploaded.
import { one, q, tx, pool, type Db } from "./db";
import { audit } from "./audit";
import { notify } from "./notify";
import { BizError } from "./workflow";
import { saveAttachment } from "./attachments";
import { sendMail } from "./email";
import { buildDoc, H, P, KV, GRID, SIGN, fmtDate, fmtNum, lbl } from "./reports";

export const IC_STAGES = ["MATERIAL_AT_SITE", "ERECTION", "PIPING_ELECTRICAL", "PRE_COMMISSIONING", "COMMISSIONING", "TRIAL_RUN", "PERFORMANCE_TEST", "HANDOVER"] as const;
export const IC_STAGE_LABEL: Record<string, string> = {
  MATERIAL_AT_SITE: "Material at site", ERECTION: "Erection & installation", PIPING_ELECTRICAL: "Piping & electrical", PRE_COMMISSIONING: "Pre-commissioning checks",
  COMMISSIONING: "Commissioning", TRIAL_RUN: "Trial run", PERFORMANCE_TEST: "Performance test", HANDOVER: "Handover",
};
export const IC_DOCS = { report: "IC_HANDOVER_REPORT", handover: "IC_HANDOVER_CERT", appreciation: "IC_APPRECIATION_CERT", signedHandover: "IC_HANDOVER_SIGNED", signedAppreciation: "IC_APPRECIATION_SIGNED", clientReport: "IC_CLIENT_SIGNED_REPORT" } as const;

/** Called when a project is dispatched: creates its I&C record (idempotent) */
export async function ensureIcProject(woId: string, db: Db = pool) {
  await db.query(`insert into ic_project(wo_id) values ($1) on conflict (wo_id) do nothing`, [woId]);
}

export async function loadIc(icId: string, db: Db = pool) {
  const ic = await one(`select ic.*, w.wo_no, w.title, w.status wo_status, w.contract_value, w.site_location, w.start_date wo_start, w.end_date wo_end, w.order_class,
      (select employee_id from wo_team t where t.wo_id=w.id and t.team_role='PM' limit 1) pm_id,
      c.name customer, c.email customer_email, c.id customer_id, e.name engineer, cp.po_no, cp.po_date
    from ic_project ic join work_order w on w.id=ic.wo_id join customer c on c.id=w.customer_id left join employee e on e.id=ic.engineer_id
    left join customer_po cp on cp.id=w.customer_po_id where ic.id=$1`, [icId], db);
  if (!ic) throw new BizError("I&C record not found");
  return ic;
}

export interface IcUpdateIn { date?: string; stage: string; pct: number; activity: string; manpower?: number | null; issues?: string; clientSigned?: boolean; clientRep?: string }
export async function addIcUpdate(icId: string, inp: IcUpdateIn, actorId: string, db?: Db) {
  if (!IC_STAGES.includes(inp.stage as any)) throw new BizError("Choose a valid I&C stage");
  if (!(inp.pct >= 0 && inp.pct <= 100)) throw new BizError("Progress must be 0–100%");
  if (!inp.activity?.trim()) throw new BizError("Describe the work done");
  if (inp.clientSigned && !inp.clientRep?.trim()) throw new BizError("Enter the client representative who signed the report");
  const run = async (c: Db) => {
    const ic = await one(`select * from ic_project where id=$1 for update`, [icId], c);
    if (!ic) throw new BizError("I&C record not found");
    if (ic.status === "COMPLETED") throw new BizError("This project is already handed over and completed");
    const u = await one(`insert into ic_update(ic_id, update_date, stage, pct, activity, manpower, issues, client_signed, client_rep, created_by)
      values ($1,coalesce($2::date,current_date),$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [icId, inp.date || null, inp.stage, inp.pct, inp.activity.trim(), inp.manpower ?? null, inp.issues || null, !!inp.clientSigned, inp.clientRep || null, actorId], c);
    await c.query(`update ic_project set stage=$2, pct=greatest(pct,$3), status=case when status='NOT_STARTED' then 'IN_PROGRESS' else status end,
        start_date=coalesce(start_date, coalesce($4::date,current_date)) where id=$1`, [icId, inp.stage, inp.pct, inp.date || null]);
    await audit(actorId, "IC_UPDATE", "ic_project", icId, { stage: ic.stage, pct: ic.pct }, { stage: inp.stage, pct: inp.pct }, c);
    return u!;
  };
  return db ? run(db) : tx(run);
}

export async function setIcDetails(icId: string, inp: { engineerId?: string | null; siteAddress?: string; targetDate?: string | null; observations?: string }, actorId: string) {
  await pool.query(`update ic_project set engineer_id=coalesce($2, engineer_id), site_address=coalesce(nullif($3,''), site_address), target_date=coalesce($4::date, target_date), observations=coalesce($5, observations) where id=$1`,
    [icId, inp.engineerId || null, inp.siteAddress ?? "", inp.targetDate || null, inp.observations ?? null]);
  await audit(actorId, "EDIT", "ic_project", icId, null, inp);
}

/** Builds the handover report, handover certificate and appreciation certificate as Word files */
export async function generateHandoverDocs(icId: string, actorId: string) {
  const ic = await loadIc(icId);
  if (Number(ic.pct) < 100) throw new BizError("Handover documents can be generated once I&C progress reaches 100%");
  const [co, spec, updates, dispatches, evidence, team, contact] = await Promise.all([
    one(`select * from company limit 1`),
    q(`select s.project_item_code, s.description, s.specification, s.make, s.qty, s.uom,
        coalesce((select sum(dl.qty) from dispatch_line dl where dl.wo_spec_line_id=s.id),0) sent from wo_spec_line s where s.wo_id=$1 order by s.sl`, [ic.wo_id]),
    q(`select u.*, e.name by_name, (select count(*)::int from attachment a where a.entity='ic_update' and a.entity_id=u.id) files
        from ic_update u left join employee e on e.id=u.created_by where u.ic_id=$1 order by u.update_date, u.created_at`, [icId]),
    q(`select dispatch_no, dispatch_date, vehicle_no, status, delivered_date, received_by_name from dispatch where wo_id=$1 order by dispatch_date`, [ic.wo_id]),
    one(`select count(*)::int n from attachment a join ic_update u on u.id=a.entity_id where a.entity='ic_update' and u.ic_id=$1`, [icId]),
    q(`select distinct e.name, coalesce(r.name,'') role from employee e join role r on r.id=e.role_id where e.id = any(array[$1::uuid,$2::uuid])`, [ic.engineer_id, ic.pm_id]),
    one(`select ct.name, ct.designation from contact ct where ct.customer_id=$1 order by ct.is_decision_maker desc limit 1`, [ic.customer_id]),
  ]);
  const signedReports = updates.filter((u) => u.client_signed);
  const lastDate = updates.at(-1)?.update_date;
  const clientRep = contact ? `${contact.name}${contact.designation ? ", " + contact.designation : ""}` : "Client representative";
  const head: [string, string][] = [
    ["Project code", ic.wo_no], ["Project", ic.title], ["Client", ic.customer], ["Client PO / order", ic.po_no ? `${ic.po_no} dated ${fmtDate(ic.po_date)}` : "—"],
    ["Site", ic.site_address ?? ic.site_location ?? "As per order"], ["I&C started", fmtDate(ic.start_date)], ["I&C completed", fmtDate(lastDate)],
  ];
  const report = await buildDoc(co, "Project Handover Report", `${ic.wo_no} · Installation & Commissioning`, [
    H("1. Project details"), KV(head),
    H("2. Scope supplied and installed"),
    GRID(["Item code", "Description", "Make / specification", "Qty", "Dispatched"], spec.map((s) => [s.project_item_code, s.description, [s.make, s.specification].filter(Boolean).join(" · "), `${fmtNum(s.qty)} ${s.uom}`, `${fmtNum(s.sent)} ${s.uom}`]), [16, 30, 30, 12, 12]),
    H("3. Dispatch record"),
    GRID(["Challan", "Date", "Vehicle", "Delivered", "Received by"], dispatches.map((d) => [d.dispatch_no, fmtDate(d.dispatch_date), d.vehicle_no, d.status === "DELIVERED" ? fmtDate(d.delivered_date) : "In transit", d.received_by_name ?? "—"])),
    H("4. Installation & commissioning log"),
    GRID(["Date", "Stage", "Progress", "Work done", "Client sign-off"], updates.map((u) => [fmtDate(u.update_date), lbl(IC_STAGE_LABEL[u.stage] ?? u.stage), `${fmtNum(u.pct, 0)}%`, u.activity + (u.issues ? `\nIssues: ${u.issues}` : ""), u.client_signed ? `Signed — ${u.client_rep}` : "—"]), [13, 18, 10, 43, 16]),
    P(`${updates.length} progress updates, ${signedReports.length} client-signed reports and ${evidence?.n ?? 0} photographs / documents are on record in the project dossier.`, { color: "64748B", italics: true }),
    H("5. Observations and pending points"),
    P(ic.observations?.trim() || "No pending points. The plant has been commissioned and handed over in working condition."),
    H("6. Documents handed over"),
    ...["Operation & maintenance manual", "As-built drawings and P&ID", "Equipment test certificates and warranty cards", "Commissioning and performance test reports", "List of spares supplied"].map((d) => P(`☐  ${d}`)),
    H("7. Enversys team"), GRID(["Name", "Role"], team.map((t) => [t.name, t.role])),
    SIGN(["For Enversys", "Project / I&C engineer"], [`For ${ic.customer}`, clientRep]),
  ]);
  const handover = await buildDoc(co, "Handover Certificate", `${ic.wo_no} · ${ic.customer}`, [
    P(`This is to certify that the plant / equipment under project ${ic.wo_no} — ${ic.title}${ic.po_no ? `, against order ${ic.po_no} dated ${fmtDate(ic.po_date)}` : ""} — has been installed, tested and commissioned by Enversys at our site${ic.site_address ? ` (${ic.site_address})` : ""}.`),
    P(`The plant was demonstrated to our satisfaction and is taken over by ${ic.customer} in good working condition on ____ / ____ / ________. Operation & maintenance documents listed in the handover report ${ic.wo_no} have been received.`),
    P("Warranty commences from the date of this handover as per the terms of the order."),
    KV([["Project code", ic.wo_no], ["Project", ic.title], ["Client", ic.customer], ["Commissioned on", fmtDate(lastDate)]]),
    SIGN([`For ${ic.customer}`, clientRep], ["For Enversys", "Project / I&C engineer"]),
  ]);
  const appreciation = await buildDoc(co, "Appreciation Certificate", `To be issued on ${ic.customer} letterhead`, [
    P("To whomsoever it may concern", { bold: true }),
    P(`We are pleased to certify that Enversys has successfully supplied, installed and commissioned ${ic.title} (project ${ic.wo_no}) at our site. The work was completed and handed over to us on ____ / ____ / ________.`),
    P("We appreciate the quality of the equipment, the professional conduct of the installation and commissioning team and the support given during trial run and handover."),
    P("We found the performance of the plant satisfactory and recommend Enversys for similar projects."),
    KV([["Project", ic.title], ["Enversys project code", ic.wo_no], ["Client order", ic.po_no ?? "—"]]),
    SIGN([`For ${ic.customer}`, clientRep], ["", ""]),
  ]);
  const safe = ic.wo_no.replace(/\//g, "-");
  const files = [
    [report, `${safe} Handover Report.docx`, IC_DOCS.report], [handover, `${safe} Handover Certificate.docx`, IC_DOCS.handover], [appreciation, `${safe} Appreciation Certificate.docx`, IC_DOCS.appreciation],
  ] as const;
  const saved = [];
  for (const [buf, name, docType] of files) saved.push(await saveAttachment({ entity: "ic_project", entityId: icId, fileName: name, buf, folder: "09 I&C and Handover", docType, userId: actorId }));
  await pool.query(`update ic_project set status=case when status='COMPLETED' then status else 'HANDOVER_PENDING' end, docs_generated_at=now() where id=$1`, [icId]);
  await audit(actorId, "GENERATE_HANDOVER", "ic_project", icId, null, { files: saved.map((s) => s.file_name) });
  return saved;
}

export async function latestDocs(icId: string, db: Db = pool) {
  return q(`select distinct on (doc_type) * from attachment where entity='ic_project' and entity_id=$1 order by doc_type, created_at desc`, [icId], db);
}

/** Emails the generated handover report and certificates to the client */
export async function sendHandoverDocs(icId: string, to: string, cc: string | undefined, note: string | undefined, actor: { id: string; name: string }) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to?.trim() ?? "")) throw new BizError("Enter the client's email address");
  const ic = await loadIc(icId);
  const docs = (await latestDocs(icId)).filter((d) => [IC_DOCS.report, IC_DOCS.handover, IC_DOCS.appreciation].includes(d.doc_type));
  if (docs.length < 3) throw new BizError("Generate the handover documents first");
  const m = await sendMail({
    to: to.trim(), cc, sentBy: actor.id, attachmentIds: docs.map((d) => d.id),
    subject: `[${ic.wo_no}] Handover documents — ${ic.title}`,
    html: `<p>Dear Sir / Madam,</p><p>Installation and commissioning of <b>${ic.title}</b> (project ${ic.wo_no}) is complete. Please find attached:</p>
      <ol><li>Project handover report</li><li>Handover certificate</li><li>Appreciation certificate (for issue on your letterhead)</li></ol>
      ${note ? `<p>${note.replace(/</g, "&lt;")}</p>` : ""}<p>Kindly sign and return the handover certificate and the appreciation certificate. The project will be closed on receipt of both.</p>
      <p>Warm regards,<br/>${actor.name}<br/>Enversys</p>`,
  });
  await pool.query(`update ic_project set docs_sent_at=now(), docs_sent_to=$2 where id=$1`, [icId, to.trim()]);
  await audit(actor.id, "SEND_HANDOVER", "ic_project", icId, null, { to, email_id: m.id });
  return m;
}

/** Records a signed certificate; when both are on file the project is completed */
export async function recordSignedCertificate(icId: string, kind: "HANDOVER" | "APPRECIATION", attachmentId: string, actorId: string) {
  return tx(async (c) => {
    const ic = await one(`select * from ic_project where id=$1 for update`, [icId], c);
    if (!ic) throw new BizError("I&C record not found");
    if (!ic.docs_generated_at) throw new BizError("Generate the handover documents first");
    await c.query(`update ic_project set ${kind === "HANDOVER" ? "handover_signed_id" : "appreciation_signed_id"}=$2 where id=$1`, [icId, attachmentId]);
    const cur = await one(`select * from ic_project where id=$1`, [icId], c);
    let completed = false;
    if (cur.handover_signed_id && cur.appreciation_signed_id && cur.status !== "COMPLETED") {
      await c.query(`update ic_project set status='COMPLETED', completed_at=now(), pct=100, stage='HANDOVER' where id=$1`, [icId]);
      const wo = await one(`update work_order set status=case when status='CLOSED' then status else 'COMPLETED' end, pct_complete=100, end_date=coalesce(end_date, current_date) where id=$1 returning id, wo_no, created_by`, [ic.wo_id], c);
      const pm = await one(`select employee_id from wo_team where wo_id=$1 and team_role='PM' limit 1`, [ic.wo_id], c);
      await notify([pm?.employee_id, wo.created_by].filter(Boolean), "Project completed", `${wo.wo_no}: signed handover and appreciation certificates received`, `/ic/${icId}`, c);
      completed = true;
    }
    await audit(actorId, `SIGNED_${kind}`, "ic_project", icId, null, { attachmentId, completed }, c);
    return { completed };
  });
}
