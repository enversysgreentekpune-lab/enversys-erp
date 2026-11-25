import Link from "next/link";
import { requirePage, can } from "@/lib/auth";
import { q, one } from "@/lib/db";
import { resolveFrame, type Frame } from "@/lib/period";
import { todayIST } from "@/lib/hr";
import { inr, inrShort, num, label, dt } from "@/lib/format";
import { PageHeader, Card, Table, Badge, Stat, Tabs, Progress, Empty } from "@/components/ui";
import { FrameBar } from "@/components/FrameBar";
import { Bars, Donut } from "@/components/charts";
import { ActionForm } from "@/components/ActionForm";
import { jobUpdateAction, createJobAction, deployAction } from "@/app/actions/ops";
import { JOB_CATEGORIES } from "@/lib/workflow";
import { JOB_STAGES } from "@/lib/ops";

export const metadata = { title: "Manufacturing" };
const CONSUMABLES = ["WELDING_ROD", "GRINDING_WHEEL", "PPE", "PAINT"];
const MAT_LABEL: Record<string, string> = { MS_SHEET: "MS sheets", SS_SHEET: "SS sheets", MS_STRUCTURE: "MS structure", WELDING_ROD: "Welding rods", GRINDING_WHEEL: "Grinding wheels", PPE: "PPE", PAINT: "Paint", FASTENER: "Fasteners", ELECTRICAL: "Electrical", BOUGHT_OUT: "Bought-out", OTHER: "Other items" };

