import Link from "next/link";
import { requirePage, can } from "@/lib/auth";
import { q, one } from "@/lib/db";
import { dt, num, label } from "@/lib/format";
import { todayIST } from "@/lib/hr";
import { PageHeader, Card, Table, Badge, Stat, Tabs, Empty } from "@/components/ui";
import { Bars } from "@/components/charts";
import { ActionForm } from "@/components/ActionForm";
import { siteIdsFor, omDashboard, CHEMICALS, TICKET_CATEGORIES, seesAllSites } from "@/lib/om";
import { omLogAction, omSpareAction, omRequisitionAction, omRequisitionDecideAction, omTicketAction, omTicketUpdateAction, omVisitAction, omSubmitReportAction } from "@/app/actions/icom";

export const metadata = { title: "O&M Operations" };
type SP = { tab?: string; site?: string; date?: string; status?: string; source?: string; period?: string };

export default async function OmPage({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await requirePage("field_services");
  const sp = await searchParams;
  const ids = await siteIdsFor(u);
  const sites = await q(`select s.id, s.code, s.name, s.required_manpower, s.client_email, c.name customer from om_site s join customer c on c.id=s.customer_id where s.is_active and ($1::uuid[] is null or s.id = any($1)) order by s.name`, [ids]);
  const all = seesAllSites(u);
  const manager = !!can(u, "field_services", "approve") || ["MD", "SUPER_ADMIN"].includes(u.roleCode);
  const tab = sp.tab ?? (all ? "dashboard" : "log");
  const siteId = sites.find((s) => s.id === sp.site)?.id ?? sites[0]?.id;
  const tabs = [...(all || sites.length > 1 ? [{ key: "dashboard", label: "Dashboard" }] : []), { key: "log", label: "Daily report" }, { key: "tickets", label: "Tickets" }, { key: "spares", label: "Spare register" }, { key: "requisitions", label: "Material & service requisitions" }, { key: "reports", label: "Monthly & visit reports" }];
  const base = siteId ? `/om?site=${siteId}` : "/om";
  if (!sites.length) return (<div><PageHeader title="O&M Operations" /><Card><Empty>You are not assigned to an O&M site yet. Ask your O&M supervisor to add you to a site.</Empty></Card></div>);
  return (
    <div>
      <PageHeader title="O&M Operations" subtitle={all ? "All O&M sites: daily operator reports, manpower, plant status, tickets, spares, requisitions and client reports" : "Your site: daily report, tickets, spares, requisitions and client reports"} />
      <Tabs tabs={tabs} active={tab} base={base} />
      {tab !== "dashboard" && sites.length > 1 && (
        <form className="mb-4 flex flex-wrap items-center gap-2" action="/om"><input type="hidden" name="tab" value={tab} />
          <label className="text-sm text-slate-500" htmlFor="om-site">Site</label>
          <select id="om-site" name="site" defaultValue={siteId} className="input w-auto">{sites.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.customer}</option>)}</select>
          <button className="btn-secondary btn-sm">Show</button></form>
      )}
      {tab === "dashboard" && <Dashboard ids={ids} />}
      {tab === "log" && siteId && <DailyLog siteId={siteId} date={sp.date ?? todayIST()} />}
      {tab === "tickets" && <Tickets siteId={siteId} ids={ids} sp={sp} manager={manager} />}
      {tab === "spares" && siteId && <Spares siteId={siteId} />}
      {tab === "requisitions" && <Requisitions siteId={siteId} ids={ids} manager={manager} />}
      {tab === "reports" && siteId && <Reports site={sites.find((s) => s.id === siteId)!} period={sp.period} />}
    </div>
  );
}

