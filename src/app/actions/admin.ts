"use server";
import { revalidatePath } from "next/cache";
import { requireUser, need, can, normMobile } from "@/lib/auth";
import { one, q, tx, pool } from "@/lib/db";
import { audit } from "@/lib/audit";
import { safe, s, n, opt } from "@/lib/action";
import { BizError } from "@/lib/workflow";
import { MODULES, ACTIONS, SCOPES } from "@/lib/rbac";
import { putFile } from "@/lib/storage";

export async function savePermissionsAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    need(u, "settings", "edit");
    const roleId = s(fd, "role_id");
    const role = await one(`select * from role where id=$1`, [roleId]);
    if (!role) throw new BizError("Role not found");
    if (role.code === "SUPER_ADMIN" && u.roleCode !== "SUPER_ADMIN") throw new BizError("Only Super Admin can change Super Admin permissions");
    const old = await q(`select module, action, scope from permission where role_id=$1`, [roleId]);
    const next: { module: string; action: string; scope: string }[] = [];
    for (const m of MODULES) for (const a of ACTIONS) { const v = s(fd, `${m.code}:${a}`); if (SCOPES.includes(v as any)) next.push({ module: m.code, action: a, scope: v }); }
    if (role.code === "MD" || role.code === "SUPER_ADMIN") if (!next.some((p) => p.module === "settings" && p.action === "edit")) throw new BizError("MD / Super Admin must keep Settings edit access");
    await tx(async (c) => {
      await c.query(`delete from permission where role_id=$1`, [roleId]);
      for (const p of next) await c.query(`insert into permission(role_id, module, action, scope) values ($1,$2,$3,$4)`, [roleId, p.module, p.action, p.scope]);
      const key = (p: any) => `${p.module}:${p.action}`;
      const changed = { removed: old.filter((o) => !next.some((x) => key(x) === key(o) && x.scope === o.scope)).map((o) => `${key(o)}=${o.scope}`), added: next.filter((x) => !old.some((o) => key(x) === key(o) && x.scope === o.scope)).map((x) => `${key(x)}=${x.scope}`) };
      await audit(u.id, "EDIT_PERMISSIONS", "role", roleId, { removed: changed.removed }, { added: changed.added }, c);
    });
    revalidatePath("/admin/roles");
    return { ok: true, message: `Permissions saved for ${role.name}. Users get them on their next page load.` };
  });
}

export async function createRoleAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    need(u, "settings", "create");
    const code = s(fd, "code").toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    const r = await one(`insert into role(code, name) values ($1,$2) returning id`, [code, s(fd, "name")]);
    const copy = opt(fd, "copy_from");
    if (copy) await pool.query(`insert into permission(role_id, module, action, scope) select $1, module, action, scope from permission where role_id=$2`, [r!.id, copy]);
    await audit(u.id, "CREATE", "role", r!.id, null, { code, copy_from: copy });
    return { ok: true, redirect: `/admin/roles?role=${r!.id}` };
  });
}

export async function saveApprovalRuleAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    need(u, "settings", "edit");
    const id = opt(fd, "id");
    const vals = [s(fd, "doc_type"), n(fd, "min_value"), s(fd, "max_value") ? n(fd, "max_value") : null, s(fd, "approver_role"), n(fd, "sequence") || 1, s(fd, "active") !== "0"];
    if (id) {
      const old = await one(`select * from approval_rule where id=$1`, [id]);
      if (s(fd, "delete") === "1") { await pool.query(`delete from approval_rule where id=$1`, [id]); await audit(u.id, "DELETE", "approval_rule", id, old, null); }
      else { await pool.query(`update approval_rule set doc_type=$2, min_value=$3, max_value=$4, approver_role=$5, sequence=$6, is_active=$7 where id=$1`, [id, ...vals]); await audit(u.id, "EDIT", "approval_rule", id, old, vals); }
    } else {
      const r = await one(`insert into approval_rule(doc_type, min_value, max_value, approver_role, sequence, is_active) values ($1,$2,$3,$4,$5,$6) returning id`, vals);
      await audit(u.id, "CREATE", "approval_rule", r!.id, null, vals);
    }
    revalidatePath("/admin/approvals");
    return { ok: true, message: "Approval matrix saved" };
  });
}

