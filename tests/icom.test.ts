// I&C after dispatch (handover documents, signed certificates close the project) and O&M field operations.
import { describe, it, expect, afterAll } from "vitest";
import { pool, one, q } from "@/lib/db";
import { expandMatrix } from "@/lib/rbac";
import * as IC from "@/lib/ic";
import * as OM from "@/lib/om";
import { saveAttachment } from "@/lib/attachments";
import type { CurrentUser } from "@/lib/auth";

afterAll(() => pool.end());
const asUser = async (mobile: string): Promise<CurrentUser> => {
  const e = await one(`select e.*, r.code role, r.name role_name from employee e join role r on r.id=e.role_id where mobile=$1`, [mobile]);
  return { id: e.id, name: e.name, mobile, email: e.email, empCode: e.emp_code, roleCode: e.role, roleName: e.role_name, verticalId: e.vertical_id, verticalName: null,
    departmentId: e.department_id, locationId: e.location_id, managerId: e.manager_id, perms: expandMatrix(e.role), teamIds: [], sessionId: "t", hasPin: false } as CurrentUser;
};
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

describe("I&C: dispatched projects, handover documents and completion", () => {
  it("every dispatched supply/project order has an I&C record", async () => {
    const missing = await q(`select distinct d.wo_id from dispatch d join work_order w on w.id=d.wo_id where w.order_class<>'WO' and not exists (select 1 from ic_project ic where ic.wo_id=d.wo_id)`);
    expect(missing).toHaveLength(0);
  });
  it("documents need 100% progress; the project completes only when both signed certificates are uploaded", async () => {
    const pm = await asUser("9800000012");
    const ic = await one(`select ic.* from ic_project ic join work_order w on w.id=ic.wo_id where ic.status in ('NOT_STARTED','IN_PROGRESS') and w.status not in ('CLOSED','COMPLETED') order by ic.pct desc limit 1`);
    expect(ic).toBeTruthy();
    if (Number(ic.pct) < 100) await expect(IC.generateHandoverDocs(ic.id, pm.id)).rejects.toThrow(/100%/);
    await expect(IC.addIcUpdate(ic.id, { stage: "HANDOVER", pct: 100, activity: "Done", clientSigned: true }, pm.id)).rejects.toThrow(/representative/);
    await IC.addIcUpdate(ic.id, { stage: "HANDOVER", pct: 100, activity: "Performance test passed; plant handed over", clientSigned: true, clientRep: "Plant head" }, pm.id);
    const docs = await IC.generateHandoverDocs(ic.id, pm.id);
    expect(docs.map((d) => d.doc_type).sort()).toEqual([IC.IC_DOCS.appreciation, IC.IC_DOCS.handover, IC.IC_DOCS.report].sort());
    expect(docs.every((d) => d.file_name.endsWith(".docx"))).toBe(true);
    await expect(IC.sendHandoverDocs(ic.id, "not-an-email", undefined, undefined, pm)).rejects.toThrow(/email/);
    await IC.sendHandoverDocs(ic.id, "client@example.com", undefined, undefined, pm);
    const signed = (doc: string) => saveAttachment({ entity: "ic_project", entityId: ic.id, fileName: `${doc}.pdf`, buf: Buffer.from("%PDF-1.4 test"), docType: doc, userId: pm.id });
    const r1 = await IC.recordSignedCertificate(ic.id, "HANDOVER", (await signed(IC.IC_DOCS.signedHandover)).id, pm.id);
    expect(r1.completed).toBe(false);
    expect((await one(`select status from ic_project where id=$1`, [ic.id])).status).toBe("HANDOVER_PENDING");
    expect((await one(`select status from work_order where id=$1`, [ic.wo_id])).status).not.toBe("COMPLETED");
    const r2 = await IC.recordSignedCertificate(ic.id, "APPRECIATION", (await signed(IC.IC_DOCS.signedAppreciation)).id, pm.id);
    expect(r2.completed).toBe(true);
    expect((await one(`select status from ic_project where id=$1`, [ic.id])).status).toBe("COMPLETED");
    expect((await one(`select status, pct_complete from work_order where id=$1`, [ic.wo_id])).status).toBe("COMPLETED");
    await expect(IC.addIcUpdate(ic.id, { stage: "HANDOVER", pct: 100, activity: "x" }, pm.id)).rejects.toThrow(/completed/);
  });
});

