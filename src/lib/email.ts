import nodemailer from "nodemailer";
import crypto from "node:crypto";
import { getFile, putFile } from "./storage";
import { one, q, pool } from "./db";

function transport() {
  if (process.env.SMTP_HOST)
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587), secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  // Dev: render RFC822 message to storage/outbox instead of sending
  return nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
}

export const fill = (tpl: string, data: Record<string, any>) =>
  tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) => String(k.split(".").reduce((o: any, p) => o?.[p], data) ?? ""));

export interface OutMail {
  leadId?: string | null; proposalId?: string | null; to: string; cc?: string; subject: string; html: string;
  attachmentIds: string[]; sentBy: string; inReplyTo?: string | null;
}

/** Sends an email, stores it on the lead thread with status tracking. Returns email_message row. */
export async function sendMail(m: OutMail) {
  const from = process.env.MAIL_FROM ?? "Enversys <sales@enversys.com>";
  const id = crypto.randomUUID();
  const messageId = `<${id}@enversys.com>`;
  const atts = m.attachmentIds.length
    ? await q(`select * from attachment where id = any($1::uuid[])`, [m.attachmentIds]) : [];
  const pixel = process.env.APP_URL ? `<img src="${process.env.APP_URL}/api/email/open/${id}" width="1" height="1" alt="" />` : "";
  const row = await one(
    `insert into email_message(id, lead_id, proposal_id, direction, from_addr, to_addrs, cc_addrs, subject, body, message_id, in_reply_to, status, attachment_ids, sent_by)
     values ($1,$2,$3,'OUT',$4,$5,$6,$7,$8,$9,$10,'QUEUED',$11,$12) returning *`,
    [id, m.leadId ?? null, m.proposalId ?? null, from, m.to, m.cc ?? null, m.subject, m.html, messageId, m.inReplyTo ?? null, m.attachmentIds, m.sentBy]);
  try {
    const info = await transport().sendMail({
      from, to: m.to, cc: m.cc || undefined, subject: m.subject, html: m.html + pixel, messageId,
      inReplyTo: m.inReplyTo ?? undefined, references: m.inReplyTo ?? undefined,
      attachments: await Promise.all(atts.map(async (a) => ({ filename: a.file_name, content: await getFile(a.storage_key) }))),
    });
    if (!process.env.SMTP_HOST && (info as any).message) await putFile((info as any).message as Buffer, `${id}.eml`, "outbox");
    await pool.query(`update email_message set status='SENT' where id=$1`, [id]);
    return { ...row, status: "SENT" };
  } catch (e: any) {
    await pool.query(`update email_message set status='FAILED', error=$2 where id=$1`, [id, String(e?.message ?? e)]);
    throw e;
  }
}