async function Dashboard({ ids }: { ids: string[] | null }) {
  const today = todayIST();
  const d = await omDashboard(ids, today);
  const [byOperator, trend] = await Promise.all([
    q(`select case when t.source='CLIENT' then c.name else coalesce(e.name, '—') end who, t.source, count(*)::int n, count(*) filter (where t.status in ('OPEN','IN_PROGRESS'))::int open
        from om_ticket t left join employee e on e.id=t.raised_by join om_site s on s.id=t.site_id join customer c on c.id=s.customer_id
        where ($1::uuid[] is null or t.site_id = any($1)) group by 1,2 order by 2, n desc limit 16`, [ids]),
    q(`select to_char(log_date, 'DD Mon') k, sum(water_treated_m3) water, sum(energy_kwh) energy from om_daily_log where log_date > $2::date - 14 and ($1::uuid[] is null or site_id = any($1)) group by log_date, 1 order by log_date`, [ids, today]),
  ]);
  const t = d.totals;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Total sites" value={t.sites} />
        <Stat label="Present manpower" value={`${t.present} / ${t.required}`} sub="today, as reported by operators" tone={t.present < t.required ? "amber" : "green"} />
        <Stat label="Sites with manpower issues" value={t.manpowerIssues} sub={t.notLogged ? `${t.notLogged} not reported yet` : "short of required"} tone={t.manpowerIssues ? "red" : "green"} />
        <Stat label="Sites with operation issues" value={t.operationIssues} tone={t.operationIssues ? "red" : "green"} />
        <Stat label="Open tickets" value={d.tickets.open} sub={`${d.tickets.open_client} from clients`} tone={d.tickets.open ? "amber" : undefined} href="/om?tab=tickets&status=OPEN" />
        <Stat label="Closed tickets" value={d.tickets.closed} tone="green" href="/om?tab=tickets&status=CLOSED" />
        <Stat label="Tickets by operator" value={d.tickets.by_operator} href="/om?tab=tickets&source=OPERATOR" />
        <Stat label="Tickets by client" value={d.tickets.by_client} href="/om?tab=tickets&source=CLIENT" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="Water treated today" value={`${num(t.waterToday)} m³`} />
        <Stat label="Water treated this month" value={`${num(t.waterMonth)} m³`} />
        <Stat label="Energy this month" value={`${num(t.energyMonth)} kWh`} sub={t.waterMonth ? `${num(t.energyMonth / t.waterMonth, 2)} kWh/m³` : undefined} />
      </div>
      <Card title={`Sites today · ${dt(today)}`} bodyClass="p-0">
        <Table head={["Site", "Client", "Plant", "Manpower", "Plant status", "Water today", "This month", "Open tickets", "Low spares", "Flags"]}>
          {d.rows.map((s) => (
            <tr key={s.id}>
              <td><Link className="link font-medium" href={`/om?tab=log&site=${s.id}`}>{s.name}</Link><div className="text-[11px] text-slate-500">{s.code} · {s.supervisor ?? "no supervisor"}</div></td>
              <td>{s.customer}</td><td className="text-xs">{s.plant_type}{s.capacity_kld && ` · ${num(s.capacity_kld)} KLD`}</td>
              <td className={`num ${s.manpowerIssue ? "text-rose-600 font-semibold" : ""}`}>{s.log_id ? `${s.present_count} / ${s.required_manpower}` : `— / ${s.required_manpower}`}</td>
              <td>{s.log_id ? <Badge status={s.operation_status}>{label(s.operation_status)}</Badge> : <Badge tone="gray">Not reported</Badge>}{s.issue_note && <div className="max-w-[200px] truncate text-[11px] text-amber-700">{s.issue_note}</div>}</td>
              <td className="num">{s.log_id ? `${num(s.water_treated_m3)} m³` : "—"}</td><td className="num">{num(s.water_month)} m³</td>
              <td className="num">{s.open_tickets ? <Link className="link" href={`/om?tab=tickets&site=${s.id}&status=OPEN`}>{s.open_tickets}</Link> : 0}</td>
              <td className="num">{s.low_spares ? <span className="text-amber-700">{s.low_spares}</span> : 0}</td>
              <td className="space-x-1">{s.manpowerIssue && <Badge tone="red">Manpower</Badge>}{s.operationIssue && <Badge tone="amber">Operation</Badge>}{!s.manpowerIssue && !s.operationIssue && <Badge tone="green">OK</Badge>}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Water treated — last 14 days (m³)">{trend.length ? <Bars data={trend.map((x) => ({ ...x, water: Number(x.water) }))} x="k" bars={[{ key: "water", label: "Water treated" }]} height={220} money={false} /> : <Empty>No logs yet</Empty>}</Card>
        <Card title="Tickets by operator / client" bodyClass="p-0">
          <Table head={["Operator / client", "Source", "Tickets", "Open"]}>{byOperator.map((r, i) => <tr key={i}><td>{r.who}</td><td><Badge tone={r.source === "CLIENT" ? "purple" : "blue"}>{label(r.source)}</Badge></td><td className="num">{r.n}</td><td className="num">{r.open}</td></tr>)}</Table>
        </Card>
      </div>
    </div>
  );
}

async function DailyLog({ siteId, date }: { siteId: string; date: string }) {
  const [site, staff, log, recent] = await Promise.all([
    one(`select s.*, c.name customer from om_site s join customer c on c.id=s.customer_id where s.id=$1`, [siteId]),
    q(`select e.id, e.name, st.duty, a.status att from om_site_staff st join employee e on e.id=st.employee_id left join attendance a on a.employee_id=e.id and a.att_date=$2 where st.site_id=$1 order by st.duty desc, e.name`, [siteId, date]),
    one(`select l.*, (select json_agg(c order by c.chemical) from om_chemical_use c where c.log_id=l.id) chems from om_daily_log l where site_id=$1 and log_date=$2`, [siteId, date]),
    q(`select l.*, e.name operator, (select string_agg(c.chemical || ' ' || rtrim(rtrim(c.qty::text,'0'),'.') || ' ' || c.uom, ', ') from om_chemical_use c where c.log_id=l.id) chems
        from om_daily_log l left join employee e on e.id=l.operator_id where site_id=$1 order by log_date desc limit 14`, [siteId]),
  ]);
  const chems: any[] = log?.chems ?? [];
  const present = new Set<string>(log?.present_ids ?? staff.filter((s) => ["P", "HD", "OD"].includes(s.att)).map((s) => s.id));
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_480px]">
      <Card title={<>Daily report · {site.name} <span className="text-xs font-normal text-slate-500">{site.plant_type}{site.capacity_kld && ` · ${num(site.capacity_kld)} KLD`} · {log ? "saved — you can correct it" : "not yet reported"}</span></>}>
        <form className="mb-3 flex items-center gap-2" action="/om"><input type="hidden" name="tab" value="log" /><input type="hidden" name="site" value={siteId} />
          <input type="date" name="date" defaultValue={date} className="input w-44" aria-label="Report date" /><button className="btn-secondary btn-sm">Open date</button></form>
        <ActionForm action={omLogAction} submitLabel="Submit daily report" className="space-y-4">
          <input type="hidden" name="site_id" value={siteId} /><input type="hidden" name="date" value={date} />
          <fieldset><legend className="label">Present today ({site.required_manpower} required)</legend>
            <div className="grid gap-1 sm:grid-cols-2">{staff.map((s) => <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="present" value={s.id} defaultChecked={present.has(s.id)} />{s.name} <span className="text-xs text-slate-500">{label(s.duty)}</span></label>)}</div>
          </fieldset>
          <div className="grid gap-2 sm:grid-cols-3">
            <label><span className="label">Water treated (m³)</span><input name="water" required inputMode="decimal" defaultValue={log?.water_treated_m3 ?? ""} className="input" /></label>
            <label><span className="label">Energy consumed (kWh)</span><input name="energy" required inputMode="decimal" defaultValue={log?.energy_kwh ?? ""} className="input" /></label>
            <label><span className="label">Plant status</span><select name="status" defaultValue={log?.operation_status ?? "NORMAL"} className="input"><option value="NORMAL">Normal</option><option value="ISSUE">Running with issue</option><option value="SHUTDOWN">Shutdown</option></select></label>
          </div>
          <input name="issue_note" defaultValue={log?.issue_note ?? ""} placeholder="Operation issue (required if not normal) — a ticket is raised automatically" className="input" />
          <fieldset><legend className="label">Chemical consumption</legend>
            <datalist id="chem-list">{CHEMICALS.map((c) => <option key={c} value={c} />)}</datalist>
            <div className="space-y-1">{[0, 1, 2, 3].map((i) => <div key={i} className="grid grid-cols-[minmax(0,1fr)_100px_80px] gap-2">
              <input name="chemical" list="chem-list" defaultValue={chems[i]?.chemical ?? ""} placeholder={i === 0 ? "e.g. Sodium hypochlorite" : ""} className="input py-1" />
              <input name="chem_qty" inputMode="decimal" defaultValue={chems[i]?.qty ?? ""} placeholder="Qty" className="input py-1" />
              <select name="chem_uom" defaultValue={chems[i]?.uom ?? "KG"} className="input py-1"><option>KG</option><option>L</option><option>NOS</option></select></div>)}</div>
          </fieldset>
          <fieldset><legend className="label">Water quality (optional)</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{[["inlet_ph", "Inlet pH"], ["outlet_ph", "Outlet pH"], ["outlet_tss", "Outlet TSS"], ["outlet_bod", "Outlet BOD"], ["outlet_cod", "Outlet COD"]].map(([n, l]) =>
              <label key={n}><span className="text-[11px] text-slate-500">{l}</span><input name={n} inputMode="decimal" defaultValue={log?.[n] ?? ""} placeholder={l} className="input py-1" /></label>)}</div>
          </fieldset>
          <input name="remarks" defaultValue={log?.remarks ?? ""} placeholder="Remarks" className="input" />
        </ActionForm>
      </Card>
      <Card title="Last 14 days" bodyClass="p-0">
        {recent.length ? <Table head={["Date", "Staff", "Water m³", "kWh", "Status"]}>
          {recent.map((l) => <tr key={l.id}><td><Link className="link" href={`/om?tab=log&site=${siteId}&date=${new Date(l.log_date).toISOString().slice(0, 10)}`}>{dt(l.log_date)}</Link><div className="max-w-[130px] truncate text-[11px] text-slate-500" title={l.chems ?? ""}>{l.chems ?? "no chemicals"}</div></td>
            <td className={`num ${l.present_count < site.required_manpower ? "text-rose-600" : ""}`}>{l.present_count}/{site.required_manpower}</td><td className="num">{num(l.water_treated_m3)}</td><td className="num">{num(l.energy_kwh)}</td><td><Badge status={l.operation_status}>{label(l.operation_status)}</Badge></td></tr>)}
        </Table> : <Empty>No reports yet</Empty>}
      </Card>
    </div>
  );
}