export async function saveSettingAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    need(u, "settings", "edit");
    const key = s(fd, "key");
    let val: any;
    try { val = JSON.parse(s(fd, "value")); } catch { throw new BizError("Value must be valid JSON"); }
    const old = await one(`select value from app_setting where key=$1`, [key]);
    await pool.query(`insert into app_setting(key, value) values ($1,$2) on conflict (key) do update set value=excluded.value`, [key, JSON.stringify(val)]);
    await audit(u.id, "EDIT", "app_setting", key, old?.value, val);
    revalidatePath("/admin");
    return { ok: true, message: "Saved" };
  });
}

export async function saveEmployeeAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const id = opt(fd, "id");
    if (!can(u, "hr", id ? "edit" : "create") || (can(u, "hr", "edit") !== "company" && !can(u, "settings", "edit"))) throw new BizError("Only HR / Admin can register employees");
    const mobile = normMobile(s(fd, "mobile"));
    if (!/^[6-9]\d{9}$/.test(mobile)) throw new BizError("Enter a valid 10-digit mobile number (this is the login ID)");
    const vals = { name: s(fd, "name"), mobile, email: opt(fd, "email"), role_id: s(fd, "role_id"), department_id: opt(fd, "department_id"), designation_id: opt(fd, "designation_id"),
      vertical_id: opt(fd, "vertical_id"), location_id: opt(fd, "location_id"), manager_id: opt(fd, "manager_id"), doj: opt(fd, "doj"), monthly_ctc: n(fd, "monthly_ctc"),
      hourly_cost: n(fd, "hourly_cost"), is_active: s(fd, "is_active") === "on", single_device: s(fd, "single_device") === "on" };
    if (!vals.name || !vals.role_id) throw new BizError("Name and role are required");
    const role = await one(`select code from role where id=$1`, [vals.role_id]);
    if (["SUPER_ADMIN", "MD"].includes(role?.code) && !["SUPER_ADMIN", "MD"].includes(u.roleCode)) throw new BizError("Only MD / Super Admin can assign that role");
    if (id) {
      if (id === vals.manager_id) throw new BizError("An employee cannot report to themselves");
      const old = await one(`select * from employee where id=$1`, [id]);
      await pool.query(`update employee set name=$2, mobile=$3, email=$4, role_id=$5, department_id=$6, designation_id=$7, vertical_id=$8, location_id=$9, manager_id=$10, doj=$11, monthly_ctc=$12, hourly_cost=$13, is_active=$14, single_device=$15 where id=$1`, [id, ...Object.values(vals)]);
      if (!vals.is_active || old.role_id !== vals.role_id) await pool.query(`update user_session set revoked_at=now() where employee_id=$1 and revoked_at is null`, [id]);
      await audit(u.id, "EDIT", "employee", id, { role_id: old.role_id, mobile: old.mobile, is_active: old.is_active, manager_id: old.manager_id }, { role_id: vals.role_id, mobile, is_active: vals.is_active, manager_id: vals.manager_id });
      revalidatePath("/admin/employees");
      return { ok: true, message: "Employee updated" };
    }
    const cnt = await one(`select count(*)::int n from employee`);
    const r = await one(`insert into employee(emp_code, ${Object.keys(vals).join(",")}) values ($1, ${Object.keys(vals).map((_, i) => "$" + (i + 2)).join(",")}) returning id`, [`ENV${String(cnt!.n + 1).padStart(3, "0")}`, ...Object.values(vals)]);
    await audit(u.id, "CREATE", "employee", r!.id, null, { name: vals.name, mobile, role: role?.code });
    return { ok: true, redirect: `/admin/employees` };
  });
}

