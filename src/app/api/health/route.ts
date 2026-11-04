import { one } from "@/lib/db";
export async function GET() {
  try { await one("select 1"); return Response.json({ ok: true, db: "up", at: new Date().toISOString() }); }
  catch { return Response.json({ ok: false, db: "down" }, { status: 503 }); }
}
