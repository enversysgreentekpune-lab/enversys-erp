-- =====================================================================
-- Enversys ERP — core schema (Phase 1 complete, Phase 2/3 anchors)
-- PostgreSQL 14+.  All money in INR (numeric(16,2)), currency column
-- kept on commercial docs for multi-currency readiness.
-- =====================================================================
create extension if not exists pgcrypto;

-- ---------- Organisation & masters ----------------------------------
create table company (
  id uuid primary key default gen_random_uuid(),
  name text not null, legal_name text, gstin text, pan text, cin text,
  address text, phone text, email text, website text,
  bank_details jsonb not null default '{}', logo_key text, letterhead_key text,
  created_at timestamptz not null default now()
);
create table location (
  id uuid primary key default gen_random_uuid(),
  code text unique not null, name text not null,
  kind text not null check (kind in ('HO','FACTORY','SITE','BRANCH')),
  address text, gstin text,
  lat numeric(10,7), lng numeric(10,7), geofence_m int not null default 300,
  shift_start time not null default '09:30', shift_end time not null default '18:00',
  is_active boolean not null default true
);
create table vertical (id uuid primary key default gen_random_uuid(), code text unique not null, name text not null, sort int not null default 0);
create table department (id uuid primary key default gen_random_uuid(), code text unique not null, name text not null);
create table designation (id uuid primary key default gen_random_uuid(), name text unique not null, level int not null default 5);

-- ---------- Access control -------------------------------------------
create table role (
  id uuid primary key default gen_random_uuid(),
  code text unique not null, name text not null,
  is_system boolean not null default false, sort int not null default 100
);
-- one row per role x module x action; scope = data visibility for that action
create table permission (
  role_id uuid not null references role(id) on delete cascade,
  module text not null, action text not null,
  scope text not null check (scope in ('own','team','dept','company')),
  primary key (role_id, module, action)
);

-- ---------- People (employee == user) ---------------------------------
create table employee (
  id uuid primary key default gen_random_uuid(),
  emp_code text unique not null, name text not null,
  mobile text unique not null,               -- login id (10 digits, no +91)
  email text, role_id uuid not null references role(id),
  department_id uuid references department(id), designation_id uuid references designation(id),
  vertical_id uuid references vertical(id), location_id uuid references location(id),
  manager_id uuid references employee(id),
  doj date, dob date, gender text, address text,
  employment_type text not null default 'PERMANENT' check (employment_type in ('PERMANENT','PROBATION','CONTRACT','TRAINEE')),
  monthly_ctc numeric(12,2) not null default 0,
  hourly_cost numeric(10,2) not null default 0,  -- labour costing rate for DWR hours
  pf_no text, esic_no text, uan text, pan text, bank_account text, ifsc text,
  skills text[] not null default '{}',
  pin_hash text, single_device boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on employee(manager_id);

create table otp_request (
  id uuid primary key default gen_random_uuid(),
  mobile text not null, code_hash text not null,
  expires_at timestamptz not null, attempts int not null default 0,
  consumed_at timestamptz, ip text, created_at timestamptz not null default now()
);
create index on otp_request(mobile, created_at desc);

create table user_session (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id) on delete cascade,
  device_id text, device_label text, user_agent text, ip text, method text not null default 'OTP',
  created_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null, revoked_at timestamptz
);
create index on user_session(employee_id);

create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id uuid references employee(id), action text not null,
  entity text not null, entity_id text,
  old_value jsonb, new_value jsonb, ip text, device text
);
create index on audit_log(entity, entity_id);
create index on audit_log(at desc);

-- ---------- Configuration ---------------------------------------------
create table approval_rule (
  id uuid primary key default gen_random_uuid(),
  doc_type text not null check (doc_type in ('QUOTE_DISCOUNT','PURCHASE_ORDER','EXPENSE_CLAIM','LEAVE')),
  min_value numeric(16,2) not null default 0, max_value numeric(16,2),   -- % for discount, INR otherwise
  approver_role text not null, sequence int not null default 1, is_active boolean not null default true
);
create table approval (
  id uuid primary key default gen_random_uuid(),
  entity text not null, entity_id uuid not null, doc_type text not null,
  approver_role text not null, requested_by uuid references employee(id),
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
  value numeric(16,2), decided_by uuid references employee(id), decided_at timestamptz, remarks text,
  created_at timestamptz not null default now()
);
create index on approval(status, approver_role);

