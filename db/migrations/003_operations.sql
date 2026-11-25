-- =====================================================================
-- 003: Project codes, site visits, manufacturing jobs, stores, GRN,
--      vendor bills/payments, dispatch, invoicing links, field-service
--      tasks with client OTP, daily task templates, employee location,
--      two-step expense approval.
-- =====================================================================

-- Orders: PO (supply / project / manufacturing / trading) vs SO (service orders)
alter table work_order add column order_kind text generated always as
  (case when wo_type in ('OM','MAINTENANCE','IC','CONSULTANCY') then 'SO' else 'PO' end) stored;
alter table wo_spec_line add column project_item_code text;
alter table customer_po add column order_kind text not null default 'PO';

-- Site visit reports (optional step in the proposal flow), photos/evidence via attachment(entity='site_visit')
create table site_visit_report (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid references proposal(id) on delete cascade, lead_id uuid not null references lead(id),
  visit_date date not null, visited_by uuid references employee(id),
  site_location text, contact_person text, observations text not null, recommendations text,
  lat numeric(10,7), lng numeric(10,7),
  created_by uuid references employee(id), created_at timestamptz not null default now()
);

-- Item grouping used for manufacturing material-cost analysis
alter table item add column material_group text not null default 'OTHER'
  check (material_group in ('MS_SHEET','SS_SHEET','MS_STRUCTURE','WELDING_ROD','GRINDING_WHEEL','PPE','PAINT','FASTENER','ELECTRICAL','BOUGHT_OUT','OTHER'));
alter table item add column unit_weight_kg numeric(12,3);

-- Manufacturing job orders (Markal)
create table job_order (
  id uuid primary key default gen_random_uuid(),
  job_no text unique not null, wo_id uuid not null references work_order(id), wo_spec_line_id uuid references wo_spec_line(id),
  project_item_code text not null,
  category text not null check (category in ('TANK','SKID','OTHER','OWC_SKID','CONTROL_PANEL')),
  title text not null, qty numeric(12,3) not null default 1, uom text not null default 'NOS',
  weight_kg numeric(14,3) not null default 0,              -- total fabricated weight for the job
  status text not null default 'NEW' check (status in ('NEW','IN_PROGRESS','COMPLETED','ON_HOLD')),
  stage text not null default 'PLANNING',
  pct numeric(5,2) not null default 0, budget_cost numeric(16,2) not null default 0,
  supervisor_id uuid references employee(id), start_date date, target_date date, completed_at date,
  created_by uuid references employee(id), created_at timestamptz not null default now()
);
create index on job_order(wo_id); create index on job_order(status);
alter table dwr_line add column job_id uuid references job_order(id);
alter table cost_entry add column job_id uuid references job_order(id);
create index on cost_entry(job_id);

-- Stores
create table stock_txn (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references item(id), location_id uuid not null references location(id),
  txn_date date not null default current_date, qty numeric(14,3) not null, rate numeric(14,2) not null default 0,
  txn_type text not null check (txn_type in ('OPENING','GRN','ISSUE','RETURN','ADJUST','DISPATCH')),
  wo_id uuid references work_order(id), job_id uuid references job_order(id), grn_id uuid, ref text,
  created_by uuid references employee(id), created_at timestamptz not null default now()
);
create index on stock_txn(item_id, location_id);

create table grn (
  id uuid primary key default gen_random_uuid(), grn_no text unique not null,
  po_id uuid not null references purchase_order(id), vendor_id uuid references vendor(id), wo_id uuid references work_order(id),
  location_id uuid references location(id), received_date date not null default current_date,
  challan_no text, challan_date date, vehicle_no text, vendor_invoice_no text,
  status text not null default 'ACCEPTED' check (status in ('ACCEPTED','PARTIAL_ACCEPTED','REJECTED')),
  remarks text, received_by uuid references employee(id), created_at timestamptz not null default now()
);
create table grn_line (
  id uuid primary key default gen_random_uuid(), grn_id uuid not null references grn(id) on delete cascade,
  po_line_id uuid not null references po_line(id), qty_received numeric(14,3) not null, qty_accepted numeric(14,3) not null,
  qty_rejected numeric(14,3) not null default 0, rate numeric(14,2) not null default 0
);
alter table stock_txn add constraint stock_txn_grn_fk foreign key (grn_id) references grn(id);

create table vendor_bill (
  id uuid primary key default gen_random_uuid(), bill_no text not null,
  vendor_id uuid not null references vendor(id), po_id uuid references purchase_order(id), wo_id uuid references work_order(id), grn_id uuid references grn(id),
  bill_date date not null, due_date date, taxable numeric(16,2) not null, gst numeric(16,2) not null default 0, total numeric(16,2) not null,
  created_by uuid references employee(id), created_at timestamptz not null default now(), unique (vendor_id, bill_no)
);
create table vendor_payment (
  id uuid primary key default gen_random_uuid(), bill_id uuid not null references vendor_bill(id),
  pay_date date not null, amount numeric(16,2) not null check (amount > 0), mode text, reference text,
  created_by uuid references employee(id), created_at timestamptz not null default now()
);

