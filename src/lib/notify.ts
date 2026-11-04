import { pool, q, type Db } from "./db";

/** In-app notification (email/WhatsApp fan-out is queued by channel rules — see docs) */
export async function notify(employeeIds: (string | null | undefined)[], title: string, body: string, link?: string, db: Db = pool) {
  const ids = [...new Set(employeeIds.filter(Boolean))] as string[];
  for (const id of ids)
    await db.query(`insert into notification(employee_id, title, body, link) values ($1,$2,$3,$4)`, [id, title, body, link ?? null]);
}

export async function idsByRole(roleCodes: string[], db: Db = pool, verticalId?: string | null): Promise<string[]> {
  const rows = await q<{ id: string }>(
    `select e.id from employee e join role r on r.id=e.role_id where r.code = any($1) and e.is_active
       and ($2::uuid is null or r.code <> 'BUSINESS_HEAD' or e.vertical_id = $2)`, [roleCodes, verticalId ?? null], db);
  return rows.map((r) => r.id);
}

export async function createTask(t: {
  title: string; description?: string; entity?: string; entityId?: string; link?: string;
  assignedTo: string; createdBy?: string | null; dueAt?: Date | string | null; priority?: string;
}, db: Db = pool) {
  await db.query(
    `insert into task(title, description, entity, entity_id, link, assigned_to, created_by, due_at, priority) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [t.title, t.description ?? null, t.entity ?? null, t.entityId ?? null, t.link ?? null, t.assignedTo, t.createdBy ?? null, t.dueAt ?? null, t.priority ?? "MEDIUM"]);
}
