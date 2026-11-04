// Builds the default Enversys-branded Word/Excel templates (merge fields use {{path}} and {{#loop}}...{{/loop}}).
// Admins can download these from Admin → Templates, edit in Word/Excel and upload a new version.
import fs from "node:fs/promises";
import path from "node:path";
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, HeadingLevel, BorderStyle, ShadingType } from "docx";
import ExcelJS from "exceljs";

const BRAND = "0B5394";
const out = path.resolve("./templates");
const P = (text: string, o: { bold?: boolean; size?: number; color?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) =>
  new Paragraph({ alignment: o.align, spacing: { after: 80 }, children: [new TextRun({ text, bold: o.bold, size: o.size ?? 20, color: o.color, font: "Calibri" })] });
const cell = (text: string, o: { bold?: boolean; fill?: string; w?: number; align?: any } = {}) =>
  new TableCell({
    width: o.w ? { size: o.w, type: WidthType.PERCENTAGE } : undefined,
    shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: "auto" } : undefined,
    children: [new Paragraph({ alignment: o.align, children: [new TextRun({ text, bold: o.bold, size: 18, font: "Calibri", color: o.fill === BRAND ? "FFFFFF" : undefined })] })],
  });
const header = () => [
  new Paragraph({ children: [new TextRun({ text: "ENVERSYS", bold: true, size: 40, color: BRAND, font: "Calibri" }), new TextRun({ text: "   Engineering • Manufacturing • I&C • O&M", size: 18, color: "666666" })] }),
  new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BRAND, space: 4 } }, children: [new TextRun({ text: "{{company.address}} | {{company.phone}} | {{company.email}} | GSTIN {{company.gstin}}", size: 16, color: "666666" })] }),
];
const kv = (rows: [string, string][]) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: rows.map(([k, v]) => new TableRow({ children: [cell(k, { bold: true, w: 30, fill: "EEF3F8" }), cell(v, { w: 70 })] })),
});

async function quoteDocx() {
  const lineHdr = ["Sl", "Description", "Specification / Make / MOC", "Qty", "UOM", "Unit Price (₹)", "Amount (₹)"];
  const doc = new Document({
    sections: [{
      children: [
        ...header(),
        P("TECHNO-COMMERCIAL OFFER", { bold: true, size: 30, color: BRAND, align: AlignmentType.CENTER }),
        kv([["Offer No.", "{{proposal.no}} Rev {{proposal.rev}}"], ["Date", "{{proposal.date}}"], ["Your Enquiry", "{{lead.enquiry_no}} dated {{lead.date}}"], ["Customer", "{{customer.name}}"], ["Kind Attn.", "{{contact.name}} {{contact.designation}}"], ["Subject", "{{proposal.title}}"]]),
        P(""),
        P("Dear Sir / Madam,"),
        P("We thank you for your enquiry and are pleased to submit our techno-commercial offer for {{proposal.title}}. Our offer comprises the technical specification and price schedule below, together with our commercial terms and conditions."),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "1. Scope & Price Schedule", bold: true, color: BRAND, size: 24 })] }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ tableHeader: true, children: lineHdr.map((h) => cell(h, { bold: true, fill: BRAND })) }),
            new TableRow({ children: [cell("{{#lines}}{{sl}}"), cell("{{description}}"), cell("{{specification}} {{make}} {{moc}} {{size_rating}} {{standard}}"), cell("{{qty}}", { align: AlignmentType.RIGHT }), cell("{{uom}}"), cell("{{unit_price}}", { align: AlignmentType.RIGHT }), cell("{{amount}}{{/lines}}", { align: AlignmentType.RIGHT })] }),
          ],
        }),
        P(""),
        kv([["Total (excl. GST)", "₹ {{totals.net}}"], ["GST", "₹ {{totals.gst}} ({{totals.gst_mode}})"], ["Grand Total", "₹ {{totals.grand}}"], ["In words", "{{totals.words}}"]]),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "2. Commercial Terms", bold: true, color: BRAND, size: 24 })] }),
        kv([["Price basis", "{{terms.price_basis}}"], ["Validity", "{{terms.validity}}"], ["Payment terms", "{{terms.payment}}"], ["Delivery", "{{terms.delivery}}"], ["Warranty", "{{terms.warranty}}"], ["LD clause", "{{terms.ld}}"], ["Exclusions", "{{terms.exclusions}}"], ["Deviations", "{{terms.deviations}}"]]),
        P(""),
        P("We trust our offer is in line with your requirement and look forward to your valued order."),
        P("For ENVERSYS", { bold: true }),
        P("{{owner.name}}"), P("{{owner.mobile}} | {{owner.email}}"),
      ],
    }],
  });
  await fs.writeFile(path.join(out, "quote_offer.docx"), await Packer.toBuffer(doc));
}

