// Inbound email webhook (SendGrid/Mailgun/Postmark inbound parse, or an IMAP/Graph poller posting JSON).
// Threads replies onto the lead by In-Reply-To, then by [ENQUIRY NO] in subject, then by sender = customer contact on an open lead.
import { NextRequest, NextResponse } from "next/server";
import { one, pool } from "@/lib/db";
import { notify } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { safeEqual } from "@/lib/apiAuth";
import { OPEN_STAGES } from "@/lib/workflow";

export async function POST(req: NextRequest) {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  if (!secret || !safeEqual(req.headers.get("x-webhook-secret") ?? "", secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => null);
  if (!b?.from || !b?.subject) return NextResponse.json({ error: "from and subject required" }, { status: 400 });
  const from = String(b.from).match(/[^<\s]+@[^>\s]+/)?.[0]?.toLowerCase() ?? String(b.from);
  if (b.messageId && (await one(`select 1 from email_message where message_id=$1`, [b.messageId]))) return NextResponse.json({ ok: true, duplicate: true });
  let lead: any = null;
  if (b.inReplyTo) lead = await one(`select l.* from email_message m join lead l on l.id=m.lead_id where m.message_id=$1`, [b.inReplyTo]);
  const enq = String(b.subject).match(/ENV\/ENQ\/\d{2}-\d{2}\/\d{4}/)?.[0];
  if (!lead && enq) lead = await one(`select * from lead where enquiry_no=$1`, [enq]);
  if (!lead) lead = await one(`select l.* from lead l join contact c on c.customer_id=l.customer_id where lower(c.email)=$1 and l.stage = any($2) order by l.updated_at desc limit 1`, [from, OPEN_STAGES]);
  const m = await one(`insert into email_message(lead_id, direction, from_addr, to_addrs, cc_addrs, subject, body, message_id, in_reply_to, status) values ($1,'IN',$2,$3,$4,$5,$6,$7,$8,'RECEIVED') returning id`,
    [lead?.id ?? null, from, String(b.to ?? ""), b.cc ?? null, String(b.subject).slice(0, 500), b.html ?? (b.text ? `<pre>${String(b.text).replace(/</g, "&lt;")}</pre>` : ""), b.messageId ?? null, b.inReplyTo ?? null]);
  if (lead) {
    await pool.query(`insert into activity(entity, entity_id, kind, subject, body, meta) values ('lead',$1,'EMAIL_IN',$2,$3,$4)`, [lead.id, String(b.subject).slice(0, 300), `From: ${from}`, JSON.stringify({ email_id: m!.id })]);
    await pool.query(`update lead set updated_at=now() where id=$1`, [lead.id]);
    await notify([lead.assigned_to], `Customer replied: ${lead.enquiry_no}`, String(b.subject).slice(0, 140), `/leads/${lead.id}?tab=email`);
  }
  await audit(null, "EMAIL_IN", "email_message", m!.id, null, { from, lead: lead?.enquiry_no ?? null });
  return NextResponse.json({ ok: true, lead: lead?.enquiry_no ?? null });
}
