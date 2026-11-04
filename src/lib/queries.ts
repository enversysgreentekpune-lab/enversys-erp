import "server-only";
import { q, one } from "./db";
import { OPEN_STAGES, LEAD_STAGES } from "./workflow";
import type { Range } from "./period";

export interface Filters { verticalId?: string | null; ownerId?: string | null; customerId?: string | null }
const F = (f: Filters, p: unknown[], alias: { v?: string; o?: string; c?: string }) => {
  const w: string[] = [];
  if (f.verticalId && alias.v) { p.push(f.verticalId); w.push(`${alias.v}=$${p.length}`); }
  if (f.ownerId && alias.o) { p.push(f.ownerId); w.push(`${alias.o}=$${p.length}`); }
  if (f.customerId && alias.c) { p.push(f.customerId); w.push(`${alias.c}=$${p.length}`); }
  return w.length ? " and " + w.join(" and ") : "";
};

export async function salesKpis(r: Range, f: Filters = {}) {
  const p: unknown[] = [r.from, r.to];
  const lf = F(f, p, { v: "l.vertical_id", o: "l.assigned_to", c: "l.customer_id" });
  const enq = await one(`select count(*)::int n, coalesce(sum(est_value),0) v from lead l where enquiry_date between $1 and $2 ${lf}`, p);
  const p2: unknown[] = [r.from, r.to];
  const pf = F(f, p2, { v: "l.vertical_id", o: "p.owner_id", c: "p.customer_id" });
  const props = await q(`select p.status, count(*)::int n, coalesce(sum(coalesce(p.final_value, p.quoted_value)),0) v, avg(p.quoted_margin_pct) margin
      from proposal p join lead l on l.id=p.lead_id where coalesce(p.submitted_at, p.created_at)::date between $1 and $2 ${pf} group by p.status`, p2);
  const st = (s: string) => props.find((x) => x.status === s) ?? { n: 0, v: 0, margin: null };
  const won = st("WON"), lost = st("LOST");
  const submitted = props.filter((x) => !["DRAFT", "PENDING_APPROVAL", "APPROVED", "CANCELLED"].includes(x.status));
  const p3: unknown[] = [r.from, r.to];
  const wf = F(f, p3, { v: "w.vertical_id", c: "w.customer_id" });
  const booking = await one(`select count(*)::int n, coalesce(sum(contract_value),0) v from work_order w where w.created_at::date between $1 and $2 ${wf}`, p3);
  return {
    enquiries: enq!, booking: booking!,
    submitted: { n: submitted.reduce((a, x) => a + x.n, 0), v: submitted.reduce((a, x) => a + Number(x.v), 0) },
    won, lost, inDiscussion: st("IN_DISCUSSION"), inNegotiation: st("IN_NEGOTIATION"), onHold: st("ON_HOLD"), pendingApproval: st("PENDING_APPROVAL"),
    winRateCount: won.n + lost.n ? (won.n / (won.n + lost.n)) * 100 : 0,
    winRateValue: Number(won.v) + Number(lost.v) ? (Number(won.v) / (Number(won.v) + Number(lost.v))) * 100 : 0,
    byStatus: props,
  };
}

export async function pipeline(f: Filters = {}) {
  const p: unknown[] = [OPEN_STAGES];
  const lf = F(f, p, { v: "l.vertical_id", o: "l.assigned_to", c: "l.customer_id" });
  const rows = await q(`select stage, count(*)::int n, coalesce(sum(est_value),0) v from lead l where stage = any($1) ${lf} group by stage`, p);
  const weighted = rows.reduce((a, r) => a + Number(r.v) * (LEAD_STAGES.find((s) => s.code === r.stage)?.prob ?? 0) / 100, 0);
  return { rows, weighted, total: rows.reduce((a, r) => a + Number(r.v), 0), count: rows.reduce((a, r) => a + r.n, 0) };
}

const ORD_SQL = (col: string) => `case ${col} when 'QUALIFIED' then 1 when 'SITE_VISIT' then 1 when 'ESTIMATION' then 2 when 'PROPOSAL_SUBMITTED' then 3 when 'IN_DISCUSSION' then 3 when 'IN_NEGOTIATION' then 4 when 'WON' then 5 else 0 end`;
export async function funnel(r: Range, f: Filters = {}) {
  // cumulative funnel: leads enquired in range by the furthest stage they ever reached (current stage or stage history)
  const p: unknown[] = [r.from, r.to];
  const lf = F(f, p, { v: "l.vertical_id", o: "l.assigned_to", c: "l.customer_id" });
  const leads = await q(`select l.est_value, greatest(${ORD_SQL("l.stage")}, coalesce((select max(${ORD_SQL("a.meta->>'to'")}) from activity a where a.entity='lead' and a.entity_id=l.id and a.kind='STAGE'),0)) ord
      from lead l where l.enquiry_date between $1 and $2 ${lf}`, p);
  const order: [string, string][] = [["NEW", "Enquiries"], ["QUALIFIED", "Qualified"], ["ESTIMATION", "Estimated"], ["PROPOSAL_SUBMITTED", "Proposal sent"], ["IN_NEGOTIATION", "Negotiation"], ["WON", "Won"]];
  return order.map(([stage, label], i) => {
    const hit = leads.filter((l) => l.ord >= i);
    return { stage, label, n: hit.length, v: hit.reduce((a, l) => a + Number(l.est_value), 0) };
  });
}

