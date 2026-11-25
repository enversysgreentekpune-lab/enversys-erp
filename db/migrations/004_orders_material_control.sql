-- Release 3: order classes for the Directors dashboard and cost-sheet material control

-- Every won order is one of: customer Purchase Order (turnkey project), Supply Order (equipment / material supply)
-- or Work Order (services: I&C, O&M, maintenance, consultancy)
alter table work_order add column order_class text generated always as
  (case when wo_type in ('MANUFACTURING','TRADING') then 'SUPPLY'
        when wo_type in ('OM','MAINTENANCE','IC','CONSULTANCY') then 'WO'
        else 'PO' end) stored;

-- Material requisitions: the cost-sheet requisition (created automatically when the order is won)
-- and additional requisitions raised by Purchase that need a proposal head's approval
alter table purchase_requisition add column kind text not null default 'COST_SHEET' check (kind in ('COST_SHEET','ADDITIONAL'));
alter table purchase_requisition add column reason text;
alter table purchase_requisition add column decided_by uuid references employee(id);
alter table purchase_requisition add column decided_at timestamptz;
alter table purchase_requisition add constraint pr_status_chk
  check (status in ('OPEN','PENDING_APPROVAL','APPROVED','REJECTED','PO_RAISED','CLOSED'));
create index on purchase_requisition(wo_id, kind, status);
