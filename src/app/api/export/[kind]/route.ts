// Excel export for registers. Every export is permission-checked, scoped and audited.
import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { q } from "@/lib/db";
import { can, scopeSql } from "@/lib/auth";
import { apiUser, contentDisposition } from "@/lib/apiAuth";
import { woScope, loadProposal } from "@/lib/access";
import { audit } from "@/lib/audit";
import { resolveFrame, type Frame } from "@/lib/period";
import { salesKpis, finance, pipeline, woPortfolio } from "@/lib/queries";
import { OPEN_STAGES } from "@/lib/workflow";

type Sheet = { name: string; columns: { header: string; key: string; width?: number; money?: boolean }[]; rows: any[] };

export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const u = await apiUser();
  if (u instanceof NextResponse) return u;
  const { kind } = await params;
  const sp = req.nextUrl.searchParams;
  const deny = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const sheets: Sheet[] = [];
  const cost = !!can(u, "costing", "view");
  try {
    if (kind === "customers") {
      if (!can(u, "customers", "export")) return deny();
      const p: unknown[] = [];
      const rows = await q(`select c.*, e.name owner from customer c left join employee e on e.id=c.owner_id where ${scopeSql(u, can(u, "customers", "view")!, { owner: ["c.owner_id", "c.created_by"], vertical: "c.vertical_id" }, p)} order by name`, p);
      sheets.push({ name: "Customers", rows, columns: [{ header: "Code", key: "code" }, { header: "Name", key: "name", width: 36 }, { header: "Group", key: "group_name" }, { header: "Industry", key: "industry" }, { header: "GSTIN", key: "gstin", width: 18 }, { header: "Phone", key: "phone" }, { header: "Email", key: "email", width: 28 }, { header: "Rating", key: "rating" }, { header: "Credit limit", key: "credit_limit", money: true }, { header: "Owner", key: "owner" }] });
    } else if (kind === "leads") {
      if (!can(u, "leads", "export")) return deny();
      const p: unknown[] = [];
      const w = [scopeSql(u, can(u, "leads", "view")!, { owner: ["l.assigned_to", "l.created_by"], vertical: "l.vertical_id" }, p)];
      for (const [k, col] of [["stage", "l.stage"], ["vertical", "l.vertical_id"], ["owner", "l.assigned_to"], ["source", "l.source"]] as const) if (sp.get(k)) { p.push(sp.get(k)); w.push(`${col}=$${p.length}`); }
      if (sp.get("open")) { p.push(OPEN_STAGES); w.push(`l.stage = any($${p.length})`); }
      const rows = await q(`select l.*, c.name customer, v.name vertical, e.name owner from lead l join customer c on c.id=l.customer_id join vertical v on v.id=l.vertical_id left join employee e on e.id=l.assigned_to where ${w.join(" and ")} order by enquiry_date desc`, p);
      sheets.push({ name: "Leads", rows, columns: [{ header: "Enquiry no.", key: "enquiry_no", width: 20 }, { header: "Date", key: "enquiry_date" }, { header: "Customer", key: "customer", width: 30 }, { header: "Title", key: "title", width: 40 }, { header: "Vertical", key: "vertical" }, { header: "Category", key: "category" }, { header: "Stage", key: "stage" }, { header: "Source", key: "source" }, { header: "Owner", key: "owner" }, { header: "Est. value", key: "est_value", money: true }, { header: "Expected closure", key: "expected_closure" }, { header: "Lost reason", key: "lost_reason" }, { header: "Competitor", key: "competitor_name" }] });
    } else if (kind === "proposals") {
      if (!can(u, "leads", "export")) return deny();
      const r = resolveFrame((sp.get("frame") as Frame) ?? "fy", new Date(), { from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined });
      const p: unknown[] = [r.from, r.to];
      const sc = scopeSql(u, can(u, "leads", "view")!, { owner: ["p.owner_id", "l.assigned_to"], vertical: "l.vertical_id" }, p);
      const rows = await q(`select p.*, c.name customer, e.name owner, v.name vertical from proposal p join lead l on l.id=p.lead_id join customer c on c.id=p.customer_id join vertical v on v.id=l.vertical_id left join employee e on e.id=p.owner_id
        where p.created_at::date between $1 and $2 and ${sc} ${sp.get("status") ? `and p.status='${String(sp.get("status")).replace(/[^A-Z_]/g, "")}'` : ""} order by p.created_at desc`, p);
      sheets.push({ name: "Proposals", rows, columns: [{ header: "Proposal", key: "proposal_no", width: 20 }, { header: "Customer", key: "customer", width: 30 }, { header: "Title", key: "title", width: 40 }, { header: "Vertical", key: "vertical" }, { header: "Owner", key: "owner" }, { header: "Rev", key: "current_rev" }, { header: "Status", key: "status" }, { header: "Quoted", key: "quoted_value", money: true }, { header: "Final", key: "final_value", money: true }, ...(cost ? [{ header: "Margin %", key: "quoted_margin_pct" }] : []), { header: "Lost reason", key: "lost_reason" }] });
    } else if (kind === "work-orders") {
      if (!can(u, "work_orders", "view")) return deny();
      const p: unknown[] = [];
      const rows = await q(`select w.*, c.name customer from v_wo_pnl w join customer c on c.id=w.customer_id where ${woScope(u, "view", p)} order by w.wo_no`, p);
      sheets.push({ name: "Work orders", rows, columns: [{ header: "WO", key: "wo_no", width: 20 }, { header: "Type", key: "wo_type" }, { header: "Title", key: "title", width: 40 }, { header: "Customer", key: "customer", width: 30 }, { header: "Status", key: "status" }, { header: "% complete", key: "pct_complete" }, { header: "Contract", key: "contract_value", money: true }, { header: "Billed", key: "billed", money: true }, { header: "Received", key: "received", money: true },
        ...(cost ? [{ header: "Budget", key: "budget_cost", money: true }, { header: "Actual", key: "actual_cost", money: true }, { header: "Committed", key: "committed_cost", money: true }, { header: "Quoted margin %", key: "quoted_margin_pct" }, { header: "Est. margin %", key: "est_margin_pct" }] : []), { header: "Schedule RAG", key: "schedule_rag" }, { header: "Cost RAG", key: "cost_rag" }] });
    } else if (kind === "spec") {
      const p = await loadProposal(u, sp.get("proposal") ?? "");
      const rows = await q(`select s.* from spec_line s join proposal_revision r on r.id=s.revision_id where r.proposal_id=$1 and r.rev_no=$2 order by sl`, [p.id, p.current_rev]);
      sheets.push({ name: "Material spec", rows, columns: [{ header: "Sl", key: "sl" }, { header: "Item code", key: "item_code" }, { header: "Description", key: "description", width: 36 }, { header: "Specification", key: "specification", width: 50 }, { header: "Make", key: "make" }, { header: "MOC", key: "moc" }, { header: "Size/Rating", key: "size_rating" }, { header: "Standard", key: "standard" }, { header: "Qty", key: "qty" }, { header: "UOM", key: "uom" }, { header: "Drawing ref", key: "drawing_ref" }, { header: "Remarks", key: "remarks" }, { header: "GST%", key: "gst_pct" }] });
    } else if (kind === "attendance") {
      const sc = can(u, "attendance", "export");
      if (!sc) return deny();
      const month = (sp.get("month") ?? new Date().toISOString().slice(0, 7)).replace(/[^\d-]/g, "");
      const rows = await q(`select e.emp_code, e.name, l.name loc, a.att_date, a.status, a.check_in, a.check_out, a.is_late, a.ot_hours, a.source from attendance a join employee e on e.id=a.employee_id left join location l on l.id=e.location_id
        where to_char(a.att_date,'YYYY-MM')=$1 and ($2::uuid[] is null or e.id = any($2)) order by e.name, a.att_date`, [month, sc === "company" ? null : [u.id, ...u.teamIds]]);
      sheets.push({ name: `Attendance ${month}`, rows: rows.map((r) => ({ ...r, check_in: r.check_in?.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }), check_out: r.check_out?.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }) })), columns: [{ header: "Code", key: "emp_code" }, { header: "Name", key: "name", width: 24 }, { header: "Location", key: "loc", width: 24 }, { header: "Date", key: "att_date" }, { header: "Status", key: "status" }, { header: "In", key: "check_in" }, { header: "Out", key: "check_out" }, { header: "Late", key: "is_late" }, { header: "OT h", key: "ot_hours" }, { header: "Source", key: "source" }] });
    } else if (kind === "md") {
      if (!can(u, "dashboard_md", "export") && !can(u, "dashboard_md", "view")) return deny();
      const r = resolveFrame((sp.get("frame") as Frame) ?? "fy", new Date(), { from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined });
      const f = { verticalId: can(u, "dashboard_md", "view") === "dept" ? u.verticalId : sp.get("vertical") || null };
      const [s, fin, pipe, wos] = await Promise.all([salesKpis(r, f), finance(r, f), pipeline(f), woPortfolio(f)]);
      sheets.push({ name: "KPIs", columns: [{ header: "KPI", key: "k", width: 36 }, { header: "Value", key: "v", money: true, width: 20 }, { header: "Note", key: "n", width: 30 }], rows: [
        { k: "Period", n: r.label }, { k: "Order booking", v: s.booking.v, n: `${s.booking.n} orders` }, { k: "Revenue (invoiced)", v: fin.revenue }, { k: "Collections", v: fin.collections },
        { k: "Receivables", v: fin.receivables }, { k: "Receivables > 90 days", v: fin.over90 }, { k: "Committed payables", v: fin.committed }, { k: "Project direct cost", v: fin.projectCost },
        { k: "Office admin", v: fin.officeAdmin }, { k: "Factory admin", v: fin.factoryAdmin }, { k: "Pipeline (gross)", v: pipe.total }, { k: "Pipeline (weighted)", v: pipe.weighted },
        { k: "Proposals won", v: s.won.v, n: `${s.won.n}` }, { k: "Proposals lost", v: s.lost.v, n: `${s.lost.n}` }, { k: "In discussion", v: s.inDiscussion.v, n: `${s.inDiscussion.n}` }, { k: "In negotiation", v: s.inNegotiation.v, n: `${s.inNegotiation.n}` },
        { k: "Win ratio (value) %", v: s.winRateValue }] });
      sheets.push({ name: "Work orders", rows: wos, columns: [{ header: "WO", key: "wo_no", width: 20 }, { header: "Customer", key: "customer", width: 28 }, { header: "Type", key: "wo_type" }, { header: "Contract", key: "contract_value", money: true }, { header: "Billed", key: "billed", money: true }, { header: "Budget", key: "budget_cost", money: true }, { header: "Actual", key: "actual_cost", money: true }, { header: "Est. margin %", key: "est_margin_pct" }, { header: "Cost RAG", key: "cost_rag" }, { header: "Schedule RAG", key: "schedule_rag" }] });
    } else return NextResponse.json({ error: "Unknown export" }, { status: 404 });
  } catch (e: any) {
    if (e?.digest?.includes?.("NEXT_HTTP_ERROR_FALLBACK") || e?.digest?.includes?.("NEXT_NOT_FOUND")) return NextResponse.json({ error: "Not found" }, { status: 404 });
    throw e;
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = "Enversys";
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    ws.columns = s.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 14, style: c.money ? { numFmt: "#,##,##0" } : {} }));
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B5394" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    s.rows.forEach((r) => ws.addRow(r));
  }
  await audit(u.id, "EXPORT", kind, null, null, { rows: sheets.reduce((a, s) => a + s.rows.length, 0), query: Object.fromEntries(sp) });
  const name = `enversys-${kind}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(new Uint8Array(await wb.xlsx.writeBuffer()), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": contentDisposition(name) } });
}
