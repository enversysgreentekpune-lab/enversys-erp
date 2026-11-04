import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import ExcelJS from "exceljs";
import { getFile } from "./storage";
import { one, type Db, pool } from "./db";

const resolve = (path: string, scope: any) =>
  path === "." ? scope : path.split(".").reduce((o: any, k) => (o == null ? undefined : o[k]), scope);

/** Fill a .docx template that uses {{dot.path}} fields and {{#loop}}…{{/loop}} sections */
export function renderDocx(tpl: Buffer, data: Record<string, any>): Buffer {
  const doc = new Docxtemplater(new PizZip(tpl), {
    delimiters: { start: "{{", end: "}}" }, paragraphLoop: true, linebreaks: true,
    nullGetter: () => "",
    parser: (tag: string) => ({ get: (scope: any) => resolve(tag.trim(), scope) }),
  });
  doc.render(data);
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}

/** Fill an .xlsx template: scalar {{fields}} anywhere; a row whose first cell starts with {{#name}} repeats per item */
export async function renderXlsx(tpl: Buffer, data: Record<string, any>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(tpl as any);
  const fillStr = (s: string, scope: any) => {
    const whole = s.match(/^\{\{\s*([\w.]+)\s*\}\}$/);
    if (whole) { const v = resolve(whole[1], scope); return typeof v === "number" ? v : v ?? ""; }
    return s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => String(resolve(k, scope) ?? ""));
  };
  wb.eachSheet((ws) => {
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const first = String(row.getCell(1).value ?? "");
      const m = first.match(/^\{\{#(\w+)\}\}/);
      if (!m) continue;
      const items: any[] = resolve(m[1], data) ?? [];
      const tplVals = (row.values as any[]).slice(1).map((v) => String(v ?? "").replace(`{{#${m[1]}}}`, "").replace(`{{/${m[1]}}}`, ""));
      const styles = tplVals.map((_, i) => ({ ...row.getCell(i + 1).style }));
      ws.spliceRows(r, 1, ...items.map((it) => tplVals.map((t) => fillStr(t, { ...data, ...it }))));
      for (let i = 0; i < items.length; i++) styles.forEach((s, c) => (ws.getRow(r + i).getCell(c + 1).style = s));
      r += Math.max(items.length - 1, 0);
    }
    ws.eachRow((row) => row.eachCell((c) => { if (typeof c.value === "string" && c.value.includes("{{")) c.value = fillStr(c.value, data) as any; }));
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function loadTemplate(code: string, db: Db = pool): Promise<Buffer> {
  const t = await one(`select storage_key from template where code=$1 and is_active order by version desc limit 1`, [code], db);
  if (!t?.storage_key) throw new Error(`Template ${code} not configured`);
  return getFile(t.storage_key);
}

// Indian numbering in words (for quotes / invoices)
const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const two = (n: number) => (n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? " " + ones[n % 10] : ""}`);
const three = (n: number) => (n >= 100 ? `${ones[Math.floor(n / 100)]} Hundred${n % 100 ? " " + two(n % 100) : ""}` : two(n));
export function inWords(amount: number): string {
  let n = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - n) * 100);
  if (n === 0 && !paise) return "Rupees Zero Only";
  const parts: string[] = [];
  const cr = Math.floor(n / 1e7); n %= 1e7;
  const lk = Math.floor(n / 1e5); n %= 1e5;
  const th = Math.floor(n / 1e3); n %= 1e3;
  if (cr) parts.push(`${cr >= 100 ? three(cr) : two(cr)} Crore`);
  if (lk) parts.push(`${two(lk)} Lakh`);
  if (th) parts.push(`${two(th)} Thousand`);
  if (n) parts.push(three(n));
  return `Rupees ${parts.join(" ")}${paise ? ` and ${two(paise)} Paise` : ""} Only`;
}
