-- Reporting views (swap to materialized views + periodic refresh when data volume grows; see docs/ARCHITECTURE.md)
create or replace view v_wo_pnl as
select w.id, w.wo_no, w.wo_type, w.title, w.status, w.customer_id, w.vertical_id, w.contract_value, w.budget_cost,
       w.quoted_margin_pct, w.pct_complete, w.start_date, w.end_date, w.created_at, w.created_by, w.proposal_id, w.has_fabrication,
       coalesce(c.actual, 0) actual_cost, coalesce(c.committed, 0) committed_cost,
       coalesce(i.billed, 0) billed, coalesce(r.received, 0) received,
       greatest(w.budget_cost, coalesce(c.actual, 0) + coalesce(c.committed, 0)) eac,
       case when w.contract_value > 0 then round(((w.contract_value - greatest(w.budget_cost, coalesce(c.actual,0) + coalesce(c.committed,0))) / w.contract_value * 100)::numeric, 2) end est_margin_pct,
       case when w.budget_cost > 0 then round(((coalesce(c.actual,0) + coalesce(c.committed,0)) / w.budget_cost * 100)::numeric, 1) else 0 end consumed_pct,
       case
         when w.budget_cost > 0 and (coalesce(c.actual,0) + coalesce(c.committed,0)) > w.budget_cost then 'RED'
         when w.budget_cost > 0 and ((coalesce(c.actual,0) + coalesce(c.committed,0)) / w.budget_cost * 100) - w.pct_complete > 15 then 'RED'
         when w.budget_cost > 0 and ((coalesce(c.actual,0) + coalesce(c.committed,0)) / w.budget_cost * 100) - w.pct_complete > 5 then 'AMBER'
         else 'GREEN' end cost_rag,
       case
         when w.end_date is not null and w.end_date < current_date and w.status not in ('COMPLETED','CLOSED') then 'RED'
         when exists (select 1 from milestone m where m.wo_id = w.id and m.status = 'PENDING' and m.due_date < current_date) then 'AMBER'
         when w.end_date is not null and w.status not in ('COMPLETED','CLOSED') and w.start_date is not null
              and (current_date - w.start_date)::numeric / nullif(w.end_date - w.start_date, 0) * 100 - w.pct_complete > 20 then 'AMBER'
         else 'GREEN' end schedule_rag
  from work_order w
  left join (select wo_id, sum(amount) filter (where status = 'POSTED') actual, sum(amount) filter (where status = 'COMMITTED') committed
               from cost_entry where cost_centre = 'WO' group by wo_id) c on c.wo_id = w.id
  left join (select wo_id, sum(taxable) billed from invoice group by wo_id) i on i.wo_id = w.id
  left join (select i.wo_id, sum(r.amount / (1 + i.gst / nullif(i.taxable, 0))) received from receipt r join invoice i on i.id = r.invoice_id group by i.wo_id) r on r.wo_id = w.id;
