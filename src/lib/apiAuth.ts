import "server-only";
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getCurrentUser, can, Forbidden, type CurrentUser } from "./auth";
import { one } from "./db";
import { loadLead, loadWo } from "./access";

export async function apiUser(): Promise<CurrentUser | NextResponse> {
  const u = await getCurrentUser();
  return u ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/** Can the user read this attachment? Delegates to the parent record's scoping rules. */
export async function canReadAttachment(u: CurrentUser, a: { entity: string; entity_id: string; uploaded_by: string | null }) {
  if (a.uploaded_by === u.id) return true;
  try {
    switch (a.entity) {
      case "lead": await loadLead(u, a.entity_id); return true;
      case "proposal": { const p = await one(`select lead_id from proposal where id=$1`, [a.entity_id]); if (!p) return false; await loadLead(u, p.lead_id); return true; }
      case "work_order": await loadWo(u, a.entity_id); return true;
      case "customer": return !!can(u, "customers", "view");
      case "cost_entry": {
        const ce = await one(`select cost_centre, wo_id, created_by from cost_entry where id=$1`, [a.entity_id]);
        if (!ce) return false;
        if (ce.created_by === u.id) return true;
        if (ce.cost_centre === "WO") { await loadWo(u, ce.wo_id); return true; }
        return !!can(u, ce.cost_centre === "FACTORY_ADMIN" ? "factory_admin" : "office_admin", "view") && can(u, ce.cost_centre === "FACTORY_ADMIN" ? "factory_admin" : "office_admin", "view") !== "own";
      }
      default: return !!can(u, "settings", "view");
    }
  } catch (e) {
    if (e instanceof Forbidden || (e as any)?.digest?.includes?.("NEXT_HTTP_ERROR_FALLBACK") || (e as any)?.digest?.includes?.("NEXT_NOT_FOUND")) return false;
    throw e;
  }
}

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
export const contentDisposition = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'")}"; filename*=UTF-8''${encodeURIComponent(name)}`;
