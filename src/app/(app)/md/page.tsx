import Link from "next/link";
import { requirePage, can } from "@/lib/auth";
import { q, one } from "@/lib/db";
import { resolveFrame, compareRange, type Frame, iso, fyStartYear } from "@/lib/period";
import { inr, num, pct, dt, label } from "@/lib/format";
import { salesKpis, pipeline, funnel, lossReasons, byDimension, leaderboard, woPortfolio, finance, monthlyTrend, adminVsBudget, hrSnapshot, attendanceRange, mdAlerts, topOpportunities } from "@/lib/queries";
import { PageHeader, Card, Stat, Badge, Table, Tabs, Progress, Empty } from "@/components/ui";
import { FrameBar } from "@/components/FrameBar";
import { Bars, Donut, Trend, Funnel } from "@/components/charts";
import { stageLabel } from "@/lib/workflow";
import { todayIST } from "@/lib/hr";

export const metadata = { title: "MD Command Centre" };
type SP = Record<string, string | undefined>;

const TABS = [
  { key: "overview", label: "Overview" }, { key: "sales", label: "Sales & Proposals" }, { key: "projects", label: "Ongoing Projects" },
  { key: "om", label: "O&M" }, { key: "consultancy", label: "Consultancy" }, { key: "trading", label: "Trading" }, { key: "maintenance", label: "Maintenance W/O" },
  { key: "mfg", label: "Manufacturing (Markal)" }, { key: "purchase", label: "Purchase" }, { key: "hr", label: "HR & Admin" }, { key: "finance", label: "Financials" },
];

