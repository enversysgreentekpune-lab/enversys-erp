import { headers } from "next/headers";
import { pool, type Db } from "./db";

export async function reqMeta(): Promise<{ ip: string | null; device: string | null }> {
  try {
    const h = await headers();
    return {
      ip: (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null,
      device: h.get("user-agent")?.slice(0, 250) ?? null,
    };
  } catch {
    return { ip: null, device: null }; // outside a request (scripts/tests)
  }
}

/** Append-only audit trail: who, when, what, old -> new, IP, device */
export async function audit(
  actorId: string | null, action: string, entity: string, entityId: string | null,
  oldValue: unknown = null, newValue: unknown = null, db: Db = pool,
) {
  const { ip, device } = await reqMeta();
  await db.query(
    `insert into audit_log(actor_id, action, entity, entity_id, old_value, new_value, ip, device) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [actorId, action, entity, entityId, oldValue == null ? null : JSON.stringify(oldValue), newValue == null ? null : JSON.stringify(newValue), ip, device],
  );
}

/** Only the changed keys, for compact audit entries */
export function diff(oldObj: Record<string, any>, newObj: Record<string, any>) {
  const o: Record<string, any> = {}, n: Record<string, any> = {};
  for (const k of Object.keys(newObj)) {
    if (String(oldObj?.[k] ?? "") !== String(newObj[k] ?? "")) { o[k] = oldObj?.[k] ?? null; n[k] = newObj[k]; }
  }
  return { old: o, new: n, changed: Object.keys(n).length > 0 };
}