export async function lossReasons(r: Range, f: Filters = {}) {
  const p: unknown[] = [r.from, r.to];
  const lf = F(f, p, { v: "l.vertical_id", o: "l.assigned_to", c: "l.customer_id" });
  return q(`select coalesce(lost_reason,'Unspecified') reason, count(*)::int n, coalesce(sum(est_value),0) v, string_agg(distinct competitor_name, ', ') competitors
    from lead l where stage='LOST' and stage_changed_at::date between $1 and $2 ${lf} group by 1 order by 2 desc`, p);
}

export async function byDimension(dim: "vertical" | "source" | "owner" | "customer" | "industry" | "month", r: Range, f: Filters = {}) {
  const p: unknown[] = [r.from, r.to];
  const lf = F(f, p, { v: "l.vertical_id", o: "l.assigned_to", c: "l.customer_id" });
  const key = { vertical: "v.name", source: "l.source", owner: "e.name", customer: "c.name", industry: "c.industry", month: "to_char(l.enquiry_date,'YYYY-MM')" }[dim];
  return q(`select ${key} k, count(*)::int n, coalesce(sum(l.est_value),0) v,
      count(*) filter (where l.stage='WON')::int won, count(*) filter (where l.stage='LOST')::int lost,
      coalesce(sum(l.est_value) filter (where l.stage='WON'),0) won_v,
      count(*) filter (where l.stage = any($${p.length + 1}))::int open
    from lead l join vertical v on v.id=l.vertical_id left join employee e on e.id=l.assigned_to join customer c on c.id=l.customer_id
    where l.enquiry_date between $1 and $2 ${lf} group by 1 order by ${dim === "month" ? "1" : "3 desc"}`, [...p, OPEN_STAGES]);
}

export async function leaderboard(r: Range) {
  return q(`select e.id, e.name,
      (select count(*)::int from lead l where l.assigned_to=e.id and l.enquiry_date between $1 and $2) enquiries,
      (select count(*)::int from proposal p where p.owner_id=e.id and p.submitted_at::date between $1 and $2) proposals,
      (select coalesce(sum(p.final_value),0) from proposal p where p.owner_id=e.id and p.status='WON' and p.decided_at::date between $1 and $2) won_value,
      (select count(*)::int from proposal p where p.owner_id=e.id and p.status='WON' and p.decided_at::date between $1 and $2) won,
      (select count(*)::int from proposal p where p.owner_id=e.id and p.status='LOST' and p.decided_at::date between $1 and $2) lost
    from employee e join role r on r.id=e.role_id where r.code in ('SALES_ENGINEER','SALES_MANAGER','BUSINESS_HEAD') and e.is_active order by 5 desc`, [r.from, r.to]);
}

export async function cycleTimes(r: Range) {
  return one(`select
      avg(extract(epoch from (p.submitted_at - l.created_at))/86400) filter (where p.submitted_at is not null) avg_days_to_quote,
      avg(extract(epoch from (p.decided_at - l.created_at))/86400) filter (where p.status='WON') avg_sales_cycle,
      avg(p.quoted_margin_pct) filter (where p.submitted_at is not null) avg_margin_quoted,
      avg(p.quoted_margin_pct) filter (where p.status='WON') avg_margin_won,
      coalesce(sum(p.quoted_value) filter (where p.status='WON'),0) won_quoted, coalesce(sum(p.final_value) filter (where p.status='WON'),0) won_final
    from proposal p join lead l on l.id=p.lead_id where l.enquiry_date between $1 and $2`, [r.from, r.to]);
}

export async function ageing() {
  return q(`select case when age < 30 then '0-30' when age < 60 then '31-60' when age < 90 then '61-90' else '90+' end bucket, count(*)::int n, coalesce(sum(est_value),0) v
    from (select current_date - enquiry_date age, est_value from lead where stage = any($1)) x group by 1 order by 1`, [OPEN_STAGES]);
}