-- Dispatch (documents & photos via attachment(entity='dispatch', doc_type=PHOTO|DELIVERY_CHALLAN|EWAY_BILL|INVOICE|CLIENT_RECEIPT))
create table dispatch (
  id uuid primary key default gen_random_uuid(), dispatch_no text unique not null,
  wo_id uuid not null references work_order(id), dispatch_date date not null default current_date,
  vehicle_no text, transporter text, lr_no text, eway_bill_no text, invoice_no text, delivery_challan_no text,
  freight numeric(14,2) not null default 0,
  status text not null default 'DISPATCHED' check (status in ('DISPATCHED','DELIVERED')),
  delivered_date date, received_by_name text, remarks text,
  created_by uuid references employee(id), created_at timestamptz not null default now()
);
create table dispatch_line (
  id uuid primary key default gen_random_uuid(), dispatch_id uuid not null references dispatch(id) on delete cascade,
  wo_spec_line_id uuid not null references wo_spec_line(id), qty numeric(14,3) not null check (qty > 0)
);

-- Customer invoicing tied to milestones
alter table invoice add column milestone_id uuid references milestone(id);
alter table milestone add column achieved_note text;

-- Employee last known location (check-in/out, login ping)
create table employee_location (
  employee_id uuid primary key references employee(id) on delete cascade,
  lat numeric(10,7) not null, lng numeric(10,7) not null, accuracy_m int,
  source text not null default 'PING', at timestamptz not null default now()
);

-- Tasks: daily templates, evidence, field service with manager-approved report and client OTP
alter table task drop constraint task_status_check;
alter table task add constraint task_status_check check (status in ('TODO','IN_PROGRESS','REPORT_SUBMITTED','AWAITING_CLIENT','DONE','CANCELLED'));
alter table task add column kind text not null default 'GENERAL' check (kind in ('GENERAL','DAILY','FIELD_SERVICE'));
alter table task add column task_date date;
alter table task add column template_id uuid;
alter table task add column customer_id uuid references customer(id);
alter table task add column wo_id uuid references work_order(id);
alter table task add column client_name text;
alter table task add column client_email text;
alter table task add column client_mobile text;
alter table task add column site_address text;
alter table task add column completion_note text;
alter table task add column report_text text;
alter table task add column report_status text not null default 'NONE' check (report_status in ('NONE','SUBMITTED','APPROVED','REJECTED'));
alter table task add column report_approved_by uuid references employee(id);
alter table task add column report_approved_at timestamptz;
alter table task add column client_otp_hash text;
alter table task add column client_otp_expires timestamptz;
alter table task add column client_verified_at timestamptz;
alter table task add column evidence_count int not null default 0;
create table task_template (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id), title text not null, description text,
  weekdays int[] not null default '{1,2,3,4,5,6}',   -- ISO weekday numbers it applies to
  is_active boolean not null default true, created_by uuid references employee(id), created_at timestamptz not null default now()
);
alter table task add constraint task_template_fk foreign key (template_id) references task_template(id);
create unique index task_daily_uq on task(template_id, task_date) where template_id is not null;
create table task_update (
  id uuid primary key default gen_random_uuid(), task_id uuid not null references task(id) on delete cascade,
  kind text not null, body text, created_by uuid references employee(id), created_at timestamptz not null default now()
);
create index on task_update(task_id);

-- Two-step approvals (e.g. expense: reporting manager, then accounts head)
alter table approval add column approver_id uuid references employee(id);
alter table approval add column step int not null default 1;

-- Reporting view: add order kind and GST billed / received
drop view v_wo_pnl;
create view v_wo_pnl as
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
         else 'GREEN' end schedule_rag,
       w.order_kind,
       coalesce(i.gst_billed, 0) gst_billed, coalesce(i.total_billed, 0) total_billed, coalesce(r.received_total, 0) received_total
  from work_order w
  left join (select wo_id, sum(amount) filter (where status = 'POSTED') actual, sum(amount) filter (where status = 'COMMITTED') committed
               from cost_entry where cost_centre = 'WO' group by wo_id) c on c.wo_id = w.id
  left join (select wo_id, sum(taxable) billed, sum(gst) gst_billed, sum(total) total_billed from invoice group by wo_id) i on i.wo_id = w.id
  left join (select i.wo_id, sum(r.amount / (1 + i.gst / nullif(i.taxable, 0))) received, sum(r.amount) received_total
               from receipt r join invoice i on i.id = r.invoice_id group by i.wo_id) r on r.wo_id = w.id;
