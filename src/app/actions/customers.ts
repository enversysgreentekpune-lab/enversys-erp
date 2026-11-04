"use server";
import { revalidatePath } from "next/cache";
import ExcelJS from "exceljs";
import { requireUser, need } from "@/lib/auth";
import { tx, one, q, pool } from "@/lib/db";
import { nextNo } from "@/lib/numbering";
import { audit, diff } from "@/lib/audit";
import { safe, s, n, opt } from "@/lib/action";
import { BizError } from "@/lib/workflow";

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const norm = (x: string) => x.toLowerCase().replace(/\b(pvt|private|ltd|limited|llp|inc|co|company|the|india)\b/g, "").replace(/[^a-z0-9]/g, "");

export async function findDuplicates(name: string, gstin?: string | null, phone?: string | null, email?: string | null, excludeId?: string) {
  const rows = await q(`select id, code, name, gstin, phone, email from customer where id <> coalesce($1::uuid, '00000000-0000-0000-0000-000000000000')`, [excludeId ?? null]);
  const nn = norm(name);
  return rows.filter((r) =>
    (gstin && r.gstin && r.gstin.toUpperCase() === gstin.toUpperCase()) ||
    (phone && r.phone && r.phone.replace(/\D/g, "").slice(-10) === phone.replace(/\D/g, "").slice(-10)) ||
    (email && r.email && r.email.toLowerCase() === email.toLowerCase()) ||
    (nn.length > 3 && (norm(r.name) === nn || norm(r.name).startsWith(nn) || nn.startsWith(norm(r.name)))));
}

