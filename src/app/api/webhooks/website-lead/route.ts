// Website enquiry form (enversys.com) -> Lead. POST JSON with header x-webhook-secret.
// { name, company, email, mobile, message, vertical?: "PRJ"|"MFG"|..., category?, site? }
import { NextRequest, NextResponse } from "next/server";
import { one, tx } from "@/lib/db";
import { nextNo } from "@/lib/numbering";
import { notify, idsByRole, createTask } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { safeEqual } from "@/lib/apiAuth";

export async function POST(req: NextRequest) {
  const secret = process.env.WEBSITE_LEAD_SECRET;
  if (!secret || !safeEqual(req.headers.get("x-webhook-secret") ?? "", secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => null);
  const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const company = str(b?.company) || str(b?.name);
  if (!company || (!str(b?.email) && !str(b?.mobile))) return NextResponse.json({ error: "company/name and email or mobile are required" }, { status: 400 });
  const out = await tx(async (c) => {
    const vertical = (await one(`select id from vertical where code=$1`, [str(b?.vertical) || "PRJ"], c)) ?? (await one(`select id from vertical order by sort limit 1`, [], c));
    const sm = (await idsByRole(["SALES_MANAGER"], c))[0] ?? (await idsByRole(["MD"], c))[0];
    let cust = await one(`select c.id from customer c left join contact ct on ct.customer_id=c.id where lower(c.name)=lower($1) or ($2 <> '' and lower(ct.email)=lower($2)) limit 1`, [company, str(b?.email)], c);
    if (!cust) cust = await one(`insert into customer(code, name, email, phone, source, owner_id) values ($1,$2,$3,$4,'WEBSITE',$5) returning id`, [await nextNo(c, "CUSTOMER"), company, str(b?.email) || null, str(b?.mobile) || null, sm], c);
    const contact = await one(`insert into contact(customer_id, name, email, mobile) values ($1,$2,$3,$4) returning id`, [cust!.id, str(b?.name) || company, str(b?.email) || null, str(b?.mobile) || null], c);
    const no = await nextNo(c, "LEAD");
    const l = await one(`insert into lead(enquiry_no, customer_id, contact_id, vertical_id, category, title, scope, site_location, source, assigned_to, next_followup_at) values ($1,$2,$3,$4,$5,$6,$7,$8,'WEBSITE',$9, now() + interval '1 day') returning id`,
      [no, cust!.id, contact!.id, vertical!.id, str(b?.category) || null, `Website enquiry – ${company}`, str(b?.message, 4000), str(b?.site) || null, sm], c);
    await c.query(`insert into activity(entity, entity_id, kind, subject, body) values ('lead',$1,'SYSTEM','Enquiry received from website',$2)`, [l!.id, str(b?.message, 4000)]);
    await notify([sm], "New website enquiry", `${no}: ${company}`, `/leads/${l!.id}`, c);
    if (sm) await createTask({ title: `Respond to website enquiry ${no}`, entity: "lead", entityId: l!.id, link: `/leads/${l!.id}`, assignedTo: sm, dueAt: new Date(Date.now() + 86400000), priority: "HIGH" }, c);
    await audit(null, "CREATE_WEBHOOK", "lead", l!.id, null, { enquiry_no: no, source: "WEBSITE" }, c);
    return { id: l!.id, enquiry_no: no };
  });
  return NextResponse.json({ ok: true, ...out }, { status: 201 });
}
