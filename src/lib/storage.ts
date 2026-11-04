import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

// Storage abstraction. Local disk driver implemented; an S3-compatible driver plugs in behind the
// same two functions (see docs/DEPLOYMENT.md). Keys are opaque, never user-controlled paths.
const root = () => path.resolve(/*turbopackIgnore: true*/ process.env.STORAGE_DIR ?? "./storage");

function safeName(name: string) {
  return name.replace(/[^\w.\-() ]+/g, "_").slice(-120) || "file";
}

export async function putFile(buf: Buffer, fileName: string, prefix = "files"): Promise<string> {
  const d = new Date();
  const key = `${prefix}/${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}-${safeName(fileName)}`;
  const full = path.join(root(), key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buf);
  return key;
}

export async function getFile(key: string): Promise<Buffer> {
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep)) throw new Error("Invalid storage key");
  return fs.readFile(full);
}

export function mimeOf(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  return ({
    pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", png: "image/png", jpg: "image/jpeg",
    jpeg: "image/jpeg", dwg: "application/acad", zip: "application/zip", csv: "text/csv", txt: "text/plain", eml: "message/rfc822",
  } as Record<string, string>)[ext ?? ""] ?? "application/octet-stream";
}