export default async function Manufacturing({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requirePage("manufacturing");
  const sp = await searchParams;
  const range = resolveFrame((sp.frame as Frame) ?? "fy", new Date(), { from: sp.from, to: sp.to });
  const tab = sp.tab ?? "overview";
  const today = todayIST();
  const [cats, jobs, matGroups, factoryAdmin, manpower, deployed, hoursPeriod, consMonth, consYear, consProject] = await Promise.all([
    q(`select category, count(*) filter (where status='COMPLETED')::int done, count(*) filter (where status='IN_PROGRESS')::int wip, count(*) filter (where status='NEW')::int pending,
        coalesce(sum(weight_kg) filter (where status='COMPLETED'),0) kg, coalesce(sum(qty) filter (where status='COMPLETED'),0) items from job_order group by category`),
    q(`select j.*, w.wo_no, w.id wid, c.name customer, e.name supervisor,
        coalesce((select sum(amount) from cost_entry ce where ce.job_id=j.id and ce.source_type='MATERIAL_ISSUE' and coalesce(ce.expense_head,'OTHER') <> all($3)),0) material,
        coalesce((select sum(amount) from cost_entry ce where ce.job_id=j.id and ce.source_type='MATERIAL_ISSUE' and ce.expense_head = any($3)),0) consumables,
        coalesce((select sum(amount) from cost_entry ce where ce.job_id=j.id and ce.category='LABOUR'),0) labour,
        coalesce((select sum(dl.hours) from dwr_line dl join dwr d on d.id=dl.dwr_id where dl.job_id=j.id and d.report_date between $1 and $2),0) hours_period,
        coalesce((select sum(dl.hours) from dwr_line dl where dl.job_id=j.id),0) hours
      from job_order j join work_order w on w.id=j.wo_id join customer c on c.id=w.customer_id left join employee e on e.id=j.supervisor_id
      order by case j.status when 'IN_PROGRESS' then 0 when 'NEW' then 1 when 'ON_HOLD' then 2 else 3 end, j.target_date nulls last`, [range.from, range.to, CONSUMABLES]),
    q(`select coalesce(ce.expense_head,'OTHER') grp, sum(ce.amount) v from cost_entry ce where ce.source_type='MATERIAL_ISSUE' and ce.entry_date between $1 and $2 group by 1 order by 2 desc`, [range.from, range.to]),
    q(`select expense_head, sum(amount) v from cost_entry where cost_centre='FACTORY_ADMIN' and status='POSTED' and entry_date between $1 and $2 group by 1`, [range.from, range.to]),
    q(`select e.id, e.name, d.name desig, a.status, a.check_in from employee e join location l on l.id=e.location_id left join designation d on d.id=e.designation_id
        left join attendance a on a.employee_id=e.id and a.att_date=$1 where l.kind='FACTORY' and e.is_active order by e.name`, [today]),
    q(`select e.name, j.job_no, j.project_item_code, w.wo_no, dl.hours from dwr_line dl join dwr d on d.id=dl.dwr_id join employee e on e.id=d.employee_id
        join job_order j on j.id=dl.job_id join work_order w on w.id=j.wo_id where d.report_date=$1 order by e.name`, [today]),
    // normal capacity: factory headcount × 9 h × working days (26 of 30) elapsed in the period
    one(`select count(*)::int * 9 * greatest(1, round((least($2::date, current_date) - $1::date + 1) * 26.0 / 30)) h
         from employee e join location l on l.id=e.location_id where e.is_active and l.kind='FACTORY'`, [range.from, range.to]),
    // consumables (welding rods, grinding wheels, PPE, paint) issued to jobs: per month, per financial year, per project
    q(`select to_char(date_trunc('month', entry_date), 'Mon YYYY') m, date_trunc('month', entry_date) d,
        sum(amount) filter (where expense_head='WELDING_ROD') welding, sum(amount) filter (where expense_head='GRINDING_WHEEL') grinding,
        sum(amount) filter (where expense_head='PPE') ppe, sum(amount) filter (where expense_head='PAINT') paint, sum(amount) total
        from cost_entry where source_type='MATERIAL_ISSUE' and expense_head = any($1) group by 1,2 order by 2 desc limit 24`, [CONSUMABLES]),
    q(`select case when extract(month from entry_date) >= 4 then extract(year from entry_date)::int else extract(year from entry_date)::int - 1 end fy, sum(amount) total, count(distinct job_id)::int jobs
        from cost_entry where source_type='MATERIAL_ISSUE' and expense_head = any($1) group by 1 order by 1 desc`, [CONSUMABLES]),
    q(`select w.id, w.wo_no, c.name customer, count(distinct ce.job_id)::int jobs, sum(ce.amount) total,
        sum(ce.amount) filter (where ce.entry_date >= date_trunc('month', current_date)) this_month
        from cost_entry ce join job_order j on j.id=ce.job_id join work_order w on w.id=j.wo_id join customer c on c.id=w.customer_id
        where ce.source_type='MATERIAL_ISSUE' and ce.expense_head = any($1) group by 1,2,3 order by total desc`, [CONSUMABLES]),
  ]);
  const power = Number(factoryAdmin.find((f) => f.expense_head === "POWER")?.v ?? 0);
  const siteAdmin = factoryAdmin.filter((f) => f.expense_head !== "POWER").reduce((a, f) => a + Number(f.v), 0);
  // Absorption rates per man-hour at normal capacity; each job absorbs overhead on its own labour hours
  const capacityH = Number(hoursPeriod?.h ?? 0) || 1;
  const elecRate = power / capacityH, adminRate = siteAdmin / capacityH;
  const rows = jobs.map((j) => {
    const elec = Number(j.hours) * elecRate, admin = Number(j.hours) * adminRate;
    const total = Number(j.material) + Number(j.consumables) + Number(j.labour) + elec + admin;
    return { ...j, elec, admin, total, perTon: Number(j.weight_kg) > 0 ? total / (Number(j.weight_kg) / 1000) : null, perItem: Number(j.qty) > 0 ? total / Number(j.qty) : null };
  });
  const sum = (k: string, f: (r: any) => boolean = () => true) => rows.filter(f).reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const done = (r: any) => r.status === "COMPLETED";
  const tonnes = sum("weight_kg", done) / 1000, itemsDone = sum("qty", done), costDone = sum("total", done);
  const present = manpower.filter((m) => ["P", "HD", "OD"].includes(m.status)).length;
  const deployedNames = new Set(deployed.map((d) => d.name));
  const cat = (c: string) => cats.find((x) => x.category === c) ?? { done: 0, wip: 0, pending: 0, kg: 0, items: 0 };
  const tabs = [{ key: "overview", label: "Overview" }, { key: "jobs", label: `Jobs & costing (${jobs.length})` }, { key: "consumables", label: "Consumables" }, { key: "manpower", label: "Daily manpower" }];
  const consPeriod = matGroups.filter((m) => CONSUMABLES.includes(m.grp)).reduce((a, m) => a + Number(m.v), 0);
  const thisMonth = consMonth.find((m) => new Date(m.d).getMonth() === new Date().getMonth() && new Date(m.d).getFullYear() === new Date().getFullYear());
  const fyNow = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const edit = !!can(u, "manufacturing", "edit");
  return (
    <div>
      <PageHeader title="Manufacturing — Markal Factory" subtitle="Every job carries its project code and project item code. Costs: material + consumables issued + labour + electricity + site admin." />
      <FrameBar showCompare={false} showUnit={false} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {JOB_CATEGORIES.map(([code, name]) => {
          const c = cat(code);
          return (
            <Link key={code} href={`/manufacturing?tab=jobs&cat=${code}`} className="card block p-3 hover:border-brand-600">
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">{name}</div>
              <div className="mt-2 grid grid-cols-3 gap-1 text-center">
                <div><div className="font-display text-xl font-bold text-brand-700">{c.done}</div><div className="text-[10px] text-slate-500">Completed</div></div>
                <div><div className="font-display text-xl font-bold text-navy-900 dark:text-slate-100">{c.wip}</div><div className="text-[10px] text-slate-500">In progress</div></div>
                <div><div className="font-display text-xl font-bold text-slate-400">{c.pending}</div><div className="text-[10px] text-slate-500">New pending</div></div>
              </div>
            </Link>
          );
        })}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-9">
        <Stat label="Manpower available today" value={`${present} / ${manpower.length}`} sub="factory staff present" href="/manufacturing?tab=manpower" />
        <Stat label="Deployed on jobs today" value={deployedNames.size} href="/manufacturing?tab=manpower" />
        <Stat label="Tonnage manufactured" value={`${num(tonnes, 2)} t`} sub="completed jobs" />
        <Stat label="Items manufactured" value={num(itemsDone)} />
        <Stat label="Cost of manufacturing" value={inrShort(costDone)} sub="completed jobs" />
        <Stat label="Cost per tonne" value={tonnes ? inrShort(costDone / tonnes) : "—"} />
        <Stat label="Electricity (period)" value={inrShort(power)} />
        <Stat label="Site admin (period)" value={inrShort(siteAdmin)} />
        <Stat label="Total consumables (period)" value={inrShort(consPeriod)} sub={`this month ${inrShort(Number(thisMonth?.total ?? 0))}`} href={`/manufacturing?frame=${sp.frame ?? "fy"}&tab=consumables`} />
      </div>
      <Tabs tabs={tabs} active={tab} base={`/manufacturing?frame=${sp.frame ?? "fy"}`} />
      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Material cost by type (period)">{matGroups.length ? <Donut data={matGroups.map((m) => ({ k: MAT_LABEL[m.grp] ?? m.grp, v: Number(m.v) }))} name="k" value="v" /> : <Empty>No material issued in period</Empty>}</Card>
          <Card title="Manufacturing cost build-up (all jobs)" className="lg:col-span-2">
            <Bars data={[{ k: "Material", v: sum("material") }, { k: "Consumables", v: sum("consumables") }, { k: "Labour", v: sum("labour") }, { k: "Electricity", v: sum("elec") }, { k: "Site admin", v: sum("admin") }]} x="k" bars={[{ key: "v", label: "Cost" }]} height={220} />
          </Card>
          <Card title="Tonnage & items vs cost by category" className="lg:col-span-3" bodyClass="p-0">
            <Table head={["Category", "Completed", "In progress", "New pending", "Tonnage made", "Items made", "Cost of completed", "Cost / tonne", "Cost / item"]}>
              {JOB_CATEGORIES.map(([code, name]) => {
                const c = cat(code), cost = rows.filter((r) => r.category === code && done(r)).reduce((a, r) => a + r.total, 0), t = Number(c.kg) / 1000;
                return <tr key={code}><td className="font-medium">{name}</td><td className="num">{c.done}</td><td className="num">{c.wip}</td><td className="num">{c.pending}</td><td className="num">{num(t, 2)} t</td><td className="num">{num(c.items)}</td><td className="num">{inr(cost)}</td><td className="num">{t ? inr(cost / t) : "—"}</td><td className="num">{Number(c.items) ? inr(cost / Number(c.items)) : "—"}</td></tr>;
              })}
            </Table>
          </Card>
        </div>
      )}
      {tab === "jobs" && (
        <>
          <Card bodyClass="p-0">
            {rows.length ? <Table head={["Job", "Project code / item code", "Category", "Item", "Qty · tonnage", "Stage / progress", "Material", "Consumables", "Labour", "Electricity", "Site admin", "Total cost", "Cost / t", "Budget", ...(edit ? ["Update"] : [])]}>
              {rows.filter((r) => !sp.cat || r.category === sp.cat).map((j) => (
                <tr key={j.id}>
                  <td className="font-medium">{j.job_no}<div className="text-[11px] text-slate-500">{j.supervisor ?? ""}{j.target_date && ` · due ${dt(j.target_date)}`}</div></td>
                  <td><Link className="link" href={`/work-orders/${j.wid}?tab=jobs`}>{j.wo_no}</Link><div className="font-mono text-[11px] text-slate-500">{j.project_item_code}</div></td>
                  <td className="text-xs">{label(j.category)}</td><td className="max-w-[180px]">{j.title}<div className="text-[11px] text-slate-500">{j.customer}</div></td>
                  <td className="num">{num(j.qty)} {j.uom}<div className="text-[11px] text-slate-500">{num(j.weight_kg / 1000, 2)} t</div></td>
                  <td className="w-32"><div className="flex justify-between text-xs"><span>{label(j.stage)}</span><Badge status={j.status} /></div><Progress value={Number(j.pct)} /></td>
                  <td className="num">{inr(j.material)}</td><td className="num">{inr(j.consumables)}</td><td className="num">{inr(j.labour)}</td><td className="num">{inr(j.elec)}</td><td className="num">{inr(j.admin)}</td>
                  <td className="num font-semibold">{inr(j.total)}</td><td className="num">{j.perTon ? inr(j.perTon) : "—"}</td>
                  <td className={`num ${j.total > Number(j.budget_cost) && Number(j.budget_cost) > 0 ? "text-rose-600" : ""}`}>{inr(j.budget_cost)}</td>
                  {edit && <td>{j.status !== "COMPLETED" && (
                    <ActionForm action={jobUpdateAction} hideSubmit className="flex gap-1"><input type="hidden" name="id" value={j.id} />
                      <select name="stage" defaultValue={j.stage} className="input w-28 py-1 text-xs">{JOB_STAGES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
                      <input name="pct" defaultValue={j.pct} className="input w-14 py-1 text-xs" aria-label="Progress %" /><button className="btn-secondary btn-sm">Save</button></ActionForm>)}</td>}
                </tr>
              ))}
            </Table> : <Empty>No jobs yet. Jobs are created automatically from won orders with Markal fabrication scope.</Empty>}
          </Card>
          <p className="mt-2 text-xs text-slate-500">Electricity and site admin are absorbed at an hourly rate: factory admin expenses of the selected period ÷ normal factory capacity (headcount × 9 h × working days) = {inr(elecRate)}/h electricity and {inr(adminRate)}/h site admin, applied to each job&apos;s labour hours. Unabsorbed overhead (idle capacity) stays in factory admin.</p>
          {can(u, "manufacturing", "create") && <NewJob />}
        </>
      )}
      {tab === "consumables" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Consumables — this month" value={inr(Number(thisMonth?.total ?? 0))} />
            <Stat label={`Consumables — FY ${fyNow}-${String(fyNow + 1).slice(2)}`} value={inr(Number(consYear.find((y) => y.fy === fyNow)?.total ?? 0))} />
            <Stat label="Consumables — selected period" value={inr(consPeriod)} />
            <Stat label="Average per job" value={inr(rows.filter((r) => Number(r.consumables) > 0).length ? sum("consumables") / rows.filter((r) => Number(r.consumables) > 0).length : 0)} sub="jobs that drew consumables" />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="Per job" bodyClass="p-0">
              <Table head={["Job", "Project code / item", "Consumables", "Per tonne", "Share of job cost"]}>
                {rows.filter((r) => Number(r.consumables) > 0).sort((a, b) => Number(b.consumables) - Number(a.consumables)).map((j) => (
                  <tr key={j.id}><td className="font-medium">{j.job_no}<div className="text-[11px] text-slate-500">{j.title}</div></td><td>{j.wo_no}<div className="font-mono text-[11px] text-slate-500">{j.project_item_code}</div></td>
                    <td className="num font-medium">{inr(j.consumables)}</td><td className="num">{Number(j.weight_kg) > 0 ? inr(Number(j.consumables) / (Number(j.weight_kg) / 1000)) : "—"}</td><td className="num">{j.total ? `${Math.round((Number(j.consumables) / j.total) * 100)}%` : "—"}</td></tr>
                ))}
              </Table>
            </Card>
            <Card title="Per project" bodyClass="p-0">
              {consProject.length ? <Table head={["Project code", "Client", "Jobs", "This month", "Total consumables"]}>
                {consProject.map((p) => <tr key={p.id}><td><Link className="link font-medium" href={`/work-orders/${p.id}?tab=jobs`}>{p.wo_no}</Link></td><td>{p.customer}</td><td className="num">{p.jobs}</td><td className="num">{inr(Number(p.this_month ?? 0))}</td><td className="num font-medium">{inr(p.total)}</td></tr>)}
              </Table> : <Empty>No consumables issued yet</Empty>}
            </Card>
            <Card title="Per month" bodyClass="p-0">
              {consMonth.length ? <Table head={["Month", "Welding rods", "Grinding wheels", "PPE", "Paint", "Total"]}>
                {consMonth.map((m) => <tr key={m.m}><td className="font-medium">{m.m}</td><td className="num">{inr(Number(m.welding ?? 0))}</td><td className="num">{inr(Number(m.grinding ?? 0))}</td><td className="num">{inr(Number(m.ppe ?? 0))}</td><td className="num">{inr(Number(m.paint ?? 0))}</td><td className="num font-medium">{inr(m.total)}</td></tr>)}
              </Table> : <Empty>No consumables issued yet</Empty>}
            </Card>
            <Card title="Per year (financial year, April–March)" bodyClass="p-0">
              {consYear.length ? <Table head={["Financial year", "Jobs", "Total consumables"]}>
                {consYear.map((y) => <tr key={y.fy}><td className="font-medium">FY {y.fy}-{String(y.fy + 1).slice(2)}</td><td className="num">{y.jobs}</td><td className="num font-medium">{inr(y.total)}</td></tr>)}
              </Table> : <Empty>No consumables issued yet</Empty>}
            </Card>
          </div>
          <p className="text-xs text-slate-500">Consumables are welding rods, grinding wheels, PPE and paint issued from stores against a job. They are part of each job&apos;s total cost.</p>
        </div>
      )}
      {tab === "manpower" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-4">
            <Card title={`Today — ${dt(today)}: who is working on which project code`} bodyClass="p-0">
              {deployed.length ? <Table head={["Employee", "Job", "Project item code", "Project code", "Hours"]}>{deployed.map((d, i) => <tr key={i}><td>{d.name}</td><td>{d.job_no}</td><td className="font-mono text-xs">{d.project_item_code}</td><td>{d.wo_no}</td><td className="num">{num(d.hours, 1)}</td></tr>)}</Table> : <Empty>No one deployed on jobs yet today</Empty>}
            </Card>
            <Card title="Factory manpower availability" bodyClass="p-0">
              <Table head={["Employee", "Designation", "Attendance", "In", "Deployed"]}>{manpower.map((m) => <tr key={m.id}><td>{m.name}</td><td className="text-xs">{m.desig}</td><td>{m.status ? <Badge status={m.status} /> : <Badge tone="amber">Not marked</Badge>}</td><td className="text-xs">{m.check_in ? new Date(m.check_in).toLocaleTimeString("en-IN", { timeStyle: "short", timeZone: "Asia/Kolkata" }) : "—"}</td><td>{deployedNames.has(m.name) ? <Badge tone="green">Yes</Badge> : "—"}</td></tr>)}</Table>
            </Card>
          </div>
          {edit && <Deploy people={manpower} jobs={rows.filter((r) => r.status !== "COMPLETED")} today={today} />}
        </div>
      )}
    </div>
  );
}