export async function forecast() {
  return q(`select to_char(coalesce(expected_closure, current_date),'YYYY-MM') m, count(*)::int n, coalesce(sum(est_value),0) v,
      coalesce(sum(est_value * case stage ${LEAD_STAGES.map((s) => `when '${s.code}' then ${s.prob}`).join(" ")} else 0 end / 100.0),0) weighted
    from lead where stage = any($1) group by 1 order by 1`, [OPEN_STAGES]);
}

export async function woPortfolio(f: Filters = {}, scopeSql = "true", scopeParams: unknown[] = []) {
  const p: unknown[] = [...scopeParams];
  const wf = F(f, p, { v: "w.vertical_id", c: "w.customer_id" });
  return q(`select w.*, c.name customer, v.name vertical,
      (select string_agg(e.name, ', ') from wo_team t join employee e on e.id=t.employee_id where t.wo_id=w.id and t.team_role='PM') pm,
      (select m.name || ' · ' || to_char(m.due_date,'DD Mon') from milestone m where m.wo_id=w.id and m.status='PENDING' order by m.due_date limit 1) next_milestone
    from v_wo_pnl w join customer c on c.id=w.customer_id join vertical v on v.id=w.vertical_id
    where ${scopeSql} ${wf} order by w.created_at desc`, p);
}

export async function finance(r: Range, f: Filters = {}) {
  const p: unknown[] = [r.from, r.to];
  const wf = F(f, p, { v: "w.vertical_id", c: "i.customer_id" });
  const rev = await one(`select coalesce(sum(i.taxable),0) v from invoice i left join work_order w on w.id=i.wo_id where i.invoice_date between $1 and $2 ${wf}`, p);
  const col = await one(`select coalesce(sum(r.amount),0) v from receipt r join invoice i on i.id=r.invoice_id left join work_order w on w.id=i.wo_id where r.receipt_date between $1 and $2 ${wf}`, p);
  const p2: unknown[] = [];
  const wf2 = F(f, p2, { v: "w.vertical_id", c: "i.customer_id" });
  const ar = await q(`select i.*, c.name customer, i.total - coalesce((select sum(amount) from receipt r where r.invoice_id=i.id),0) due,
      current_date - coalesce(i.due_date, i.invoice_date) overdue_days
    from invoice i join customer c on c.id=i.customer_id left join work_order w on w.id=i.wo_id where true ${wf2}`, p2);
  const open = ar.filter((x) => Number(x.due) > 1);
  const bucket = (d: number) => (d <= 30 ? "0-30" : d <= 60 ? "31-60" : d <= 90 ? "61-90" : "90+");
  const ageingB: Record<string, number> = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const x of open) ageingB[bucket(Math.max(0, x.overdue_days))] += Number(x.due);
  const costs = await q(`select cost_centre, coalesce(sum(amount),0) v from cost_entry where status='POSTED' and entry_date between $1 and $2 group by 1`, [r.from, r.to]);
  const cc = (k: string) => Number(costs.find((x) => x.cost_centre === k)?.v ?? 0);
  const payables = await one(`select coalesce(sum(amount),0) v from cost_entry where status='COMMITTED'`);
  const topDebtors = Object.values(open.reduce((a: Record<string, any>, x) => { (a[x.customer] ??= { customer: x.customer, due: 0 }).due += Number(x.due); return a; }, {}))
    .sort((a: any, b: any) => b.due - a.due).slice(0, 5);
  return {
    revenue: Number(rev!.v), collections: Number(col!.v), receivables: open.reduce((a, x) => a + Number(x.due), 0),
    over90: ageingB["90+"], ageing: ageingB, projectCost: cc("WO"), officeAdmin: cc("OFFICE_ADMIN"), factoryAdmin: cc("FACTORY_ADMIN"),
    committed: Number(payables!.v), topDebtors,
  };
}

export async function monthlyTrend(fyFrom: string, fyTo: string) {
  return q(`with m as (select generate_series($1::date, $2::date, interval '1 month')::date m)
    select to_char(m.m,'Mon') label, to_char(m.m,'YYYY-MM') ym,
      (select coalesce(sum(taxable),0) from invoice where date_trunc('month', invoice_date)=m.m) revenue,
      (select coalesce(sum(contract_value),0) from work_order where date_trunc('month', created_at)=m.m) booking,
      (select coalesce(sum(amount),0) from cost_entry where status='POSTED' and cost_centre='WO' and date_trunc('month', entry_date)=m.m) project_cost,
      (select coalesce(sum(amount),0) from cost_entry where status='POSTED' and cost_centre='OFFICE_ADMIN' and date_trunc('month', entry_date)=m.m) office_admin,
      (select coalesce(sum(amount),0) from cost_entry where status='POSTED' and cost_centre='FACTORY_ADMIN' and date_trunc('month', entry_date)=m.m) factory_admin,
      (select count(*)::int from lead where date_trunc('month', enquiry_date)=m.m) enquiries
    from m order by m.m`, [fyFrom, fyTo]);
}