create table number_series (
  doc_type text not null, fy text not null, prefix text not null, next_no int not null default 1,
  primary key (doc_type, fy)
);
create table app_setting (key text primary key, value jsonb not null);

create table item (
  id uuid primary key default gen_random_uuid(),
  code text unique not null, description text not null, specification text,
  make text, moc text, uom text not null default 'NOS', hsn text, gst_pct numeric(5,2) not null default 18,
  category text not null default 'BOUGHT_OUT' check (category in ('BOUGHT_OUT','RAW_MATERIAL','FABRICATED','CONSUMABLE','SERVICE')),
  last_purchase_rate numeric(14,2), standard_rate numeric(14,2), preferred_vendor_id uuid,
  reorder_level numeric(12,3), is_active boolean not null default true
);
create table vendor (
  id uuid primary key default gen_random_uuid(),
  code text unique not null, name text not null, gstin text, pan text,
  contact_name text, email text, mobile text, address text, payment_terms text,
  rating numeric(3,1), is_active boolean not null default true
);
alter table item add constraint item_pref_vendor_fk foreign key (preferred_vendor_id) references vendor(id);

create table template (
  id uuid primary key default gen_random_uuid(),
  code text not null, name text not null,
  kind text not null check (kind in ('docx','xlsx','email')),
  storage_key text, subject text, body text,  -- email templates use subject/body with {{merge}} fields
  version int not null default 1, is_active boolean not null default true,
  uploaded_by uuid references employee(id), created_at timestamptz not null default now(),
  unique (code, version)
);

-- ---------- Files ------------------------------------------------------
create table attachment (
  id uuid primary key default gen_random_uuid(),
  entity text not null, entity_id uuid not null,
  folder text,                     -- WO dossier folder e.g. '02 Proposal & Revisions'
  file_name text not null, mime text, size_bytes bigint, storage_key text not null,
  version int not null default 1, doc_type text,
  uploaded_by uuid references employee(id), created_at timestamptz not null default now()
);
create index on attachment(entity, entity_id);

-- ---------- CRM --------------------------------------------------------
create table customer (
  id uuid primary key default gen_random_uuid(),
  code text unique not null, name text not null, group_name text, industry text,
  gstin text, pan text, phone text, email text, website text,
  credit_limit numeric(16,2), payment_terms text,
  owner_id uuid references employee(id), vertical_id uuid references vertical(id),
  source text, rating text check (rating in ('A','B','C')),
  is_active boolean not null default true,
  created_by uuid references employee(id), created_at timestamptz not null default now()
);
create unique index customer_gstin_uq on customer(gstin) where gstin is not null and gstin <> '';
create table customer_address (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customer(id) on delete cascade,
  kind text not null check (kind in ('BILLING','SHIPPING','SITE')),
  line1 text not null, city text, state text, pincode text, is_default boolean not null default false
);
create table contact (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customer(id) on delete cascade,
  name text not null, designation text, email text, mobile text,
  is_decision_maker boolean not null default false
);

create table lead (
  id uuid primary key default gen_random_uuid(),
  enquiry_no text unique not null, enquiry_date date not null default current_date,
  customer_id uuid not null references customer(id), contact_id uuid references contact(id),
  vertical_id uuid not null references vertical(id),
  category text, title text not null, scope text, site_location text,
  est_value numeric(16,2) not null default 0, expected_closure date,
  priority text not null default 'MEDIUM' check (priority in ('LOW','MEDIUM','HIGH','CRITICAL')),
  source text not null default 'MANUAL',
  assigned_to uuid references employee(id),
  stage text not null default 'NEW',
  lost_reason text, competitor_name text, competitor_price numeric(16,2),
  tender_no text, emd_amount numeric(16,2), bid_due_date date, prebid_date date,
  next_followup_at timestamptz,
  created_by uuid references employee(id), created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), stage_changed_at timestamptz not null default now()
);
create index on lead(stage); create index on lead(assigned_to); create index on lead(enquiry_date);