export async function createCustomerAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    need(u, "customers", "create");
    const name = s(fd, "name"), gstin = s(fd, "gstin").toUpperCase() || null;
    if (!name) throw new BizError("Company name is required");
    if (gstin && !GSTIN_RE.test(gstin)) throw new BizError("GSTIN format is invalid");
    const dups = await findDuplicates(name, gstin, opt(fd, "phone"), opt(fd, "email"));
    if (dups.some((d) => gstin && d.gstin === gstin)) throw new BizError(`GSTIN already exists for ${dups.find((d) => d.gstin === gstin)!.name}`);
    if (dups.length && s(fd, "confirm_dup") !== "1")
      return { ok: false, error: `Possible duplicate(s): ${dups.map((d) => `${d.name} (${d.code})`).join(", ")}. Tick "Create anyway" if this is a different customer.` };
    const id = await tx(async (c) => {
      const code = await nextNo(c, "CUSTOMER");
      const cu = await one(`insert into customer(code, name, group_name, industry, gstin, pan, phone, email, website, credit_limit, payment_terms, owner_id, vertical_id, source, rating, created_by)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
        [code, name, opt(fd, "group_name"), opt(fd, "industry"), gstin, gstin ? gstin.slice(2, 12) : opt(fd, "pan"), opt(fd, "phone"), opt(fd, "email"), opt(fd, "website"),
          n(fd, "credit_limit") || null, opt(fd, "payment_terms"), opt(fd, "owner_id") ?? u.id, opt(fd, "vertical_id"), opt(fd, "source"), opt(fd, "rating"), u.id], c);
      if (s(fd, "line1")) await c.query(`insert into customer_address(customer_id, kind, line1, city, state, pincode, is_default) values ($1,'BILLING',$2,$3,$4,$5,true)`, [cu!.id, s(fd, "line1"), opt(fd, "city"), opt(fd, "state"), opt(fd, "pincode")]);
      if (s(fd, "contact_name")) await c.query(`insert into contact(customer_id, name, designation, email, mobile, is_decision_maker) values ($1,$2,$3,$4,$5,true)`, [cu!.id, s(fd, "contact_name"), opt(fd, "contact_designation"), opt(fd, "contact_email"), opt(fd, "contact_mobile")]);
      await audit(u.id, "CREATE", "customer", cu!.id, null, { code, name, gstin }, c);
      return cu!.id;
    });
    return { ok: true, redirect: `/customers/${id}` };
  });
}

export async function updateCustomerAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    need(u, "customers", "edit");
    const id = s(fd, "id");
    const old = await one(`select * from customer where id=$1`, [id]);
    if (!old) throw new BizError("Not found");
    const gstin = s(fd, "gstin").toUpperCase() || null;
    if (gstin && !GSTIN_RE.test(gstin)) throw new BizError("GSTIN format is invalid");
    const next = { name: s(fd, "name"), group_name: opt(fd, "group_name"), industry: opt(fd, "industry"), gstin, phone: opt(fd, "phone"), email: opt(fd, "email"),
      credit_limit: n(fd, "credit_limit") || null, payment_terms: opt(fd, "payment_terms"), rating: opt(fd, "rating"), owner_id: opt(fd, "owner_id") };
    await pool.query(`update customer set name=$2, group_name=$3, industry=$4, gstin=$5, phone=$6, email=$7, credit_limit=$8, payment_terms=$9, rating=$10, owner_id=coalesce($11, owner_id) where id=$1`,
      [id, ...Object.values(next)]);
    const d = diff(old, next);
    if (d.changed) await audit(u.id, "EDIT", "customer", id, d.old, d.new);
    revalidatePath(`/customers/${id}`);
    return { ok: true, message: "Saved" };
  });
}

export async function addContactAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    need(u, "customers", "edit");
    const r = await one(`insert into contact(customer_id, name, designation, email, mobile, is_decision_maker) values ($1,$2,$3,$4,$5,$6) returning id`,
      [s(fd, "customer_id"), s(fd, "name"), opt(fd, "designation"), opt(fd, "email"), opt(fd, "mobile"), s(fd, "dm") === "on"]);
    await audit(u.id, "CREATE", "contact", r!.id, null, { name: s(fd, "name") });
    revalidatePath(`/customers/${s(fd, "customer_id")}`);
    return { ok: true, message: "Contact added" };
  });
}

export async function addAddressAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    need(u, "customers", "edit");
    await pool.query(`insert into customer_address(customer_id, kind, line1, city, state, pincode) values ($1,$2,$3,$4,$5,$6)`,
      [s(fd, "customer_id"), s(fd, "kind"), s(fd, "line1"), opt(fd, "city"), opt(fd, "state"), opt(fd, "pincode")]);
    await audit(u.id, "CREATE", "customer_address", s(fd, "customer_id"), null, { kind: s(fd, "kind"), line1: s(fd, "line1") });
    revalidatePath(`/customers/${s(fd, "customer_id")}`);
    return { ok: true, message: "Address added" };
  });
}

/** Excel import: columns Name | Group | Industry | GSTIN | Phone | Email | City | State | Contact | Contact Mobile | Contact Email | Rating */
export async function importCustomersAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    need(u, "customers", "create");
    const f = fd.get("file") as File | null;
    if (!f || !f.size) throw new BizError("Choose an .xlsx file");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await f.arrayBuffer()) as any);
    const ws = wb.worksheets[0];
    let created = 0; const skipped: string[] = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const v = (c: number) => { const x = ws.getRow(r).getCell(c).value; return x == null ? "" : String((x as any).text ?? (x as any).result ?? x).trim(); };
      const name = v(1); if (!name) continue;
      const gstin = v(4).toUpperCase() || null;
      if ((await findDuplicates(name, gstin, v(5), v(6))).length) { skipped.push(name); continue; }
      await tx(async (c) => {
        const code = await nextNo(c, "CUSTOMER");
        const cu = await one(`insert into customer(code, name, group_name, industry, gstin, pan, phone, email, rating, owner_id, source, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'EXCEL_IMPORT',$10) returning id`,
          [code, name, v(2) || null, v(3) || null, gstin, gstin?.slice(2, 12) ?? null, v(5) || null, v(6) || null, ["A", "B", "C"].includes(v(12)) ? v(12) : null, u.id], c);
        if (v(7)) await c.query(`insert into customer_address(customer_id, kind, line1, city, state, is_default) values ($1,'BILLING',$2,$2,$3,true)`, [cu!.id, v(7), v(8) || null]);
        if (v(9)) await c.query(`insert into contact(customer_id, name, mobile, email, is_decision_maker) values ($1,$2,$3,$4,true)`, [cu!.id, v(9), v(10) || null, v(11) || null]);
      });
      created++;
    }
    await audit(u.id, "IMPORT", "customer", null, null, { created, skipped: skipped.length });
    revalidatePath("/customers");
    return { ok: true, message: `Imported ${created} customer(s).${skipped.length ? ` Skipped ${skipped.length} possible duplicate(s): ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? "…" : ""}` : ""}` };
  });
}
