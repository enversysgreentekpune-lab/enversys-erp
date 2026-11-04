import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { can } from "@/lib/auth";
import { getFile, mimeOf } from "@/lib/storage";
import { apiUser, contentDisposition } from "@/lib/apiAuth";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await apiUser();
  if (u instanceof NextResponse) return u;
  if (!can(u, "settings", "view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const t = await one(`select * from template where id=$1 and storage_key is not null`, [(await params).id]);
  if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const name = `${t.code}-v${t.version}.${t.kind}`;
  return new NextResponse(new Uint8Array(await getFile(t.storage_key)), { headers: { "Content-Type": mimeOf(name), "Content-Disposition": contentDisposition(name) } });
}