-- generic activity timeline for any record (lead/customer/proposal/wo)
create table activity (
  id uuid primary key default gen_random_uuid(),
  entity text not null, entity_id uuid not null,
  kind text not null, -- STAGE, NOTE, CALL, MEETING, EMAIL_OUT, EMAIL_IN, FOLLOWUP, DOC, STATUS, SYSTEM
  subject text, body text, meta jsonb not null default '{}',
  lat numeric(10,7), lng numeric(10,7),
  created_by uuid references employee(id), created_at timestamptz not null default now()
);
create index on activity(entity, entity_id, created_at desc);

create table email_message (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references lead(id), proposal_id uuid,
  direction text not null check (direction in ('OUT','IN')),
  from_addr text not null, to_addrs text not null, cc_addrs text, subject text not null, body text,
  message_id text unique, in_reply_to text,
  status text not null default 'QUEUED' check (status in ('QUEUED','SENT','DELIVERED','OPENED','FAILED','RECEIVED')),
  error text, attachment_ids uuid[] not null default '{}', opened_at timestamptz,
  sent_by uuid references employee(id), created_at timestamptz not null default now()
);
create index on email_message(lead_id);

-- ---------- Proposals ---------------------------------------------------
create table proposal (
  id uuid primary key default gen_random_uuid(),
  proposal_no text unique not null,
  lead_id uuid not null references lead(id), customer_id uuid not null references customer(id),
  title text not null, currency text not null default 'INR',
  status text not null default 'DRAFT' check (status in ('DRAFT','PENDING_APPROVAL','APPROVED','SUBMITTED','IN_DISCUSSION','IN_NEGOTIATION','WON','LOST','ON_HOLD','CANCELLED')),
  current_rev int not null default 0,
  owner_id uuid references employee(id),
  quoted_value numeric(16,2) not null default 0,   -- net selling (excl GST) of current rev
  quoted_margin_pct numeric(6,2), final_value numeric(16,2), lost_reason text,
  submitted_at timestamptz, decided_at timestamptz,
  created_by uuid references employee(id), created_at timestamptz not null default now()
);
create index on proposal(status);
create table proposal_revision (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references proposal(id) on delete cascade,
  rev_no int not null, notes text,
  params jsonb not null default '{}',   -- contingency/overhead/finance/warranty/margin/discount %, gst mode
  terms jsonb not null default '{}',    -- price basis, validity, payment, delivery, warranty, LD, exclusions, deviations
  totals jsonb not null default '{}',   -- computed snapshot (see lib/costing.ts)
  locked boolean not null default false,
  created_by uuid references employee(id), created_at timestamptz not null default now(),
  unique (proposal_id, rev_no)
);
create table spec_line (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references proposal_revision(id) on delete cascade,
  sl int not null, item_code text, description text not null, specification text,
  make text, moc text, size_rating text, standard text,
  qty numeric(14,3) not null default 1, uom text not null default 'NOS',
  drawing_ref text, remarks text, hsn text, gst_pct numeric(5,2) not null default 18,
  is_fabricated boolean not null default false
);
create table cost_line (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references proposal_revision(id) on delete cascade,
  spec_sl int,  -- links to spec_line.sl in the same revision (null = common cost)
  category text not null, description text not null,
  qty numeric(14,3) not null default 1, uom text, rate numeric(14,2) not null default 0,
  rate_source text, amount numeric(16,2) not null default 0
);
create table generated_document (
  id uuid primary key default gen_random_uuid(),
  entity text not null, entity_id uuid not null, template_code text not null,
  attachment_id uuid not null references attachment(id),
  created_by uuid references employee(id), created_at timestamptz not null default now()
);

