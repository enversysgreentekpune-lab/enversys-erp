// 1x1 tracking pixel: marks an outbound email as OPENED
import { pool } from "@/lib/db";
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (/^[0-9a-f-]{36}$/.test(id)) await pool.query(`update email_message set status='OPENED', opened_at=coalesce(opened_at, now()) where id=$1 and direction='OUT'`, [id]).catch(() => {});
  return new Response(new Uint8Array(GIF), { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" } });
}
