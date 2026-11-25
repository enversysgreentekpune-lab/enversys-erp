-- Release 4: Installation & Commissioning (after dispatch) and O&M field operations

-- ---------- I&C: every dispatched project gets an I&C record automatically
create table ic_project (
  id uuid primary key default gen_random_uuid(),
  wo_id uuid not null unique references work_order(id) on delete cascade,
  status text not null default 'NOT_STARTED' check (status in ('NOT_STARTED','IN_PROGRESS','HANDOVER_PENDING','COMPLETED')),
  stage text not null default 'MATERIAL_AT_SITE',
  pct numeric(5,2) not null default 0,
  engineer_id uuid references employee(id),
  site_address text, start_date date, target_date date,
  observations text,                          -- punch points / pending points for the handover report
  docs_generated_at timestamptz, docs_sent_at timestamptz, docs_sent_to text,
  handover_signed_id uuid references attachment(id),
  appreciation_signed_id uuid references attachment(id),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create table ic_update (
  id uuid primary key default gen_random_uuid(),
  ic_id uuid not null references ic_project(id) on delete cascade,
  update_date date not null default current_date,
  stage text not null, pct numeric(5,2) not null,
  activity text not null, manpower int, issues text,
  client_signed boolean not null default false, client_rep text,
  created_by uuid references employee(id), created_at timestamptz not null default now()
);
create index on ic_update(ic_id, update_date);

insert into ic_project(wo_id, status)
select distinct d.wo_id, 'NOT_STARTED' from dispatch d on conflict do nothing;

-- ---------- O&M sites and staff
create table om_site (
  id uuid primary key default gen_random_uuid(),
  code text unique not null, name text not null,
  customer_id uuid not null references customer(id), wo_id uuid references work_order(id),
  location_id uuid references location(id),
  plant_type text not null default 'STP', capacity_kld numeric(10,2),
  required_manpower int not null default 2,
  supervisor_id uuid references employee(id),
  client_contact text, client_email text, client_mobile text,
  is_active boolean not null default true, created_at timestamptz not null default now()
);
create table om_site_staff (
  site_id uuid not null references om_site(id) on delete cascade,
  employee_id uuid not null references employee(id),
  duty text not null default 'OPERATOR' check (duty in ('OPERATOR','SUPERVISOR','HELPER')),
  primary key (site_id, employee_id)
);

-- ---------- Daily operator log: presence, water treated, energy, operation status
create table om_daily_log (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references om_site(id) on delete cascade,
  log_date date not null,
  operator_id uuid references employee(id),
  present_ids uuid[] not null default '{}',     -- site staff present today
  present_count int not null default 0,
  water_treated_m3 numeric(12,2) not null default 0,
  energy_kwh numeric(12,2) not null default 0,
  operation_status text not null default 'NORMAL' check (operation_status in ('NORMAL','ISSUE','SHUTDOWN')),
  issue_note text,
  inlet_ph numeric(4,2), outlet_ph numeric(4,2), outlet_tss numeric(8,2), outlet_bod numeric(8,2), outlet_cod numeric(8,2),
  remarks text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (site_id, log_date)
);
create table om_chemical_use (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references om_daily_log(id) on delete cascade,
  chemical text not null, qty numeric(12,3) not null, uom text not null default 'KG'
);

-- ---------- Spares register per site
create table om_spare (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references om_site(id) on delete cascade,
  name text not null, part_no text, uom text not null default 'NOS',
  qty numeric(12,3) not null default 0, min_qty numeric(12,3) not null default 0,
  unique (site_id, name)
);
create table om_spare_txn (
  id uuid primary key default gen_random_uuid(),
  spare_id uuid not null references om_spare(id) on delete cascade,
  txn_date date not null default current_date, kind text not null check (kind in ('IN','OUT')),
  qty numeric(12,3) not null check (qty > 0), note text,
  created_by uuid references employee(id), created_at timestamptz not null default now()
);

-- ---------- Material & service requisitions from site
create table om_requisition (
  id uuid primary key default gen_random_uuid(),
  req_no text unique not null,
  site_id uuid not null references om_site(id) on delete cascade,
  kind text not null check (kind in ('MATERIAL','SERVICE')),
  lines jsonb not null default '[]',            -- [{description, qty, uom}]
  reason text not null,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED','FULFILLED')),
  raised_by uuid references employee(id), decided_by uuid references employee(id), decided_at timestamptz, decision_note text,
  created_at timestamptz not null default now()
);

-- ---------- Tickets (raised by operator or by client)
create table om_ticket (
  id uuid primary key default gen_random_uuid(),
  ticket_no text unique not null,
  site_id uuid not null references om_site(id) on delete cascade,
  source text not null check (source in ('OPERATOR','CLIENT')),
  raised_by uuid references employee(id), client_name text,
  category text not null default 'OPERATION' check (category in ('OPERATION','EQUIPMENT','WATER_QUALITY','MANPOWER','SAFETY','OTHER')),
  priority text not null default 'MEDIUM' check (priority in ('LOW','MEDIUM','HIGH','CRITICAL')),
  title text not null, description text,
  status text not null default 'OPEN' check (status in ('OPEN','IN_PROGRESS','RESOLVED','CLOSED')),
  assigned_to uuid references employee(id),
  resolution text, resolved_at timestamptz, closed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on om_ticket(site_id, status);

-- ---------- Site visit reports and monthly reports submitted to the client
create table om_report (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references om_site(id) on delete cascade,
  kind text not null check (kind in ('MONTHLY','VISIT')),
  period text,                                   -- YYYY-MM for monthly
  visit_date date, visited_by uuid references employee(id),
  observations text, recommendations text,
  attachment_id uuid references attachment(id),
  submitted_at timestamptz, submitted_to text, submitted_by uuid references employee(id),
  created_at timestamptz not null default now()
);