-- ---------- Orders / Work Orders -----------------------------------------
create table customer_po (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid references proposal(id), customer_id uuid not null references customer(id),
  po_no text not null, po_date date not null, po_value numeric(16,2) not null,
  agreed_changes text, attachment_id uuid references attachment(id),
  created_by uuid references employee(id), created_at timestamptz not null default now()
);
create table work_order (
  id uuid primary key default gen_random_uuid(),
  wo_no text unique not null,
  wo_type text not null check (wo_type in ('PROJECT','MANUFACTURING','IC','OM','MAINTENANCE','CONSULTANCY','TRADING')),
  title text not null, customer_id uuid not null references customer(id),
  vertical_id uuid not null references vertical(id),
  proposal_id uuid references proposal(id), customer_po_id uuid references customer_po(id),
  contract_value numeric(16,2) not null, budget_cost numeric(16,2) not null default 0,
  quoted_margin_pct numeric(6,2),
  status text not null default 'KICKOFF' check (status in ('KICKOFF','IN_PROGRESS','ON_HOLD','COMPLETED','CLOSED','CANCELLED')),
  pct_complete numeric(5,2) not null default 0,
  start_date date, end_date date, has_fabrication boolean not null default false,
  site_location text, terms jsonb not null default '{}',
  created_by uuid references employee(id), created_at timestamptz not null default now()
);
create table wo_team (
  wo_id uuid not null references work_order(id) on delete cascade,
  employee_id uuid not null references employee(id),
  team_role text not null check (team_role in ('PM','EXECUTOR','SUPPORT')),
  primary key (wo_id, employee_id, team_role)
);
create table wo_budget_line (
  id uuid primary key default gen_random_uuid(),
  wo_id uuid not null references work_order(id) on delete cascade,
  category text not null, description text, amount numeric(16,2) not null
);
create table wo_spec_line (  -- frozen final material spec carried from proposal
  id uuid primary key default gen_random_uuid(),
  wo_id uuid not null references work_order(id) on delete cascade,
  sl int not null, item_code text, description text not null, specification text, make text, moc text,
  size_rating text, standard text, qty numeric(14,3) not null, uom text not null, drawing_ref text,
  is_fabricated boolean not null default false, unit_cost numeric(14,2) not null default 0
);
create table milestone (
  id uuid primary key default gen_random_uuid(),
  wo_id uuid not null references work_order(id) on delete cascade,
  name text not null, kind text not null default 'PAYMENT' check (kind in ('PAYMENT','DELIVERY','EXECUTION')),
  pct numeric(5,2), amount numeric(16,2), due_date date,
  status text not null default 'PENDING' check (status in ('PENDING','DONE','INVOICED','DELAYED')),
  done_at date
);

-- ---------- Purchase (Phase 2 anchor; auto PR + draft PO used in Phase 1 flow)
create table purchase_requisition (
  id uuid primary key default gen_random_uuid(), pr_no text unique not null,
  wo_id uuid not null references work_order(id), status text not null default 'OPEN',
  created_by uuid references employee(id), created_at timestamptz not null default now()
);
create table pr_line (
  id uuid primary key default gen_random_uuid(),
  pr_id uuid not null references purchase_requisition(id) on delete cascade,
  route text not null check (route in ('VENDOR','MARKAL')),
  item_code text, description text not null, specification text, qty numeric(14,3) not null, uom text not null,
  budget_rate numeric(14,2) not null default 0, required_by date
);
create table purchase_order (
  id uuid primary key default gen_random_uuid(), po_no text unique not null,
  wo_id uuid not null references work_order(id), pr_id uuid references purchase_requisition(id),
  vendor_id uuid references vendor(id),
  status text not null default 'DRAFT' check (status in ('DRAFT','PENDING_APPROVAL','APPROVED','SENT','PARTIAL','RECEIVED','CLOSED','CANCELLED')),
  po_date date not null default current_date, delivery_date date, terms text,
  total numeric(16,2) not null default 0, gst_total numeric(16,2) not null default 0,
  created_by uuid references employee(id), approved_by uuid references employee(id), created_at timestamptz not null default now()
);
create table po_line (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_order(id) on delete cascade,
  item_code text, description text not null, specification text,
  qty numeric(14,3) not null, uom text not null, rate numeric(14,2) not null, gst_pct numeric(5,2) not null default 18,
  budget_rate numeric(14,2) not null default 0
);