const MASTER_TABLES: Record<string, { table: string; cols: string[] }> = {
  vertical: { table: "vertical", cols: ["code", "name"] }, department: { table: "department", cols: ["code", "name"] }, designation: { table: "designation", cols: ["name", "level"] },
  location: { table: "location", cols: ["code", "name", "kind", "address", "lat", "lng", "geofence_m", "shift_start", "shift_end"] },
  item: { table: "item", cols: ["code", "description", "specification", "make", "moc", "uom", "hsn", "gst_pct", "category", "last_purchase_rate", "standard_rate"] },
  vendor: { table: "vendor", cols: ["code", "name", "gstin", "contact_name", "email", "mobile", "address", "payment_terms"] },
};
export async function addMasterAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    const kind = s(fd, "kind");
    const m = MASTER_TABLES[kind];
    if (!m) throw new BizError("Unknown master");
    if (kind === "item" || kind === "vendor") { if (!can(u, "purchase", "create") && !can(u, "settings", "create")) throw new BizError("Not permitted"); }
    else need(u, "settings", "create");
    const vals = m.cols.map((c) => opt(fd, c));
    const r = await one(`insert into ${m.table}(${m.cols.join(",")}) values (${m.cols.map((_, i) => "$" + (i + 1)).join(",")}) returning id`, vals);
    await audit(u.id, "CREATE", m.table, r!.id, null, Object.fromEntries(m.cols.map((c, i) => [c, vals[i]])));
    revalidatePath("/admin/masters");
    return { ok: true, message: "Added" };
  });
}

export async function uploadTemplateAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    need(u, "settings", "edit");
    const code = s(fd, "code");
    const f = fd.get("file") as File | null;
    if (!f?.size) throw new BizError("Choose a file");
    const kind = f.name.endsWith(".docx") ? "docx" : f.name.endsWith(".xlsx") ? "xlsx" : null;
    if (!kind) throw new BizError("Templates must be .docx or .xlsx");
    const cur = await one(`select * from template where code=$1 order by version desc limit 1`, [code]);
    if (cur && cur.kind !== kind) throw new BizError(`Template ${code} must be a .${cur.kind} file`);
    const buf = Buffer.from(await f.arrayBuffer());
    // validate it renders with sample data before activating
    try {
      const { renderDocx, renderXlsx } = await import("@/lib/docgen");
      if (kind === "docx") renderDocx(buf, { lines: [] }); else await renderXlsx(buf, { lines: [] });
    } catch (e: any) { throw new BizError(`Template has errors: ${e?.properties?.errors?.map((x: any) => x.properties?.explanation).join("; ") || e.message}`); }
    const key = await putFile(buf, f.name, "templates");
    await tx(async (c) => {
      await c.query(`update template set is_active=false where code=$1`, [code]);
      await c.query(`insert into template(code, name, kind, storage_key, version, uploaded_by) values ($1,$2,$3,$4,$5,$6)`, [code, cur?.name ?? code, kind, key, (cur?.version ?? 0) + 1, u.id]);
      await audit(u.id, "UPLOAD_TEMPLATE", "template", code, { version: cur?.version }, { version: (cur?.version ?? 0) + 1, file: f.name }, c);
    });
    revalidatePath("/admin/templates");
    return { ok: true, message: `Template ${code} v${(cur?.version ?? 0) + 1} activated` };
  });
}

export async function saveEmailTemplateAction(_: any, fd: FormData) {
  const u = await requireUser();
  return safe(async () => {
    need(u, "settings", "edit");
    const old = await one(`select subject, body from template where id=$1`, [s(fd, "id")]);
    await pool.query(`update template set subject=$2, body=$3 where id=$1 and kind='email'`, [s(fd, "id"), s(fd, "subject"), s(fd, "body")]);
    await audit(u.id, "EDIT", "template", s(fd, "id"), old, { subject: s(fd, "subject") });
    revalidatePath("/admin/templates");
    return { ok: true, message: "Email template saved" };
  });
}
