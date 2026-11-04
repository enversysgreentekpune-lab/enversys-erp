import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { getFile } from "@/lib/storage";
import { apiUser, canReadAttachment, contentDisposition } from "@/lib/apiAuth";
import { audit } from "@/lib/audit";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await apiUser();
  if (u instanceof NextResponse) return u;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const a = await one(`select * from attachment where id=$1`, [id]);
  if (!a || !(await canReadAttachment(u, a))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await audit(u.id, "DOWNLOAD", "attachment", id, null, { file: a.file_name });
  const inline = /^(image\/|application\/pdf)/.test(a.mime ?? "");
  return new NextResponse(new Uint8Array(await getFile(a.storage_key)), {
    headers: { "Content-Type": a.mime ?? "application/octet-stream", "Content-Disposition": inline ? `inline; filename="${a.file_name.replace(/"/g, "'")}"` : contentDisposition(a.file_name), "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" },
  });
}