async function Tickets({ siteId, ids, sp, manager }: { siteId?: string; ids: string[] | null; sp: SP; manager: boolean }) {
  const rows = await q(`select t.*, s.name site, e.name raised_name, a.name assigned_name from om_ticket t join om_site s on s.id=t.site_id left join employee e on e.id=t.raised_by left join employee a on a.id=t.assigned_to
      where ($1::uuid[] is null or t.site_id = any($1)) and ($2::uuid is null or t.site_id=$2) and ($3::text is null or (case when $3='OPEN' then t.status in ('OPEN','IN_PROGRESS') when $3='CLOSED' then t.status in ('RESOLVED','CLOSED') else true end)) and ($4::text is null or t.source=$4)
      order by case t.status when 'OPEN' then 0 when 'IN_PROGRESS' then 1 when 'RESOLVED' then 2 else 3 end, t.created_at desc limit 100`, [ids, sp.site ?? null, sp.status ?? null, sp.source ?? null]);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2 text-sm">{[["", "", "All"], ["OPEN", "", "Open"], ["CLOSED", "", "Resolved / closed"], ["", "OPERATOR", "By operator"], ["", "CLIENT", "By client"]].map(([st, so, l]) => {
          const active = (sp.status ?? "") === st && (sp.source ?? "") === so;
          return <Link key={l} href={`/om?tab=tickets${sp.site ? `&site=${sp.site}` : ""}${st ? `&status=${st}` : ""}${so ? `&source=${so}` : ""}`} className={`rounded-full border px-3 py-1 ${active ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600"}`}>{l}</Link>;
        })}</div>
        {rows.length ? rows.map((t) => (
          <div key={t.id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><b className="font-display">{t.ticket_no}</b> <span className="text-sm text-slate-500">· {t.site}</span>
                <div className="text-sm font-medium">{t.title}</div>{t.description && <div className="text-sm text-slate-600 dark:text-slate-300">{t.description}</div>}
                <div className="mt-1 text-xs text-slate-500">{t.source === "CLIENT" ? `Client: ${t.client_name} (logged by ${t.raised_name})` : `Operator: ${t.raised_name}`} · {dt(t.created_at)} · {label(t.category)}{t.assigned_name && ` · with ${t.assigned_name}`}</div></div>
              <div className="flex flex-col items-end gap-1"><Badge status={t.status}>{label(t.status)}</Badge><Badge status={t.priority}>{label(t.priority)}</Badge></div>
            </div>
            {t.resolution && <div className="mt-2 rounded-md bg-slate-50 p-2 text-sm dark:bg-slate-800/50"><b>Resolution:</b> {t.resolution}{t.resolved_at && <span className="text-xs text-slate-500"> · {dt(t.resolved_at)}</span>}</div>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {t.resolution && <a className="btn-secondary btn-sm" href={`/api/om/doc?kind=ticket&id=${t.id}`}>Download resolution (Word)</a>}
              {t.status !== "CLOSED" && (
                <ActionForm action={omTicketUpdateAction} hideSubmit className="flex flex-1 flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={t.id} />
                  <input name="resolution" defaultValue="" placeholder={t.resolution ? "Add to / replace resolution" : "Resolution / action taken"} className="input min-w-[200px] flex-1 py-1" />
                  <select name="status" defaultValue={t.status === "OPEN" ? "IN_PROGRESS" : t.status === "IN_PROGRESS" ? "RESOLVED" : "CLOSED"} className="input w-36 py-1">
                    <option value="IN_PROGRESS">In progress</option><option value="RESOLVED">Resolved</option>{(manager || t.source === "OPERATOR") && <option value="CLOSED">Closed</option>}</select>
                  <button className="btn-primary btn-sm">Update</button>
                </ActionForm>
              )}
            </div>
          </div>
        )) : <Card><Empty>No tickets</Empty></Card>}
      </div>
      {siteId && (
        <Card title="Raise a ticket">
          <ActionForm action={omTicketAction} reset submitLabel="Raise ticket" className="space-y-2">
            <input type="hidden" name="site_id" value={siteId} />
            <div className="grid grid-cols-2 gap-2">
              <label><span className="label">Raised by</span><select name="source" className="input"><option value="OPERATOR">Operator</option><option value="CLIENT">Client complaint</option></select></label>
              <label><span className="label">Priority</span><select name="priority" defaultValue="MEDIUM" className="input">{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((p) => <option key={p} value={p}>{label(p)}</option>)}</select></label>
            </div>
            <input name="client_name" placeholder="Client person (for client complaints)" className="input" />
            <select name="category" className="input" aria-label="Category">{TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select>
            <input name="title" required placeholder="Issue in one line" className="input" />
            <textarea name="description" rows={3} placeholder="Details" className="input" />
            <label className="block text-sm"><span className="label">Photos</span><input type="file" name="photos" multiple accept="image/*" className="text-xs" /></label>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}

async function Spares({ siteId }: { siteId: string }) {
  const [spares, txns] = await Promise.all([
    q(`select * from om_spare where site_id=$1 order by (qty <= min_qty) desc, name`, [siteId]),
    q(`select t.*, sp.name, sp.uom, e.name by_name from om_spare_txn t join om_spare sp on sp.id=t.spare_id left join employee e on e.id=t.created_by where sp.site_id=$1 order by t.created_at desc limit 15`, [siteId]),
  ]);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card title="Spare register" bodyClass="p-0">
        {spares.length ? <Table head={["Spare", "Part no.", "In stock", "Minimum", "Receive / use"]}>
          {spares.map((s) => <tr key={s.id}><td className="font-medium">{s.name}{Number(s.qty) <= Number(s.min_qty) && <Badge tone="amber">Low</Badge>}</td><td className="text-xs">{s.part_no ?? "—"}</td>
            <td className="num font-medium">{num(s.qty)} {s.uom}</td><td className="num">{num(s.min_qty)}</td>
            <td><ActionForm action={omSpareAction} hideSubmit className="flex gap-1"><input type="hidden" name="spare_id" value={s.id} />
              <select name="kind" className="input w-20 py-1 text-xs"><option value="OUT">Use</option><option value="IN">Receive</option></select>
              <input name="qty" inputMode="decimal" placeholder="Qty" className="input w-16 py-1 text-xs" /><input name="note" placeholder="Where used / from" className="input w-40 py-1 text-xs" /><button className="btn-secondary btn-sm">Save</button></ActionForm></td></tr>)}
        </Table> : <Empty>No spares registered</Empty>}
      </Card>
      <div className="space-y-4">
        <Card title="Add spare">
          <ActionForm action={omSpareAction} reset submitLabel="Add" className="space-y-2"><input type="hidden" name="site_id" value={siteId} />
            <input name="name" required placeholder="Spare (e.g. Diffuser membrane 9 in)" className="input" />
            <div className="grid grid-cols-2 gap-2"><input name="part_no" placeholder="Part no." className="input" /><input name="uom" defaultValue="NOS" className="input" aria-label="UoM" /><input name="qty" inputMode="decimal" placeholder="Opening qty" className="input" /><input name="min_qty" inputMode="decimal" placeholder="Minimum qty" className="input" /></div>
          </ActionForm>
        </Card>
        <Card title="Recent movements" bodyClass="p-0">
          {txns.length ? <Table head={["Date", "Spare", "Qty", "Note"]}>{txns.map((t) => <tr key={t.id}><td className="text-xs">{dt(t.txn_date)}</td><td className="text-xs">{t.name}</td><td className={`num ${t.kind === "OUT" ? "text-rose-600" : "text-brand-700"}`}>{t.kind === "OUT" ? "−" : "+"}{num(t.qty)} {t.uom}</td><td className="text-xs">{t.note}</td></tr>)}</Table> : <Empty>No movements</Empty>}
        </Card>
      </div>
    </div>
  );
}

async function Requisitions({ siteId, ids, manager }: { siteId?: string; ids: string[] | null; manager: boolean }) {
  const rows = await q(`select r.*, s.name site, e.name by_name, d.name decided_name from om_requisition r join om_site s on s.id=r.site_id left join employee e on e.id=r.raised_by left join employee d on d.id=r.decided_by
      where ($1::uuid[] is null or r.site_id = any($1)) order by case r.status when 'PENDING' then 0 when 'APPROVED' then 1 else 2 end, r.created_at desc limit 60`, [ids]);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card title="Requisitions" bodyClass="p-0">
        {rows.length ? <Table head={["Requisition", "Site", "Type", "Items / service", "Reason", "Status", ...(manager ? ["Decision"] : [])]}>
          {rows.map((r) => <tr key={r.id}><td className="font-medium">{r.req_no}<div className="text-[11px] text-slate-500">{dt(r.created_at)} · {r.by_name}</div></td><td className="text-xs">{r.site}</td><td><Badge tone={r.kind === "SERVICE" ? "purple" : "blue"}>{label(r.kind)}</Badge></td>
            <td className="max-w-[240px] text-xs">{(r.lines ?? []).map((l: any) => `${l.description}${l.qty ? ` × ${l.qty} ${l.uom}` : ""}`).join(", ")}</td><td className="max-w-[200px] text-xs">{r.reason}</td>
            <td><Badge status={r.status}>{label(r.status)}</Badge>{r.decided_name && <div className="text-[11px] text-slate-500">{r.decided_name}{r.decision_note && ` · ${r.decision_note}`}</div>}</td>
            {manager && <td>{["PENDING", "APPROVED"].includes(r.status) && <ActionForm action={omRequisitionDecideAction} hideSubmit className="flex flex-wrap gap-1"><input type="hidden" name="id" value={r.id} />
              <input name="note" placeholder="Note" className="input w-28 py-1 text-xs" />
              {r.status === "PENDING" ? <><button name="status" value="APPROVED" className="btn-primary btn-sm">Approve</button><button name="status" value="REJECTED" className="btn-danger btn-sm">Reject</button></> : <button name="status" value="FULFILLED" className="btn-secondary btn-sm">Mark fulfilled</button>}</ActionForm>}</td>}</tr>)}
        </Table> : <Empty>No requisitions</Empty>}
      </Card>
      {siteId && (
        <Card title="New requisition">
          <ActionForm action={omRequisitionAction} reset submitLabel="Send to supervisor" className="space-y-2"><input type="hidden" name="site_id" value={siteId} />
            <select name="kind" className="input" aria-label="Type"><option value="MATERIAL">Material (chemicals, spares, consumables)</option><option value="SERVICE">Service (repair, calibration, cleaning, lab test)</option></select>
            {[0, 1, 2].map((i) => <div key={i} className="grid grid-cols-[minmax(0,1fr)_70px_70px] gap-2"><input name="description" required={i === 0} placeholder={i === 0 ? "Item or service" : ""} className="input py-1" /><input name="qty" inputMode="decimal" placeholder="Qty" className="input py-1" /><input name="uom" defaultValue="NOS" className="input py-1" aria-label="UoM" /></div>)}
            <input name="reason" required placeholder="Reason" className="input" />
          </ActionForm>
        </Card>
      )}
    </div>
  );
}

async function Reports({ site, period }: { site: any; period?: string }) {
  const now = new Date(Date.now() + 330 * 60000);
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const p = period && months.includes(period) ? period : months[0];
  const [submitted, visits] = await Promise.all([
    q(`select r.*, e.name by_name from om_report r left join employee e on e.id=r.submitted_by where r.site_id=$1 and r.kind='MONTHLY' order by r.submitted_at desc limit 12`, [site.id]),
    q(`select r.*, e.name visitor from om_report r left join employee e on e.id=r.visited_by where r.site_id=$1 and r.kind='VISIT' order by r.visit_date desc limit 12`, [site.id]),
  ]);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title={`Monthly O&M report · ${site.name}`}>
        <form className="mb-3 flex flex-wrap items-center gap-2" action="/om"><input type="hidden" name="tab" value="reports" /><input type="hidden" name="site" value={site.id} />
          <select name="period" defaultValue={p} className="input w-auto" aria-label="Month">{months.map((m) => <option key={m} value={m}>{new Date(`${m}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</option>)}</select>
          <button className="btn-secondary btn-sm">Select</button>
          <a className="btn-primary btn-sm" href={`/api/om/doc?kind=monthly&site=${site.id}&period=${p}`}>Download report (Word)</a></form>
        <p className="mb-3 text-xs text-slate-500">Built from the daily reports: water treated, capacity use, energy per m³, water quality, chemicals, tickets with resolutions, spares and requisitions.</p>
        <ActionForm action={omSubmitReportAction} submitLabel="Submit to client by email" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="site_id" value={site.id} /><input type="hidden" name="kind" value="MONTHLY" /><input type="hidden" name="period" value={p} />
          <input name="to" type="email" required defaultValue={site.client_email ?? ""} placeholder="Client email" className="input w-64" />
        </ActionForm>
        <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Submitted</div>
        {submitted.length ? <ul className="mt-1 space-y-1 text-sm">{submitted.map((r) => <li key={r.id} className="flex justify-between"><span>{r.period} → {r.submitted_to}</span><span className="text-xs text-slate-500">{dt(r.submitted_at)} · {r.by_name}{r.attachment_id && <> · <a className="link" href={`/api/files/${r.attachment_id}`}>copy</a></>}</span></li>)}</ul> : <p className="text-sm text-slate-500">None yet</p>}
      </Card>
      <Card title="Site visit reports">
        <ActionForm action={omVisitAction} reset submitLabel="Save visit report" className="mb-4 space-y-2"><input type="hidden" name="site_id" value={site.id} />
          <input type="date" name="date" required defaultValue={now.toISOString().slice(0, 10)} className="input w-44" aria-label="Visit date" />
          <textarea name="observations" required rows={3} placeholder="Observations (plant condition, housekeeping, logbooks, equipment, water quality)" className="input" />
          <textarea name="recommendations" rows={2} placeholder="Recommendations" className="input" />
          <label className="block text-sm"><span className="label">Photos</span><input type="file" name="photos" multiple accept="image/*" className="text-xs" /></label>
        </ActionForm>
        {visits.length ? <div className="space-y-2">{visits.map((v) => (
          <div key={v.id} className="rounded-md border border-slate-200 p-2 text-sm dark:border-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-2"><b>{dt(v.visit_date)} · {v.visitor}</b>{v.submitted_at ? <Badge tone="green">Submitted {dt(v.submitted_at)}</Badge> : <Badge tone="amber">Not submitted</Badge>}</div>
            <div className="text-xs text-slate-600 dark:text-slate-300">{v.observations}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2"><a className="btn-secondary btn-sm" href={`/api/om/doc?kind=visit&id=${v.id}`}>Download (Word)</a>
              {!v.submitted_at && <ActionForm action={omSubmitReportAction} hideSubmit className="flex gap-1"><input type="hidden" name="site_id" value={site.id} /><input type="hidden" name="kind" value="VISIT" /><input type="hidden" name="report_id" value={v.id} />
                <input name="to" type="email" required defaultValue={site.client_email ?? ""} className="input w-52 py-1 text-xs" aria-label="Client email" /><button className="btn-primary btn-sm">Submit to client</button></ActionForm>}</div>
          </div>))}</div> : <p className="text-sm text-slate-500">No visit reports yet</p>}
      </Card>
    </div>
  );
}