-- ---------- Cost ledger (THE profitability spine) -------------------------
create table cost_entry (
  id uuid primary key default gen_random_uuid(),
  cost_centre text not null check (cost_centre in ('WO','OFFICE_ADMIN','FACTORY_ADMIN')),
  wo_id uuid references work_order(id),
  category text not null,   -- MATERIAL, LABOUR, FABRICATION, SUBCONTRACT, FREIGHT, SITE_EXP, TRAVEL, ADMIN ...
  expense_head text,        -- for admin centres: RENT, ELECTRICITY, ...
  description text, amount numeric(16,2) not null, gst_amount numeric(16,2) not null default 0,
  entry_date date not null default current_date,
  source_type text not null default 'MANUAL', source_id uuid,
  vendor_id uuid references vendor(id), bill_attachment_id uuid references attachment(id),
  status text not null default 'POSTED' check (status in ('COMMITTED','POSTED','PENDING_APPROVAL','REJECTED')),
  created_by uuid references employee(id), created_at timestamptz not null default now(),
  constraint cost_entry_one_centre check ((cost_centre = 'WO') = (wo_id is not null))
);
create index on cost_entry(wo_id); create index on cost_entry(cost_centre, entry_date);

create table budget (
  id uuid primary key default gen_random_uuid(),
  cost_centre text not null check (cost_centre in ('OFFICE_ADMIN','FACTORY_ADMIN')),
  expense_head text not null, fy text not null, month int not null check (month between 1 and 12),
  amount numeric(16,2) not null, unique (cost_centre, expense_head, fy, month)
);

-- invoices/receipts: minimal Phase 1 anchor so MD KPIs work; full finance in Phase 3
create table invoice (
  id uuid primary key default gen_random_uuid(), invoice_no text unique not null,
  wo_id uuid references work_order(id), customer_id uuid not null references customer(id),
  invoice_date date not null, due_date date, taxable numeric(16,2) not null, gst numeric(16,2) not null default 0,
  total numeric(16,2) not null, status text not null default 'ISSUED', created_at timestamptz not null default now()
);
create table receipt (
  id uuid primary key default gen_random_uuid(), invoice_id uuid not null references invoice(id),
  receipt_date date not null, amount numeric(16,2) not null, mode text
);

-- ---------- Work management --------------------------------------------
create table task (
  id uuid primary key default gen_random_uuid(),
  title text not null, description text,
  entity text, entity_id uuid, link text,
  assigned_to uuid not null references employee(id), created_by uuid references employee(id),
  due_at timestamptz, priority text not null default 'MEDIUM',
  status text not null default 'TODO' check (status in ('TODO','IN_PROGRESS','DONE','CANCELLED')),
  escalation_level int not null default 0, done_at timestamptz,
  created_at timestamptz not null default now()
);
create index on task(assigned_to, status);

create table dwr (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id), report_date date not null,
  summary text, issues text, submitted_at timestamptz not null default now(),
  unique (employee_id, report_date)
);
create table dwr_line (
  id uuid primary key default gen_random_uuid(),
  dwr_id uuid not null references dwr(id) on delete cascade,
  wo_id uuid references work_order(id), hours numeric(5,2) not null check (hours > 0 and hours <= 24),
  description text
);

-- ---------- Time office -------------------------------------------------
create table attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id), att_date date not null,
  location_id uuid references location(id),
  check_in timestamptz, check_out timestamptz,
  in_lat numeric(10,7), in_lng numeric(10,7), out_lat numeric(10,7), out_lng numeric(10,7),
  in_distance_m int, selfie_key text,
  source text not null default 'GEO' check (source in ('GEO','BIOMETRIC','MANUAL')),
  status text not null default 'P' check (status in ('P','A','HD','L','OD','WO','H')),
  is_late boolean not null default false, ot_hours numeric(5,2) not null default 0,
  remarks text, locked boolean not null default false,
  updated_by uuid references employee(id),
  unique (employee_id, att_date)
);
create index on attendance(att_date);
create table attendance_lock (month text primary key, locked_by uuid references employee(id), locked_at timestamptz not null default now());
create table holiday (id uuid primary key default gen_random_uuid(), location_id uuid references location(id), hdate date not null, name text not null);
create table leave_type (code text primary key, name text not null, annual_quota numeric(5,1) not null);
create table leave_request (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id), leave_type text not null references leave_type(code),
  from_date date not null, to_date date not null, days numeric(5,1) not null, reason text,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED','CANCELLED')),
  approver_id uuid references employee(id), decided_at timestamptz, created_at timestamptz not null default now()
);

create table notification (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id), title text not null, body text, link text,
  read_at timestamptz, created_at timestamptz not null default now()
);
create index on notification(employee_id, read_at);