function Deploy({ people, jobs, today }: { people: any[]; jobs: any[]; today: string }) {
  return (
    <Card title="Deploy manpower on jobs">
      <ActionForm action={deployAction} reset submitLabel="Save deployment" className="space-y-2">
        <select name="employee_id" required className="input">{people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.status ? ` (${p.status})` : ""}</option>)}</select>
        <input type="date" name="date" defaultValue={today} max={today} className="input" />
        {[0, 1].map((i) => (
          <div key={i} className="grid grid-cols-[1fr_70px] gap-2">
            <select name="job_id" className="input"><option value="">{i ? "Second job (optional)" : "Job…"}</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.job_no} · {j.project_item_code}</option>)}</select>
            <input name="hours" placeholder="Hours" defaultValue={i ? "" : "8"} className="input" />
          </div>
        ))}
      </ActionForm>
      <p className="mt-2 text-[11px] text-slate-500">Saved as the worker&apos;s daily work report; hours are costed at their labour rate to the job and its project code.</p>
    </Card>
  );
}

async function NewJob() {
  const lines = await q(`select s.id, s.project_item_code, s.description, s.qty, s.uom, w.wo_no from wo_spec_line s join work_order w on w.id=s.wo_id
    where w.status not in ('CLOSED','CANCELLED') and w.order_kind='PO' and not exists (select 1 from job_order j where j.wo_spec_line_id=s.id) order by w.wo_no, s.sl`);
  const sups = await q(`select e.id, e.name from employee e join role r on r.id=e.role_id where r.code in ('PRODUCTION_SUPERVISOR','FACTORY_MANAGER') and e.is_active`);
  return (
    <Card title="Create a job from a project item" className="mt-4 max-w-4xl">
      <ActionForm action={createJobAction} reset submitLabel="Create job" className="grid gap-2 sm:grid-cols-3">
        <select name="spec_line_id" required className="input sm:col-span-3"><option value="">Project item…</option>{lines.map((l) => <option key={l.id} value={l.id}>{l.project_item_code ?? l.wo_no} · {l.description} ({num(l.qty)} {l.uom})</option>)}</select>
        <select name="category" className="input">{JOB_CATEGORIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
        <input name="qty" placeholder="Qty (default: item qty)" className="input" /><input name="weight" placeholder="Total weight kg" className="input" />
        <select name="supervisor_id" className="input"><option value="">Supervisor…</option>{sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <input type="date" name="target_date" className="input" aria-label="Target date" />
      </ActionForm>
    </Card>
  );
}
