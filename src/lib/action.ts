import "server-only";
import { Forbidden } from "./auth";
import { BizError } from "./workflow";
import type { ActionResult } from "@/components/ActionForm";

/** Wraps a server action body: maps business/permission errors to user messages */
export async function safe(fn: () => Promise<ActionResult | void>): Promise<ActionResult> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (e: any) {
    if (e?.digest?.startsWith?.("NEXT_REDIRECT")) throw e;
    if (e instanceof BizError || e instanceof Forbidden) return { ok: false, error: e.message };
    if (e?.code === "23505") return { ok: false, error: "Duplicate record: " + (e.detail ?? e.constraint ?? "") };
    if (e?.name === "ZodError") return { ok: false, error: e.issues.map((i: any) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    console.error(e);
    return { ok: false, error: e?.message ?? "Something went wrong" };
  }
}
export const s = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v.trim() : ""; };
export const n = (fd: FormData, k: string) => { const v = Number(s(fd, k).replace(/,/g, "")); return Number.isFinite(v) ? v : 0; };
export const opt = (fd: FormData, k: string) => s(fd, k) || null;