async function woAcceptanceDocx() {
  const doc = new Document({
    sections: [{
      children: [
        ...header(),
        P("INTERNAL ORDER ACCEPTANCE & KICK-OFF", { bold: true, size: 30, color: BRAND, align: AlignmentType.CENTER }),
        kv([["Work Order No.", "{{wo.no}}"], ["Type", "{{wo.type}}"], ["Customer", "{{customer.name}}"], ["Customer PO", "{{po.no}} dated {{po.date}}"], ["Contract value", "₹ {{wo.value}}"], ["Budget cost (from cost sheet)", "₹ {{wo.budget}}"], ["Quoted margin", "{{wo.margin}}%"], ["Project Manager", "{{wo.pm}}"], ["Fabrication at Markal", "{{wo.fabrication}}"]]),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "Material scope", bold: true, color: BRAND, size: 24 })] }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ children: ["Sl", "Description", "Qty", "UOM", "Route"].map((h) => cell(h, { bold: true, fill: BRAND })) }),
            new TableRow({ children: [cell("{{#lines}}{{sl}}"), cell("{{description}}"), cell("{{qty}}"), cell("{{uom}}"), cell("{{route}}{{/lines}}")] }),
          ],
        }),
        P(""),
        P("Kick-off checklist: ☐ PO reviewed vs offer  ☐ Budget frozen  ☐ PR raised to Purchase  ☐ Drawings list  ☐ Job order to Markal (if applicable)  ☐ QAP/ITP  ☐ Billing milestones agreed"),
      ],
    }],
  });
  await fs.writeFile(path.join(out, "wo_acceptance.docx"), await Packer.toBuffer(doc));
}

async function priceXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Price Schedule");
  ws.columns = [{ width: 6 }, { width: 38 }, { width: 46 }, { width: 10 }, { width: 8 }, { width: 16 }, { width: 18 }, { width: 8 }];
  ws.mergeCells("A1:G1"); ws.getCell("A1").value = "ENVERSYS — PRICE SCHEDULE / BOQ";
  ws.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF" + BRAND } };
  const meta: [string, string][] = [["Offer No.", "{{proposal.no}} Rev {{proposal.rev}}"], ["Date", "{{proposal.date}}"], ["Customer", "{{customer.name}}"], ["Subject", "{{proposal.title}}"]];
  meta.forEach(([k, v], i) => { ws.getCell(`A${i + 3}`).value = k; ws.getCell(`A${i + 3}`).font = { bold: true }; ws.mergeCells(`C${i + 3}:G${i + 3}`); ws.getCell(`C${i + 3}`).value = v; ws.mergeCells(`A${i + 3}:B${i + 3}`); });
  const hr = ws.getRow(8);
  hr.values = ["Sl", "Description", "Specification / Make / MOC", "Qty", "UOM", "Unit Price (₹)", "Amount (₹)", "GST %"];
  hr.eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + BRAND } }; });
  ws.getRow(9).values = ["{{#lines}}{{sl}}", "{{description}}", "{{specification}} {{make}} {{moc}}", "{{qty}}", "{{uom}}", "{{unit_price}}", "{{amount}}", "{{gst_pct}}"];
  ws.getRow(11).values = ["", "", "", "", "", "Total (excl. GST)", "{{totals.net}}"];
  ws.getRow(12).values = ["", "", "", "", "", "GST", "{{totals.gst}}"];
  ws.getRow(13).values = ["", "", "", "", "", "Grand Total", "{{totals.grand}}"];
  [11, 12, 13].forEach((r) => (ws.getRow(r).font = { bold: true }));
  ws.getCell("A15").value = "Terms: {{terms.payment}} | Delivery: {{terms.delivery}} | Validity: {{terms.validity}}";
  await wb.xlsx.writeFile(path.join(out, "price_schedule.xlsx"));
}

(async () => {
  await fs.mkdir(out, { recursive: true });
  await quoteDocx(); await woAcceptanceDocx(); await priceXlsx();
  console.log("Templates written to", out);
})();
