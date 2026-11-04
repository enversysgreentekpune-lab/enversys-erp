import { describe, it, expect } from "vitest";
import fs from "node:fs";
import PizZip from "pizzip";
import ExcelJS from "exceljs";
import { expandMatrix, scopeOf, maxScope } from "@/lib/rbac";
import { fyCode, resolveFrame, compareRange } from "@/lib/period";
import { renderDocx, renderXlsx, inWords } from "@/lib/docgen";
import { formatDocNo } from "@/lib/numbering";
import { haversineM } from "@/lib/hr";

describe("RBAC default matrix", () => {
  it("MD has full company access including settings", () => {
    const p = expandMatrix("MD");
    expect(scopeOf(p, "settings", "edit")).toBe("company");
    expect(scopeOf(p, "costing", "approve")).toBe("company");
  });
  it("sales engineer works on own leads, cannot override margin or see MD dashboard", () => {
    const p = expandMatrix("SALES_ENGINEER");
    expect(scopeOf(p, "leads", "edit")).toBe("own");
    expect(scopeOf(p, "costing", "approve")).toBeNull();
    expect(scopeOf(p, "dashboard_md", "view")).toBeNull();
    expect(scopeOf(p, "customers", "view")).toBe("company");
  });
  it("factory worker sees only own tasks and no cost data", () => {
    const p = expandMatrix("FACTORY_WORKER");
    expect(scopeOf(p, "costing", "view")).toBeNull();
    expect(scopeOf(p, "customers", "view")).toBeNull();
    expect(scopeOf(p, "work_orders", "view")).toBe("own");
    expect(scopeOf(p, "attendance", "create")).toBe("own");
  });
  it("business head is scoped to vertical; base grants merge with the widest scope", () => {
    const p = expandMatrix("BUSINESS_HEAD");
    expect(scopeOf(p, "leads", "approve")).toBe("dept");
    expect(scopeOf(p, "work_orders", "view")).toBe("dept");
    expect(maxScope("own", "team")).toBe("team");
  });
});

describe("financial year & time frames", () => {
  it("FY runs April–March", () => {
    expect(fyCode(new Date(2026, 3, 1))).toBe("26-27");
    expect(fyCode(new Date(2027, 2, 31))).toBe("26-27");
    expect(fyCode(new Date(2026, 2, 31))).toBe("25-26");
  });
  it("resolves quarters and annual ranges", () => {
    const now = new Date(2026, 10, 4);
    expect(resolveFrame("q1", now)).toMatchObject({ from: "2026-04-01", to: "2026-06-30" });
    expect(resolveFrame("q4", now)).toMatchObject({ from: "2027-01-01", to: "2027-03-31" });
    expect(resolveFrame("fy", now)).toMatchObject({ from: "2026-04-01", to: "2027-03-31" });
    expect(resolveFrame("quarter", now).label).toContain("Q3");
    expect(compareRange({ from: "2026-10-01", to: "2026-10-31", label: "" }, "yoy")).toMatchObject({ from: "2025-10-01", to: "2025-10-31" });
    expect(compareRange({ from: "2026-10-01", to: "2026-10-31", label: "" }, "prev")).toMatchObject({ from: "2026-08-31", to: "2026-09-30" });
  });
});

describe("documents & helpers", () => {
  it("formats document numbers per FY", () => expect(formatDocNo("ENV/QT", "26-27", 7)).toBe("ENV/QT/26-27/0007"));
  it("writes amounts in Indian words", () => {
    expect(inWords(12_34_56_789.5)).toBe("Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine and Fifty Paise Only");
    expect(inWords(100000)).toBe("Rupees One Lakh Only");
  });
  it("renders the Word quote template with merge fields and line loop", () => {
    const out = renderDocx(fs.readFileSync("templates/quote_offer.docx"), {
      company: { address: "Pune", gstin: "27X" }, customer: { name: "ACME Industries" }, contact: { name: "Mr. A" }, lead: { enquiry_no: "ENV/ENQ/26-27/0001" },
      proposal: { no: "ENV/QT/26-27/0009", rev: "R1", title: "ETP" }, terms: { payment: "30% advance" },
      lines: [{ sl: 1, description: "Blower", qty: 2, unit_price: "1,00,000.00", amount: "2,00,000.00" }, { sl: 2, description: "Pump", qty: 4, unit_price: "50,000.00", amount: "2,00,000.00" }],
      totals: { net: "4,00,000.00", grand: "4,72,000.00" },
    });
    const xml = new PizZip(out).file("word/document.xml")!.asText();
    expect(xml).toContain("ACME Industries");
    expect(xml).toContain("ENV/QT/26-27/0009");
    expect(xml).toContain("Blower");
    expect(xml).toContain("Pump");
    expect(xml).not.toContain("{{");
  });
  it("renders the Excel price schedule, expanding the line row", async () => {
    const out = await renderXlsx(fs.readFileSync("templates/price_schedule.xlsx"), {
      proposal: { no: "Q1", rev: "R0" }, customer: { name: "ACME" }, totals: { net: "10", gst: "1.8", grand: "11.8" }, terms: {},
      lines: [{ sl: 1, description: "A", qty: 1, unit_price: "5", amount: "5", gst_pct: 18 }, { sl: 2, description: "B", qty: 1, unit_price: "5", amount: "5", gst_pct: 18 }],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out as any);
    const ws = wb.worksheets[0];
    const cells: string[] = [];
    ws.eachRow((r) => r.eachCell((c) => cells.push(String(c.value))));
    expect(cells).toContain("A");
    expect(cells).toContain("B");
    expect(cells).toContain("ACME");
    expect(cells.join(" ")).not.toContain("{{");
  });
  it("computes geofence distances", () => {
    expect(haversineM(18.5596, 73.7799, 18.5596, 73.7799)).toBe(0);
    expect(haversineM(18.5596, 73.7799, 18.6912, 73.9985)).toBeGreaterThan(20000);
  });
});
