import { one, pool, type Db } from "./db";
import { putFile, mimeOf } from "./storage";

export const DOSSIER_FOLDERS = [
  "01 Enquiry & RFQ", "02 Proposal & Revisions", "03 Customer PO & LOI", "04 Drawings",
  "05 Purchase Orders & Vendor Docs", "06 Manufacturing & Job Cards", "07 Inspection & Test Certificates",
  "08 Dispatch Documents", "09 I&C Reports", "10 Handover & Certificates", "11 Invoices & Payments",
  "12 O&M - Maintenance", "13 Correspondence",
] as const;

export async function saveAttachment(opts: {
  entity: string; entityId: string; fileName: string; buf: Buffer; folder?: string; docType?: string; userId?: string | null; db?: Db;
}) {
  const db = opts.db ?? pool;
  const key = await putFile(opts.buf, opts.fileName, opts.entity);
  const prev = await one<{ v: number }>(`select max(version) v from attachment where entity=$1 and entity_id=$2 and file_name=$3`,
    [opts.entity, opts.entityId, opts.fileName], db);
  return (await one(
    `insert into attachment(entity, entity_id, folder, file_name, mime, size_bytes, storage_key, version, doc_type, uploaded_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [opts.entity, opts.entityId, opts.folder ?? null, opts.fileName, mimeOf(opts.fileName), opts.buf.length, key,
      (prev?.v ?? 0) + 1, opts.docType ?? null, opts.userId ?? null], db))!;
}

export async function saveUploads(files: File[], o: { entity: string; entityId: string; folder?: string; userId: string; db?: Db }) {
  const out = [];
  for (const f of files) {
    if (!f || typeof f === "string" || f.size === 0) continue;
    if (f.size > 25 * 1024 * 1024) throw new Error(`${f.name} exceeds 25 MB`);
    out.push(await saveAttachment({ ...o, fileName: f.name, buf: Buffer.from(await f.arrayBuffer()) }));
  }
  return out;
}