export default async function MdDashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await requirePage("dashboard_md");
  const sp = await searchParams;
  const range = resolveFrame((sp.frame as Frame) ?? "fy", new Date(), { from: sp.from, to: sp.to });
  const cmp = sp.cmp === "none" ? null : compareRange(range, sp.cmp === "yoy" ? "yoy" : "prev");
  const unit = (sp.unit === "Cr" ? "Cr" : "L") as "L" | "Cr";
  const scope = can(u, "dashboard_md", "view");
  // Business Heads are pinned to their vertical
  const verticalId = scope === "dept" ? u.verticalId : sp.vertical || null;
  const f = { verticalId };
  const tab = sp.tab ?? "overview";
  const money = (v: number) => inr(v, unit);
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => k !== "tab" && v) as [string, string][]).toString();
  const base = `/md?${qs}`;
  const verticals = scope === "company" ? await q(`select id, name from vertical order by sort`) : undefined;
  const delta = (a: number, b: number | undefined) => (cmp && b ? ((a - b) / Math.abs(b)) * 100 : null);

  const [sales, salesPrev, pipe, fin, finPrev, wos, alerts, hc] = await Promise.all([
    salesKpis(range, f), cmp ? salesKpis(cmp, f) : null, pipeline(f), finance(range, f), cmp ? finance(cmp, f) : null,
    woPortfolio(f), mdAlerts(u.roleCode === "MD" || u.roleCode === "SUPER_ADMIN" ? ["MD"] : [u.roleCode]), one(`select count(*)::int n from employee where is_active`),
  ]);
  const live = wos.filter((w) => !["CLOSED", "CANCELLED", "COMPLETED"].includes(w.status));
  const openOrderBook = live.reduce((a, w) => a + Number(w.contract_value) - Number(w.billed), 0);
  const wonMarginSum = live.reduce((a, w) => a + Number(w.contract_value) - Number(w.eac), 0);
  const liveValue = live.reduce((a, w) => a + Number(w.contract_value), 0);
  const grossMarginPct = liveValue ? (wonMarginSum / liveValue) * 100 : 0;
  const netProfit = fin.revenue - fin.projectCost - fin.officeAdmin - fin.factoryAdmin;

  return (
    <div>
      <PageHeader title={u.roleCode === "MD" ? `Good ${new Date().getHours() < 12 ? "morning" : "afternoon"}, ${u.name.split(" ")[0]}` : "Executive Dashboard"}
        subtitle={<>Company command centre · <b>{range.label}</b>{cmp && <> · compared {cmp.label.toLowerCase()}</>}{scope === "dept" && <> · {u.verticalName} vertical</>}</>} />
      <FrameBar verticals={verticals} exportHref="/api/export/md" />

      {/* KPI strip */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Order booking" value={money(sales.booking.v)} sub={`${sales.booking.n} orders`} delta={delta(sales.booking.v, salesPrev?.booking.v)} href="/work-orders" />
        <Stat label="Revenue (invoiced)" value={money(fin.revenue)} delta={delta(fin.revenue, finPrev?.revenue)} href={`${base}&tab=finance`} />
        <Stat label="Collections" value={money(fin.collections)} delta={delta(fin.collections, finPrev?.collections)} href={`${base}&tab=finance`} />
        <Stat label="Receivables" value={money(fin.receivables)} sub={<span className="text-rose-600">{money(fin.over90)} &gt; 90 d</span>} tone={fin.over90 > 0 ? "amber" : undefined} href={`${base}&tab=finance`} />
        <Stat label="Payables (committed)" value={money(fin.committed)} href="/purchase" />
        <Stat label="Gross margin (live WOs)" value={pct(grossMarginPct)} tone={grossMarginPct < 10 ? "red" : "green"} href={`${base}&tab=projects`} />
        <Stat label="Net profit (period)" value={money(netProfit)} tone={netProfit < 0 ? "red" : "green"} sub="revenue − direct − overheads" href={`${base}&tab=finance`} />
        <Stat label="Open order book" value={money(openOrderBook)} sub={`${live.length} live WOs`} href="/work-orders" />
        <Stat label="Pipeline (weighted)" value={money(pipe.weighted)} sub={`${pipe.count} open · ${money(pipe.total)} gross`} href="/leads?open=1" />
        <Stat label="Win ratio (value)" value={pct(sales.winRateValue)} sub={`${pct(sales.winRateCount, 0)} by count`} href={`${base}&tab=sales`} />
        <Stat label="Headcount" value={num(hc?.n)} href={`${base}&tab=hr`} />
        <Stat label="Overdue tasks / escalations" value={`${alerts.overdueTasks.n} / ${alerts.overdueTasks.esc}`} tone={alerts.overdueTasks.n ? "red" : "green"} href="/me" />
      </div>

      <Tabs tabs={TABS} active={tab} base={base} />
      {tab === "overview" && <Overview {...{ range, sales, fin, alerts, wos: live, money, f }} />}
      {tab === "sales" && <Sales {...{ range, sales, f, money, pipe }} />}
      {tab === "projects" && <Portfolio wos={wos.filter((w) => ["PROJECT", "MANUFACTURING", "IC"].includes(w.wo_type))} money={money} title="Projects, Manufacturing & I&C work orders" />}
      {tab === "om" && <Portfolio wos={wos.filter((w) => w.wo_type === "OM")} money={money} title="O&M contracts" note="Contract register, PM schedules, SLA & renewals arrive with the O&M module (Phase 3). Contract profitability below uses the WO cost ledger." />}
      {tab === "consultancy" && <Portfolio wos={wos.filter((w) => w.wo_type === "CONSULTANCY")} money={money} title="Consultancy POs" note="Man-day logging & deliverables arrive in Phase 3." />}
      {tab === "trading" && <Portfolio wos={wos.filter((w) => w.wo_type === "TRADING")} money={money} title="Trading sales orders" note="Quick quote → SO → back-to-back PO flow arrives in Phase 3." />}
      {tab === "maintenance" && <Portfolio wos={wos.filter((w) => w.wo_type === "MAINTENANCE")} money={money} title="Maintenance work orders" note="Service calls, response/resolution SLA and repeat-failure analysis arrive in Phase 3." />}
      {tab === "mfg" && <Manufacturing range={range} money={money} wos={wos.filter((w) => w.has_fabrication)} />}
      {tab === "purchase" && <Purchase money={money} />}
      {tab === "hr" && <HrAdmin range={range} money={money} />}
      {tab === "finance" && <Finance range={range} fin={fin} money={money} />}
    </div>
  );
}