export async function adminVsBudget(centre: "OFFICE_ADMIN" | "FACTORY_ADMIN", r: Range) {
  return q(`select h.head, coalesce(a.actual,0) actual, coalesce(b.budget,0) budget from
      (select distinct expense_head head from budget where cost_centre=$1 union select distinct expense_head from cost_entry where cost_centre=$1) h
      left join (select expense_head, sum(amount) actual from cost_entry where cost_centre=$1 and status='POSTED' and entry_date between $2 and $3 group by 1) a on a.expense_head=h.head
      left join (select expense_head, sum(amount) budget from budget where cost_centre=$1 and make_date(case when month>=4 then 2000+split_part(fy,'-',1)::int else 2000+split_part(fy,'-',2)::int end, month, 1) between date_trunc('month',$2::date) and $3::date group by 1) b on b.expense_head=h.head
      order by 2 desc`, [centre, r.from, r.to]);
}

export async function hrSnapshot(date: string) {
  const head = await q(`select l.name loc, l.kind, count(*)::int n from employee e join location l on l.id=e.location_id where e.is_active group by 1,2 order by 3 desc`);
  const byDept = await q(`select d.name dept, count(*)::int n from employee e join department d on d.id=e.department_id where e.is_active group by 1 order by 2 desc`);
  const att = await one(`select count(*) filter (where status in ('P','HD','OD'))::int present, count(*) filter (where status='A')::int absent,
      count(*) filter (where status='L')::int leave, count(*) filter (where is_late)::int late, coalesce(sum(ot_hours),0) ot
    from attendance where att_date=$1`, [date]);
  const total = head.reduce((a, x) => a + x.n, 0);
  return { head, byDept, att: att!, total };
}

export async function attendanceRange(r: Range) {
  return one(`select count(*) filter (where status in ('P','HD','OD'))::int present, count(*) filter (where status in ('P','HD','OD','A','L'))::int working,
      count(*) filter (where status='A')::int absent, count(*) filter (where is_late)::int late, coalesce(sum(ot_hours),0) ot,
      coalesce(sum(a.ot_hours * e.hourly_cost * 2),0) ot_cost
    from attendance a join employee e on e.id=a.employee_id where att_date between $1 and $2`, [r.from, r.to]);
}

export async function mdAlerts(roleCodes: string[]) {
  const cfg = (await one(`select value from app_setting where key='alerts'`))?.value ?? {};
  const overrun = await q(`select id, wo_no, title, consumed_pct, pct_complete from v_wo_pnl where status not in ('CLOSED','CANCELLED') and (cost_rag='RED' or consumed_pct > 100 + $1)`, [cfg.cost_overrun_pct ?? 5]);
  const delayed = await q(`select m.id, w.id wo_id, w.wo_no, m.name, m.due_date from milestone m join work_order w on w.id=m.wo_id where m.status='PENDING' and m.due_date < current_date order by m.due_date limit 10`);
  const approvals = await q(`select a.*, coalesce(p.proposal_no, po.po_no) ref from approval a left join proposal p on p.id=a.entity_id left join purchase_order po on po.id=a.entity_id where a.status='PENDING' and a.approver_role = any($1)`, [roleCodes]);
  const stuck = await q(`select id, enquiry_no, title, est_value, stage, current_date - stage_changed_at::date days from lead
      where stage = any($1) and est_value >= $2 and stage_changed_at < now() - ($3 || ' days')::interval order by est_value desc limit 5`,
    [OPEN_STAGES, cfg.high_value_lead ?? 2500000, String(cfg.lead_stuck_days ?? 21)]);
  const overdueTasks = await one(`select count(*)::int n, count(*) filter (where escalation_level>0)::int esc from task where status in ('TODO','IN_PROGRESS') and due_at < now()`);
  const overdueFollowups = await one(`select count(*)::int n from lead where stage = any($1) and next_followup_at < now()`, [OPEN_STAGES]);
  return { overrun, delayed, approvals, stuck, overdueTasks: overdueTasks!, overdueFollowups: overdueFollowups!.n, cfg };
}

export async function topOpportunities(f: Filters = {}) {
  const p: unknown[] = [OPEN_STAGES];
  const lf = F(f, p, { v: "l.vertical_id", o: "l.assigned_to", c: "l.customer_id" });
  return q(`select l.id, l.enquiry_no, l.title, l.est_value, l.stage, l.expected_closure, c.name customer, e.name owner from lead l
    join customer c on c.id=l.customer_id left join employee e on e.id=l.assigned_to where l.stage = any($1) ${lf} order by l.est_value desc limit 10`, p);
}
