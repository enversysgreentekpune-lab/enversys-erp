// Word documents generated from live data: I&C handover report and certificates, O&M ticket
// resolutions, monthly reports and site visit reports. Enversys letterhead (logo, address).
import fs from "node:fs";
import path from "node:path";
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, ShadingType, ImageRun, HeadingLevel } from "docx";

const GREEN = "15803D", NAVY = "06243C", GREY = "64748B";
export type Company = { name?: string; legal_name?: string; address?: string; phone?: string; email?: string; website?: string; gstin?: string };

const run = (text: string, o: { bold?: boolean; size?: number; color?: string; italics?: boolean } = {}) =>
  new TextRun({ text, bold: o.bold, italics: o.italics, size: o.size ?? 20, color: o.color, font: "Calibri" });
export const P = (text: string, o: { bold?: boolean; size?: number; color?: string; align?: any; after?: number; italics?: boolean } = {}) =>
  new Paragraph({ alignment: o.align, spacing: { after: o.after ?? 100 }, children: [run(text, o)] });
export const H = (text: string) =>
  new Paragraph({ spacing: { before: 240, after: 100 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GREEN, space: 2 } }, children: [run(text.toUpperCase(), { bold: true, size: 22, color: NAVY })] });
const cell = (text: string, o: { bold?: boolean; fill?: string; w?: number; align?: any } = {}) => new TableCell({
  width: o.w ? { size: o.w, type: WidthType.PERCENTAGE } : undefined,
  shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: "auto" } : undefined,
  margins: { top: 40, bottom: 40, left: 80, right: 80 },
  children: String(text ?? "").split("\n").map((t) => new Paragraph({ alignment: o.align, children: [run(t, { bold: o.bold, size: 18, color: o.fill === NAVY ? "FFFFFF" : undefined })] })),
});
export const KV = (rows: [string, string][]) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: rows.map(([k, v]) => new TableRow({ children: [cell(k, { bold: true, w: 32, fill: "F1F5F9" }), cell(v || "—", { w: 68 })] })),
});
export const GRID = (head: string[], rows: (string | number)[][], widths?: number[]) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: [new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, { bold: true, fill: NAVY, w: widths?.[i] })) }),
    ...(rows.length ? rows : [head.map((_, i) => (i === 0 ? "No records" : ""))]).map((r) => new TableRow({ children: r.map((v, i) => cell(String(v ?? ""), { w: widths?.[i], align: typeof v === "number" ? AlignmentType.RIGHT : undefined })) }))],
});
export const SIGN = (left: [string, string], right: [string, string]) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  borders: { top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } },
  rows: [new TableRow({ children: [left, right].map(([who, sub]) => new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, children: [
    new Paragraph({ spacing: { before: 700 }, children: [run("______________________________", { color: GREY })] }),
    new Paragraph({ children: [run(who, { bold: true })] }), new Paragraph({ children: [run(sub, { size: 18, color: GREY })] }),
    new Paragraph({ children: [run("Name, designation, date & seal", { size: 16, color: GREY, italics: true })] }),
  ] })) })],
});

function letterhead(co: Company) {
  const out: (Paragraph)[] = [];
  try {
    const logo = fs.readFileSync(path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "enversys-logo.png"));
    out.push(new Paragraph({ children: [new ImageRun({ type: "png", data: logo, transformation: { width: 186, height: 36 } })] }));
  } catch { out.push(P("ENVERSYS", { bold: true, size: 36, color: GREEN })); }
  out.push(new Paragraph({ spacing: { after: 200 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: GREEN, space: 4 } },
    children: [run([co.legal_name ?? co.name, co.address, co.phone, co.email, co.gstin && `GSTIN ${co.gstin}`].filter(Boolean).join("  |  "), { size: 16, color: GREY })] }));
  return out;
}

export async function buildDoc(co: Company, title: string, subtitle: string, body: (Paragraph | Table)[]) {
  const doc = new Document({
    creator: "Enversys Business Suite", title,
    styles: { default: { document: { run: { font: "Calibri", size: 20 } } } },
    sections: [{ properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } }, children: [
      ...letterhead(co),
      new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [run(title, { bold: true, size: 32, color: NAVY })] }),
      P(subtitle, { align: AlignmentType.CENTER, color: GREY, after: 240 }),
      ...body,
    ] }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

export const fmtDate = (d: any) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");
export const fmtNum = (v: any, dp = 2) => Number(v ?? 0).toLocaleString("en-IN", { maximumFractionDigits: dp });
export const lbl = (s: string) => String(s ?? "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
