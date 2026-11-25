import Link from "next/link";
import { requireUser, can } from "@/lib/auth";
import { redirect } from "next/navigation";
import { q } from "@/lib/db";
import { woScope } from "@/lib/access";
import { inr, inrShort, dt, num, label } from "@/lib/format";
import { PageHeader, Card, Table, Badge, Stat, Tabs, Empty, Progress } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { milestoneAchievedAction, invoiceAction } from "@/app/actions/ops";

export const metadata = { title: "Work Orders (services)" };

export default async function SoDashboard({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const u = await requireUser();
  if (!can(u, "work_orders", "view")) redirect("/forbidden");
  const tab = (await searchParams).tab ?? "list";
  const p: unknown[] = [];
  const sos = await q(`select w.*, c.name customer,
      (select string_agg(e.name, ', ') from wo_team t join employee e on e.id=t.employee_id where t.wo_id=w.id and t.team_role='PM') pm,
      (select count(*)::int from milestone m where m.wo_id=w.id) ms_total,
      (select count(*)::int from milestone m where m.wo_id=w.id and m.status in ('DONE','INVOICED')) ms_done,
      coalesce((select sum(i.gst) from invoice i where i.wo_id=w.id),0) gst_billed
    from v_wo_pnl w join customer c on c.id=w.customer_id where w.order_kind='SO' and ${woScope(u, "view", p)} order by w.created_at desc`, p);
  const ids = sos.map((s) => s.id);
  const milestones = ids.length ? await q(`select m.*, w.wo_no, c.name customer, (select i.invoice_no from invoice i where i.milestone_id=m.id limit 1) invoice_no
    from milestone m join work_order w on w.id=m.wo_id join customer c on c.id=w.customer_id where m.wo_id = any($1) order by m.due_date nulls last`, [ids]) : [];
  const completed = sos.filter((s) => ["COMPLETED", "CLOSED"].includes(s.status));
  const ongoing = sos.filter((s) => !["COMPLETED", "CLOSED", "CANCELLED"].includes(s.status));
  const today = new Date().toISOString().slice(0, 10), soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const due = milestones.filter((m) => m.status !== "INVOICED" && m.due_date && m.due_date <= soon);
  const t = (k: string) => sos.reduce((a, s) => a + Number(s[k]), 0);
  const canBill = !!can(u, "finance", "create"), canEdit = !!can(u, "work_orders", "edit");
  const tabs = [{ key: "list", label: `All service orders (${sos.length})` }, { key: "due", label: `Due list (${due.length})` }, { key: "milestones", label: "Service milestones" }];
  return (
    <div>
      <PageHeader title="Work Orders (WO)" subtitle="O&M, maintenance, I&C and consultancy orders: service milestones → achieved → billed → unbilled → GST" />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Won SOs" value={sos.length} />
        <Stat label="In progress" value={ongoing.length} />
        <Stat label="Completed" value={completed.length} tone="green" />
        <Stat label="SO value" value={inrShort(t("contract_value"))} />
        <Stat label="Milestones achieved" value={`${sos.reduce((a, s) => a + s.ms_done, 0)} / ${sos.reduce((a, s) => a + s.ms_total, 0)}`} />
        <Stat label="Billed" value={inrShort(t("billed"))} />
        <Stat label="Unbilled as per SO" value={inrShort(t("contract_value") - t("billed"))} tone="amber" />
        <Stat label="GST billed" value={inrShort(t("gst_billed"))} />
      </div>
      <Tabs tabs={tabs} active={tab} base="/so" />
      {tab === "list" && (
        <Card bodyClass="p-0">
          {sos.length ? <Table head={["SO / project code", "Type", "Client", "Manager", "Period", "Milestones", "SO value", "Billed", "Unbilled", "GST", "Status"]}>
            {sos.map((s) => <tr key={s.id}><td><Link className="link font-medium" href={`/work-orders/${s.id}`}>{s.wo_no}</Link><div className="max-w-[220px] truncate text-xs text-slate-500">{s.title}</div></td><td>{label(s.wo_type)}</td><td>{s.customer}</td><td className="text-xs">{s.pm}</td>
              <td className="whitespace-nowrap text-xs">{dt(s.start_date)} → {dt(s.end_date)}</td><td className="w-28"><div className="text-xs">{s.ms_done}/{s.ms_total}</div><Progress value={s.ms_total ? (s.ms_done / s.ms_total) * 100 : 0} /></td>
              <td className="num">{inr(s.contract_value)}</td><td className="num">{inr(s.billed)}</td><td className="num">{inr(s.contract_value - s.billed)}</td><td className="num">{inr(s.gst_billed)}</td><td><Badge status={s.status} /></td></tr>)}
          </Table> : <Empty>No service orders yet</Empty>}
        </Card>
      )}
      {(tab === "due" || tab === "milestones") && (
        <Card bodyClass="p-0">
          {(tab === "due" ? due : milestones).length ? <Table head={["SO", "Client", "Service milestone", "Due", "Amount", "GST (18%)", "Status", "Invoice", ""]}>
            {(tab === "due" ? due : milestones).map((m) => (
              <tr key={m.id}><td>{m.wo_no}</td><td>{m.customer}</td><td>{m.name}{m.achieved_note && <div className="text-xs text-slate-500">{m.achieved_note}</div>}</td>
                <td className={m.status === "PENDING" && m.due_date < today ? "font-medium text-rose-600" : ""}>{dt(m.due_date)}</td><td className="num">{inr(m.amount)}</td><td className="num">{inr(m.amount * 0.18)}</td>
                <td>{m.status === "INVOICED" ? <Badge tone="green">Billed</Badge> : m.status === "DONE" ? <Badge tone="blue">Achieved</Badge> : m.due_date < today ? <Badge tone="red">Overdue</Badge> : <Badge>Pending</Badge>}</td>
                <td className="text-xs">{m.invoice_no ?? "—"}</td>
                <td>
                  {m.status === "PENDING" && canEdit && <ActionForm action={milestoneAchievedAction} hideSubmit className="flex gap-1"><input type="hidden" name="id" value={m.id} /><input name="note" placeholder="Note" className="input w-32 py-1" /><button className="btn-secondary btn-sm">Achieved</button></ActionForm>}
                  {m.status === "DONE" && canBill && <ActionForm action={invoiceAction} hideSubmit><input type="hidden" name="wo_id" value={m.wo_id} /><input type="hidden" name="milestone_id" value={m.id} /><button className="btn-primary btn-sm">Bill</button></ActionForm>}
                </td></tr>
            ))}
          </Table> : <Empty>{tab === "due" ? "Nothing due in the next 30 days" : "No milestones"}</Empty>}
        </Card>
      )}
      <p className="mt-2 text-xs text-slate-500">Due list: milestones not yet billed that are overdue or due within 30 days. {num(due.length)} item(s).</p>
    </div>
  );
}
