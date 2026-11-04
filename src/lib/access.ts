import "server-only";
import { notFound } from "next/navigation";
import { one } from "./db";
import { can, scopeSql, Forbidden, type CurrentUser } from "./auth";
import type { Action } from "./rbac";

/** Loads a lead only if the user's scope permits; 404 otherwise (does not leak existence) */
export async function loadLead(u: CurrentUser, id: string, action: Action = "view") {
  const sc = can(u, "leads", action);
  if (!sc) throw new Forbidden();
  const p: unknown[] = [id];
  const w = scopeSql(u, sc, { owner: ["l.assigned_to", "l.created_by"], vertical: "l.vertical_id",
    custom: (ids) => `exists (select 1 from proposal p join work_order wo on wo.proposal_id=p.id join wo_team t on t.wo_id=wo.id where p.lead_id=l.id and t.employee_id = any(${ids}))` }, p);
  const lead = await one(`select l.* from lead l where l.id=$1 and ${w}`, p);
  if (!lead) { if (action === "view") notFound(); throw new Forbidden(); }
  return lead;
}

export async function loadProposal(u: CurrentUser, id: string, action: Action = "view") {
  const p = await one(`select * from proposal where id=$1`, [id]);
  if (!p) notFound();
  await loadLead(u, p.lead_id, action);
  return p;
}

export function woScope(u: CurrentUser, action: Action, p: unknown[]) {
  const sc = can(u, "work_orders", action);
  if (!sc) return "false";
  return scopeSql(u, sc, { owner: ["w.created_by"], vertical: "w.vertical_id", custom: (ids) => `exists (select 1 from wo_team t where t.wo_id=w.id and t.employee_id = any(${ids}))` }, p);
}

export async function loadWo(u: CurrentUser, id: string, action: Action = "view") {
  const p: unknown[] = [id];
  const w = woScope(u, action, p);
  const wo = await one(`select w.* from work_order w where w.id=$1 and ${w}`, p);
  if (!wo) { if (action === "view") notFound(); throw new Forbidden(); }
  return wo;
}