async function Overview({ range, sales, fin, alerts, wos, money, f }: any) {
  const fy = fyStartYear(new Date(range.from));
  const trend = await monthlyTrend(`${fy}-04-01`, `${fy + 1}-03-01`);
  const top = await topOpportunities(f);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Alerts" className="lg:col-span-1" bodyClass="p-0">
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {alerts.approvals.map((a: any) => <AlertRow key={a.id} tone="purple" href={`/approvals`} text={`Approval pending: ${a.ref} (${label(a.doc_type)})`} />)}
          {alerts.overrun.map((w: any) => <AlertRow key={w.id} tone="red" href={`/work-orders/${w.id}`} text={`Cost overrun risk: ${w.wo_no} — ${w.consumed_pct}% budget consumed at ${w.pct_complete}% progress`} />)}
          {alerts.delayed.map((m: any) => <AlertRow key={m.id} tone="amber" href={`/work-orders/${m.wo_id}`} text={`Milestone overdue: ${m.wo_no} · ${m.name} (due ${dt(m.due_date)})`} />)}
          {fin.over90 > 0 && <AlertRow tone="red" href="/md?tab=finance" text={`Receivables > 90 days: ${money(fin.over90)}`} />}
          {alerts.stuck.map((l: any) => <AlertRow key={l.id} tone="amber" href={`/leads/${l.id}`} text={`High-value lead stuck ${l.days} d in ${stageLabel(l.stage)}: ${l.enquiry_no} (${money(l.est_value)})`} />)}
          {alerts.overdueFollowups > 0 && <AlertRow tone="amber" href="/leads?overdue=1" text={`${alerts.overdueFollowups} lead follow-ups overdue`} />}
          {alerts.overdueTasks.n > 0 && <AlertRow tone="red" href="/me" text={`${alerts.overdueTasks.n} tasks overdue company-wide (${alerts.overdueTasks.esc} escalated)`} />}
        </ul>
      </Card>
      <Card title={`Monthly trend — FY ${String(fy).slice(2)}-${String(fy + 1).slice(2)}`} className="lg:col-span-2">
        <Trend data={trend} x="label" lines={[{ key: "booking", label: "Order booking" }, { key: "revenue", label: "Revenue" }]} bars={[{ key: "project_cost", label: "Project cost" }, { key: "office_admin", label: "Office admin" }, { key: "factory_admin", label: "Factory admin" }]} />
      </Card>
      <Card title="Proposals in period" className="lg:col-span-1">
        <div className="grid grid-cols-2 gap-2 text-sm">
          {[["Won", sales.won, "WON"], ["Lost", sales.lost, "LOST"], ["In discussion", sales.inDiscussion, "IN_DISCUSSION"], ["In negotiation", sales.inNegotiation, "IN_NEGOTIATION"]].map(([l, s, st]: any) => (
            <Link key={l} href={`/proposals?status=${st}`} className="rounded-lg border border-slate-200 p-2 hover:border-brand-500 dark:border-slate-800">
              <div className="text-xs text-slate-500">{l}</div><div className="font-semibold">{s.n} · {money(s.v)}</div>
            </Link>
          ))}
        </div>
        <div className="mt-3 text-xs text-slate-500">Submitted: {sales.submitted.n} proposals worth {money(sales.submitted.v)} · Enquiries: {sales.enquiries.n} ({money(sales.enquiries.v)})</div>
      </Card>
      <Card title="Live work orders" className="lg:col-span-2" bodyClass="p-0"><WoTable wos={wos.slice(0, 8)} money={money} compact /></Card>
      <Card title="Top 10 open opportunities" className="lg:col-span-3" bodyClass="p-0">
        <Table head={["Enquiry", "Customer", "Title", "Stage", "Owner", "Closure", "Value"]}>
          {top.map((l) => (
            <tr key={l.id}><td><Link className="link" href={`/leads/${l.id}`}>{l.enquiry_no}</Link></td><td>{l.customer}</td><td className="max-w-xs truncate">{l.title}</td>
              <td><Badge status={l.stage}>{stageLabel(l.stage)}</Badge></td><td>{l.owner}</td><td>{dt(l.expected_closure)}</td><td className="num">{money(l.est_value)}</td></tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

function AlertRow({ text, href, tone }: { text: string; href: string; tone: "red" | "amber" | "purple" }) {
  const c = { red: "bg-rose-500", amber: "bg-amber-500", purple: "bg-violet-500" }[tone];
  return <li><Link href={href} className="flex items-start gap-2 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/40"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${c}`} /><span>{text}</span></Link></li>;
}

async function Sales({ range, sales, f, money, pipe }: any) {
  const [fun, loss, byV, byS, lb] = await Promise.all([funnel(range, f), lossReasons(range, f), byDimension("vertical", range, f), byDimension("source", range, f), leaderboard(range)]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Sales funnel (enquiries in period)"><Funnel data={fun} /></Card>
      <Card title="Proposal status (count / value)">
        <Bars data={sales.byStatus.map((x: any) => ({ s: label(x.status), v: Number(x.v), n: x.n }))} x="s" bars={[{ key: "v", label: "Value" }]} horizontal />
      </Card>
      <Card title="Enquiries by vertical"><Bars data={byV.map((x) => ({ k: x.k, v: Number(x.v), won: Number(x.won_v) }))} x="k" bars={[{ key: "v", label: "Enquiry value" }, { key: "won", label: "Won value" }]} /></Card>
      <Card title="Loss reasons">{loss.length ? <Donut data={loss.map((x) => ({ ...x, v: Number(x.v) }))} name="reason" value="v" /> : <Empty>No losses in period</Empty>}</Card>
      <Card title="Enquiries by source"><Donut data={byS.map((x) => ({ k: label(x.k), n: x.n }))} name="k" value="n" money={false} /></Card>
      <Card title="Sales leaderboard" bodyClass="p-0">
        <Table head={["Engineer", "Enquiries", "Proposals", "Won", "Lost", "Hit ratio", "Value won"]}>
          {lb.map((r) => <tr key={r.id}><td>{r.name}</td><td className="num">{r.enquiries}</td><td className="num">{r.proposals}</td><td className="num">{r.won}</td><td className="num">{r.lost}</td><td className="num">{r.won + r.lost ? pct((r.won / (r.won + r.lost)) * 100, 0) : "—"}</td><td className="num">{money(r.won_value)}</td></tr>)}
        </Table>
      </Card>
      <div className="lg:col-span-2 text-right"><Link className="link text-sm" href="/leads/stats">Full sales analytics →</Link></div>
    </div>
  );
}

function WoTable({ wos, money, compact }: { wos: any[]; money: (v: number) => string; compact?: boolean }) {
  if (!wos.length) return <Empty>No work orders</Empty>;
  return (
    <Table head={compact ? ["WO", "Customer", "Progress", "Value", "Budget vs actual", "Margin q/est", "RAG"] : ["WO", "Type", "Customer", "PM", "Progress", "Contract", "Billed", "Received", "Budget", "Actual+Commit", "Margin quoted / est.", "Next milestone", "Schedule", "Cost"]}>
      {wos.map((w) => (
        <tr key={w.id}>
          <td><Link className="link font-medium" href={`/work-orders/${w.id}`}>{w.wo_no}</Link><div className="max-w-[220px] truncate text-xs text-slate-500">{w.title}</div></td>
          {!compact && <td><Badge>{label(w.wo_type)}</Badge></td>}
          <td>{w.customer}</td>
          {!compact && <td>{w.pm ?? "—"}</td>}
          <td className="w-28"><div className="text-xs">{num(w.pct_complete)}%</div><Progress value={Number(w.pct_complete)} /></td>
          <td className="num">{money(w.contract_value)}</td>
          {compact ? <td className="num text-xs">{money(w.budget_cost)}<br /><span className={Number(w.consumed_pct) > 100 ? "text-rose-600" : "text-slate-500"}>{money(Number(w.actual_cost) + Number(w.committed_cost))} ({w.consumed_pct}%)</span></td> : <>
            <td className="num">{money(w.billed)}</td><td className="num">{money(w.received)}</td><td className="num">{money(w.budget_cost)}</td>
            <td className="num">{money(Number(w.actual_cost) + Number(w.committed_cost))}<div className="text-xs text-slate-500">{w.consumed_pct}%</div></td></>}
          <td className="num">{pct(w.quoted_margin_pct)} / <span className={Number(w.est_margin_pct) < Number(w.quoted_margin_pct) - 2 ? "text-rose-600" : ""}>{pct(w.est_margin_pct)}</span></td>
          {!compact && <td className="text-xs">{w.next_milestone ?? "—"}</td>}
          {compact ? <td><Badge status={w.cost_rag === "RED" || w.schedule_rag === "RED" ? "RED" : w.cost_rag === "AMBER" || w.schedule_rag === "AMBER" ? "AMBER" : "GREEN"} /></td>
            : <><td><Badge status={w.schedule_rag} /></td><td><Badge status={w.cost_rag} /></td></>}
        </tr>
      ))}
    </Table>
  );
}

function Portfolio({ wos, money, title, note }: { wos: any[]; money: (v: number) => string; title: string; note?: string }) {
  const tot = (k: string) => wos.reduce((a, w) => a + Number(w[k]), 0);
  const atRisk = wos.filter((w) => w.cost_rag === "RED" || w.schedule_rag === "RED");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Active" value={wos.length} /><Stat label="Contract value" value={money(tot("contract_value"))} /><Stat label="Billed" value={money(tot("billed"))} />
        <Stat label="Actual cost" value={money(tot("actual_cost"))} /><Stat label="At risk (RED)" value={atRisk.length} tone={atRisk.length ? "red" : "green"} />
      </div>
      {note && <p className="text-xs text-slate-500">{note}</p>}
      <Card title={title} bodyClass="p-0"><WoTable wos={wos} money={money} /></Card>
      {wos.length > 0 && (
        <Card title="Portfolio heat-map (cost consumed vs progress)">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {wos.map((w) => {
              const gap = Number(w.consumed_pct) - Number(w.pct_complete);
              const bg = w.cost_rag === "RED" || w.schedule_rag === "RED" ? "bg-rose-500" : w.cost_rag === "AMBER" || w.schedule_rag === "AMBER" ? "bg-amber-500" : "bg-emerald-500";
              return <Link key={w.id} href={`/work-orders/${w.id}`} className={`rounded-lg p-3 text-white ${bg}`}><div className="text-xs opacity-90">{w.wo_no}</div><div className="truncate text-sm font-semibold">{w.customer}</div><div className="text-xs">{gap > 0 ? "+" : ""}{gap.toFixed(0)} pts cost vs progress</div></Link>;
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

async function Manufacturing({ range, money, wos }: any) {
  const [fac, hours, workers] = await Promise.all([
    adminVsBudget("FACTORY_ADMIN", range),
    q(`select w.wo_no, coalesce(sum(dl.hours),0) hours, coalesce(sum(ce.amount),0) cost from dwr_line dl join dwr d on d.id=dl.dwr_id join work_order w on w.id=dl.wo_id
       join employee e on e.id=d.employee_id join location l on l.id=e.location_id left join cost_entry ce on ce.source_type='DWR' and ce.source_id=dl.id
       where l.kind='FACTORY' and d.report_date between $1 and $2 group by 1 order by 2 desc`, [range.from, range.to]),
    one(`select count(*)::int n from employee e join location l on l.id=e.location_id where l.kind='FACTORY' and e.is_active`),
  ]);
  const actual = fac.reduce((a, x) => a + Number(x.actual), 0), budget = fac.reduce((a, x) => a + Number(x.budget), 0);
  const fabCost = wos.reduce((a: number, w: any) => a + Number(w.actual_cost), 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="WOs with Markal scope" value={wos.length} /><Stat label="Factory headcount" value={workers?.n ?? 0} />
        <Stat label="Labour hours booked" value={num(hours.reduce((a, x) => a + Number(x.hours), 0))} sub="from DWRs" />
        <Stat label="Production cost (actual)" value={money(fabCost)} />
        <Stat label="Factory admin vs budget" value={money(actual)} sub={`budget ${money(budget)}`} tone={actual > budget ? "red" : "green"} />
      </div>
      <p className="text-xs text-slate-500">Job orders, routing, stage-wise production, scrap/rework and machine maintenance arrive with the Markal module (Phase 2). Figures below come from the WO cost ledger, DWR labour hours and factory admin expenses.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Factory admin expenses vs budget"><Bars data={fac.map((x) => ({ h: label(x.head), actual: Number(x.actual), budget: Number(x.budget) }))} x="h" bars={[{ key: "budget", label: "Budget", color: "#cbd5e1" }, { key: "actual", label: "Actual" }]} horizontal height={300} /></Card>
        <Card title="Factory labour hours by WO" bodyClass="p-0"><Table head={["WO", "Hours", "Labour cost"]}>{hours.map((h) => <tr key={h.wo_no}><td>{h.wo_no}</td><td className="num">{num(h.hours, 1)}</td><td className="num">{money(h.cost)}</td></tr>)}</Table></Card>
      </div>
      <Card title="Production cost vs budget (WOs with fabrication)" bodyClass="p-0"><WoTable wos={wos} money={money} compact /></Card>
    </div>
  );
}

async function Purchase({ money }: any) {
  const [byStatus, top, pending] = await Promise.all([
    q(`select status, count(*)::int n, coalesce(sum(total),0) v from purchase_order group by 1`),
    q(`select v.name, count(*)::int n, coalesce(sum(po.total),0) v from purchase_order po join vendor v on v.id=po.vendor_id where po.status not in ('DRAFT','CANCELLED') group by 1 order by 3 desc limit 5`),
    q(`select po.id, po.po_no, po.total, v.name vendor, w.wo_no from purchase_order po left join vendor v on v.id=po.vendor_id join work_order w on w.id=po.wo_id where po.status in ('DRAFT','PENDING_APPROVAL') order by po.total desc`),
  ]);
  const s = (k: string) => byStatus.find((x) => x.status === k) ?? { n: 0, v: 0 };
  const issued = byStatus.filter((x) => !["DRAFT", "PENDING_APPROVAL", "CANCELLED"].includes(x.status));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="POs issued" value={money(issued.reduce((a, x) => a + Number(x.v), 0))} sub={`${issued.reduce((a, x) => a + x.n, 0)} POs`} href="/purchase" />
        <Stat label="Pending approval" value={s("PENDING_APPROVAL").n} sub={money(s("PENDING_APPROVAL").v)} tone="amber" href="/approvals" />
        <Stat label="Auto-drafted (to review)" value={s("DRAFT").n} sub={money(s("DRAFT").v)} href="/purchase?status=DRAFT" />
        <Stat label="Received" value={s("RECEIVED").n} sub={money(s("RECEIVED").v)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Top vendors" bodyClass="p-0"><Table head={["Vendor", "POs", "Value"]}>{top.map((t) => <tr key={t.name}><td>{t.name}</td><td className="num">{t.n}</td><td className="num">{money(t.v)}</td></tr>)}</Table></Card>
        <Card title="Draft / pending POs" bodyClass="p-0"><Table head={["PO", "WO", "Vendor", "Value"]}>{pending.map((p) => <tr key={p.id}><td><Link className="link" href={`/purchase/${p.id}`}>{p.po_no}</Link></td><td>{p.wo_no}</td><td>{p.vendor ?? "—"}</td><td className="num">{money(p.total)}</td></tr>)}</Table></Card>
      </div>
    </div>
  );
}

async function HrAdmin({ range, money }: any) {
  const [snap, att, office, leaves] = await Promise.all([hrSnapshot(todayIST()), attendanceRange(range), adminVsBudget("OFFICE_ADMIN", range),
    q(`select leave_type, count(*)::int n, coalesce(sum(days),0) d from leave_request where status='APPROVED' and from_date between $1 and $2 group by 1`, [range.from, range.to])]);
  const payroll = await one(`select coalesce(sum(monthly_ctc),0) v from employee where is_active`);
  const attPct = att?.working ? (att.present / att.working) * 100 : 0;
  const oa = office.reduce((a, x) => a + Number(x.actual), 0), ob = office.reduce((a, x) => a + Number(x.budget), 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Headcount" value={snap.total} /><Stat label="Present today" value={snap.att.present} sub={`${snap.att.absent} absent · ${snap.att.leave} leave`} href="/attendance" />
        <Stat label="Attendance % (period)" value={pct(attPct)} tone={attPct < 90 ? "amber" : "green"} /><Stat label="Late marks" value={att?.late ?? 0} />
        <Stat label="OT hours / cost" value={num(att?.ot, 1)} sub={money(att?.ot_cost ?? 0)} /><Stat label="Monthly payroll (CTC)" value={money(payroll?.v)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Headcount by location"><Donut data={snap.head} name="loc" value="n" money={false} /></Card>
        <Card title="Headcount by department"><Bars data={snap.byDept} x="dept" bars={[{ key: "n", label: "Employees" }]} horizontal money={false} height={260} /></Card>
        <Card title="Leave taken (period)" bodyClass="p-0"><Table head={["Type", "Requests", "Days"]}>{leaves.map((l) => <tr key={l.leave_type}><td>{l.leave_type}</td><td className="num">{l.n}</td><td className="num">{l.d}</td></tr>)}</Table>{!leaves.length && <Empty>No approved leave</Empty>}</Card>
      </div>
      <Card title={<>Office admin expenses vs budget — <span className={oa > ob ? "text-rose-600" : "text-emerald-600"}>{money(oa)} of {money(ob)}</span></>}>
        <Bars data={office.map((x) => ({ h: label(x.head), actual: Number(x.actual), budget: Number(x.budget) }))} x="h" bars={[{ key: "budget", label: "Budget", color: "#cbd5e1" }, { key: "actual", label: "Actual" }]} height={280} />
      </Card>
      <p className="text-xs text-slate-500">Attrition, open positions and payroll register arrive with HR payroll (Phase 3).</p>
    </div>
  );
}

async function Finance({ range, fin, money }: any) {
  const fy = fyStartYear(new Date(range.from));
  const [trend, vert] = await Promise.all([monthlyTrend(`${fy}-04-01`, `${fy + 1}-03-01`),
    q(`select v.name, coalesce(sum(p.contract_value),0) contract, coalesce(sum(p.billed),0) billed, coalesce(sum(p.actual_cost),0) cost, coalesce(sum(p.contract_value - p.eac),0) margin
       from v_wo_pnl p join vertical v on v.id=p.vertical_id group by 1 order by 2 desc`)]);
  const direct = fin.projectCost, oh = fin.officeAdmin + fin.factoryAdmin;
  const gm = fin.revenue - direct;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Revenue" value={money(fin.revenue)} /><Stat label="Project direct cost" value={money(direct)} />
        <Stat label="Gross margin" value={money(gm)} sub={fin.revenue ? pct((gm / fin.revenue) * 100) : ""} tone={gm < 0 ? "red" : "green"} />
        <Stat label="Office admin" value={money(fin.officeAdmin)} /><Stat label="Factory admin" value={money(fin.factoryAdmin)} />
        <Stat label="EBITDA (approx.)" value={money(gm - oh)} tone={gm - oh < 0 ? "red" : "green"} sub="before payroll & depreciation" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Revenue vs cost by month" className="lg:col-span-2"><Trend data={trend.map((t) => ({ ...t, margin: Number(t.revenue) - Number(t.project_cost) }))} x="label" lines={[{ key: "revenue", label: "Revenue" }, { key: "margin", label: "Gross margin", color: "#2a9d8f" }]} bars={[{ key: "project_cost", label: "Project direct" }, { key: "office_admin", label: "Office admin" }, { key: "factory_admin", label: "Factory admin" }]} /></Card>
        <Card title="Overheads split (period)"><Donut data={[{ k: "Project direct", v: direct }, { k: "Office admin", v: fin.officeAdmin }, { k: "Factory admin", v: fin.factoryAdmin }]} name="k" value="v" /></Card>
        <Card title="Receivable ageing"><Bars data={Object.entries(fin.ageing).map(([k, v]) => ({ k, v }))} x="k" bars={[{ key: "v", label: "Outstanding" }]} /></Card>
        <Card title="Top debtors" bodyClass="p-0"><Table head={["Customer", "Outstanding"]}>{fin.topDebtors.map((d: any) => <tr key={d.customer}><td>{d.customer}</td><td className="num">{money(d.due)}</td></tr>)}</Table></Card>
        <Card title="Vertical-wise contribution (all WOs)" bodyClass="p-0"><Table head={["Vertical", "Contract", "Billed", "Est. margin"]}>{vert.map((v) => <tr key={v.name}><td>{v.name}</td><td className="num">{money(v.contract)}</td><td className="num">{money(v.billed)}</td><td className="num">{money(v.margin)}</td></tr>)}</Table></Card>
      </div>
      <p className="text-xs text-slate-500">Cash/bank balance, BG/EMD exposure, cash-flow & fund-flow statements and Tally sync arrive with Finance (Phase 3).</p>
    </div>
  );
}
