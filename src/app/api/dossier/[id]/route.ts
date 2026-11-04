// One-click job dossier: ZIP of every document linked to the WO (lead RFQ, proposal revisions, customer PO, uploads), in the standard folder structure.
import { NextResponse } from "next/server";
import PizZip from "pizzip";
import { q } from "@/lib/db";
import { getFile } from "@/lib/storage";
import { apiUser, contentDisposition } from "@/lib/apiAuth";
import { loadWo } from "@/lib/access";
import { audit } from "@/lib/audit";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await apiUser();
  if (u instanceof NextResponse) return u;
  const { id } = await params;
  let wo: any;
  try { wo = await loadWo(u, id); } catch { return NextResponse.json({ error: "Not found" }, { status: 404 }); }
  const docs = await q(`select * from attachment where (entity='work_order' and entity_id=$1)
      or (entity='proposal' and entity_id=$2) or (entity='lead' and entity_id=(select lead_id from proposal where id=$2)) order by folder, file_name, version`, [id, wo.proposal_id]);
  const zip = new PizZip();
  const seen = new Set<string>();
  const index: string[] = [`Job dossier ${wo.wo_no} — ${wo.title}`, `Generated ${new Date().toISOString()} by ${u.name}`, ""];
  for (const d of docs) {
    const folder = d.folder ?? (d.entity === "lead" ? "01 Enquiry & RFQ" : d.entity === "proposal" ? "02 Proposal & Revisions" : "13 Correspondence");
    let path = `${folder}/${d.version > 1 ? `v${d.version} ` : ""}${d.file_name}`;
    while (seen.has(path)) path = path.replace(/(\.[^.]+)?$/, "_1$1");
    seen.add(path);
    try { zip.file(path, await getFile(d.storage_key)); index.push(path); } catch { index.push(`${path}  [MISSING IN STORAGE]`); }
  }
  zip.file("00 INDEX.txt", index.join("\n"));
  await audit(u.id, "DOWNLOAD_DOSSIER", "work_order", id, null, { files: docs.length });
  const buf = zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/zip", "Content-Disposition": contentDisposition(`${wo.wo_no.replace(/\//g, "-")} dossier.zip`) } });
}
