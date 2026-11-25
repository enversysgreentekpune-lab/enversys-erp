import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { apiUser, contentDisposition } from "@/lib/apiAuth";
import { can } from "@/lib/auth";
import { audit } from "@/lib/audit";
import * as OM from "@/lib/om";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Downloads O&M client documents: ticket resolution, monthly report, site visit report (Word) */
export async function GET(req: Request) {
  const u = await apiUser();
  if (u instanceof NextResponse) return u;
  if (!can(u, "field_services", "view")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const sp = new URL(req.url).searchParams;
  const kind = sp.get("kind"), id = sp.get("id") ?? "", site = sp.get("site") ?? "";
  const uuid = (v: string) => /^[0-9a-f-]{36}$/.test(v);
  try {
    let doc: { buf: Buffer; name: string };
    if (kind === "ticket" && uuid(id)) {
      const t = await one(`select site_id from om_ticket where id=$1`, [id]);
      if (!t) throw new Error("nf");
      await OM.assertSite(u, t.site_id);
      doc = await OM.ticketResolutionDoc(id);
    } else if (kind === "visit" && uuid(id)) {
      const r = await one(`select site_id from om_report where id=$1`, [id]);
      if (!r) throw new Error("nf");
      await OM.assertSite(u, r.site_id);
      doc = await OM.visitReportDoc(id);
    } else if (kind === "monthly" && uuid(site)) {
      await OM.assertSite(u, site);
      doc = await OM.monthlyReportDoc(site, sp.get("period") ?? "");
    } else return NextResponse.json({ error: "Not found" }, { status: 404 });
    await audit(u.id, "DOWNLOAD", "om_doc", id || site, null, { kind, file: doc.name });
    return new NextResponse(new Uint8Array(doc.buf), { headers: { "Content-Type": DOCX, "Content-Disposition": contentDisposition(doc.name), "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
