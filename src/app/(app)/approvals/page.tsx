import Link from "next/link";
import { requireUser, can } from "@/lib/auth";
import { q } from "@/lib/db";
import { inr, dtm, label } from "@/lib/format";
import { PageHeader, Card, Table, Badge, Empty } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { decideApprovalAction } from "@/app/actions/approvals";
import { decideLeaveAction } from "@/app/actions/me";
import { canApproveAs } from "@/lib/workflow";

export const metadata = { title: "Approvals" };
export default async function Approvals() {
  const u = await requireUser();
  const pending = (await q(`select a.*, e.name req, p.proposal_no, p.title p_title, p.quoted_value, p.quoted_margin_pct, po.po_no, po.total po_total, coalesce(w.wo_no, cw.wo_no) wo_no, l.vertical_id, ce.description ce_desc, ce.amount ce_amount, ce.cost_centre, ce.bill_attachment_id
      from approval a left join employee e on e.id=a.requested_by left join proposal p on a.entity='proposal' and p.id=a.entity_id left join lead l on l.id=p.lead_id
      left join purchase_order po on a.entity='purchase_order' and po.id=a.entity_id left join work_order w on w.id=po.wo_id
      left join cost_entry ce on a.entity='cost_entry' and ce.id=a.entity_id left join work_order cw on cw.id=ce.wo_id
      where a.status='PENDING' order by a.created_at`)).filter((a) => canApproveAs(u.roleCode, a.approver_role) && (u.roleCode !== "BUSINESS_HEAD" || !a.vertical_id || a.vertical_id === u.verticalId));
  const leaves = await q(`select lr.*, e.name from leave_request lr join employee e on e.id=lr.employee_id where lr.status='PENDING' and (lr.approver_id=$1 or $2) order by lr.created_at`, [u.id, can(u, "hr", "approve") === "company"]);
  const history = await q(`select a.*, coalesce(p.proposal_no, po.po_no, 'Expense claim') ref from approval a left join proposal p on p.id=a.entity_id left join purchase_order po on po.id=a.entity_id where a.decided_by=$1 order by a.decided_at desc limit 20`, [u.id]);
  const costView = !!can(u, "costing", "view");
  return (
    <div>
      <PageHeader title="Approvals" subtitle="Items awaiting your decision as per the approval matrix" />
      <Card title={`Pending (${pending.length})`} bodyClass="p-0" className="mb-4">
        {pending.length ? <Table head={["Document", "Type", "Value", "Requested by", "Since", "Decision"]}>
          {pending.map((a) => (
            <tr key={a.id}>
              <td>{a.entity === "proposal" ? <Link className="link font-medium" href={`/proposals/${a.entity_id}`}>{a.proposal_no}</Link> : a.entity === "purchase_order" ? <Link className="link font-medium" href={`/purchase/${a.entity_id}`}>{a.po_no}</Link> : <span className="font-medium">Expense claim{a.bill_attachment_id && <> · <a className="link" href={`/api/files/${a.bill_attachment_id}`}>bill</a></>}</span>}<div className="text-xs text-slate-500">{a.p_title ?? a.ce_desc ?? ""} {a.wo_no ?? (a.cost_centre ? label(a.cost_centre) : "")}</div></td>
              <td>{label(a.doc_type)}<div className="text-xs text-slate-500">as {label(a.approver_role)}</div></td>
              <td className="num">{a.entity === "proposal" ? <>{inr(a.quoted_value)}<div className="text-xs text-slate-500">disc {a.value}%{costView && ` · margin ${a.quoted_margin_pct}%`}</div></> : inr(a.po_total ?? a.ce_amount)}</td>
              <td>{a.req}</td><td>{dtm(a.created_at)}</td>
              <td>
                <ActionForm action={decideApprovalAction} hideSubmit className="flex flex-wrap items-center gap-1">
                  <input type="hidden" name="id" value={a.id} />
                  <input name="remarks" placeholder="Remarks (required to reject)" className="input w-48" />
                  <button name="decision" value="APPROVE" className="btn-primary btn-sm">Approve</button>
                  <button name="decision" value="REJECT" className="btn-danger btn-sm">Reject</button>
                </ActionForm>
              </td>
            </tr>
          ))}
        </Table> : <Empty>Nothing pending 🎉</Empty>}
      </Card>
      {leaves.length > 0 && (
        <Card title={`Leave requests (${leaves.length})`} bodyClass="p-0" className="mb-4">
          <Table head={["Employee", "Type", "From", "To", "Days", "Reason", ""]}>
            {leaves.map((l) => <tr key={l.id}><td>{l.name}</td><td>{l.leave_type}</td><td>{l.from_date}</td><td>{l.to_date}</td><td>{l.days}</td><td>{l.reason}</td>
              <td><ActionForm action={decideLeaveAction} hideSubmit className="flex gap-1"><input type="hidden" name="id" value={l.id} /><button name="decision" value="APPROVE" className="btn-primary btn-sm">Approve</button><button name="decision" value="REJECT" className="btn-secondary btn-sm">Reject</button></ActionForm></td></tr>)}
          </Table>
        </Card>
      )}
      <Card title="My recent decisions" bodyClass="p-0">
        {history.length ? <Table head={["Document", "Type", "Decision", "When", "Remarks"]}>{history.map((h) => <tr key={h.id}><td>{h.ref}</td><td>{label(h.doc_type)}</td><td><Badge status={h.status} /></td><td>{dtm(h.decided_at)}</td><td>{h.remarks}</td></tr>)}</Table> : <Empty>No decisions yet</Empty>}
      </Card>
    </div>
  );
}