describe("O&M field operations", () => {
  it("operators see only their own sites; supervisors and directors see all", async () => {
    const op = await asUser("9800000033"), sup = await asUser("9800000028"), md = await asUser("9800000001");
    const mine = await OM.siteIdsFor(op);
    expect(mine!.length).toBeGreaterThan(0);
    expect(await OM.siteIdsFor(sup)).toBeNull();
    expect(await OM.siteIdsFor(md)).toBeNull();
    const other = await one(`select id from om_site where not (id = any($1)) limit 1`, [mine]);
    await expect(OM.saveDailyLog(op, other.id, { date: today(), presentIds: [], waterTreated: 1, energyKwh: 1, status: "NORMAL", chemicals: [] })).rejects.toThrow(/not assigned/);
    // field operator permissions: own O&M work, no sales or finance
    expect(op.perms["field_services:view"]).toBe("own");
    expect(op.perms["leads:view"]).toBeUndefined();
    expect(op.perms["finance:view"]).toBeUndefined();
  });
  it("daily report validates input, records presence and raises a ticket for an operation issue", async () => {
    const op = await asUser("9800000033");
    const [siteId] = (await OM.siteIdsFor(op))!;
    const staff = await q(`select employee_id from om_site_staff where site_id=$1`, [siteId]);
    const base = { date: today(), presentIds: staff.map((s) => s.employee_id), waterTreated: 150, energyKwh: 100, chemicals: [{ chemical: "Alum", qty: 40, uom: "KG" }] };
    await expect(OM.saveDailyLog(op, siteId, { ...base, status: "ISSUE" })).rejects.toThrow(/issue/i);
    await expect(OM.saveDailyLog(op, siteId, { ...base, status: "NORMAL", inletPh: 15 })).rejects.toThrow(/pH/);
    const before = await one(`select count(*)::int n from om_ticket where site_id=$1`, [siteId]);
    const log = await OM.saveDailyLog(op, siteId, { ...base, status: "SHUTDOWN", issueNote: "Power failure — DG not starting" });
    expect(log.present_count).toBe(staff.length);
    const after = await one(`select count(*)::int n from om_ticket where site_id=$1`, [siteId]);
    expect(after.n).toBe(before.n + 1);
    expect((await one(`select priority from om_ticket where site_id=$1 order by created_at desc limit 1`, [siteId])).priority).toBe("CRITICAL");
    await OM.saveDailyLog(op, siteId, { ...base, status: "NORMAL" }); // correction overwrites the same day
    expect((await one(`select count(*)::int n from om_daily_log where site_id=$1 and log_date=$2`, [siteId, today()])).n).toBe(1);
    const d = await OM.omDashboard(null, today());
    expect(d.rows.find((r) => r.id === siteId)!.operation_status).toBe("NORMAL");
  });
  it("spares cannot go negative; tickets need a resolution; requisitions are decided by a supervisor", async () => {
    const op = await asUser("9800000033"), sup = await asUser("9800000028");
    const [siteId] = (await OM.siteIdsFor(op))!;
    const sp = await OM.addSpare(op, siteId, { name: "Test seal kit", qty: 2, minQty: 1 });
    await expect(OM.spareMove(op, sp.id, "OUT", 5, "pump")).rejects.toThrow(/in stock/);
    await OM.spareMove(op, sp.id, "OUT", 2, "Pump P-1");
    expect(Number((await one(`select qty from om_spare where id=$1`, [sp.id])).qty)).toBe(0);
    const t = await OM.createTicket(op, siteId, { source: "CLIENT", clientName: "Client EHS", category: "WATER_QUALITY", priority: "HIGH", title: "Colour in treated water" });
    await expect(OM.updateTicket(op, t.id, { status: "RESOLVED" })).rejects.toThrow(/resolution/);
    await OM.updateTicket(op, t.id, { status: "RESOLVED", resolution: "Activated carbon filter backwashed" });
    await expect(OM.updateTicket(op, t.id, { status: "CLOSED" })).rejects.toThrow(/supervisor/);
    await OM.updateTicket(sup, t.id, { status: "CLOSED" });
    const doc = await OM.ticketResolutionDoc(t.id);
    expect(doc.buf.subarray(0, 2).toString()).toBe("PK");
    const r = await OM.raiseOmRequisition(op, siteId, { kind: "MATERIAL", reason: "Stock low", lines: [{ description: "Alum", qty: 200, uom: "KG" }] });
    await expect(OM.decideOmRequisition(op, r.id, "APPROVED", "")).rejects.toThrow(/supervisor/);
    await OM.decideOmRequisition(sup, r.id, "APPROVED", "ok");
    expect((await one(`select status from om_requisition where id=$1`, [r.id])).status).toBe("APPROVED");
    const m = await OM.monthlyReportDoc(siteId, today().slice(0, 7));
    expect(m.buf.length).toBeGreaterThan(5000);
  });
});
