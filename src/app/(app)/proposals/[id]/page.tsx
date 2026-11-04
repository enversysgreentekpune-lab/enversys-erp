import Link from "next/link";
import { requireUser, can } from "@/lib/auth";
import { q, one } from "@/lib/db";
import { loadProposal } from "@/lib/access";
import { inr, dt, dtm, label } from "@/lib/format";
import { PageHeader, Card, Badge, Table, Tabs, Field, Empty } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { EmailComposer } from "@/components/EmailComposer";
import { RevisionEditor } from "./RevisionEditor";
import { StatusForm } from "./StatusForm";
import { newRevisionAction, submitApprovalAction, generateDocsAction, markWonAction, importSpecAction } from "@/app/actions/proposals";
import { decideApprovalAction } from "@/app/actions/approvals";
import { LOST_REASONS, WO_TYPES, canApproveAs } from "@/lib/workflow";
import { DEFAULT_PARAMS } from "@/lib/costing";
import { fill } from "@/lib/email";

export default async function ProposalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; a?: string; b?: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const p = await loadProposal(u, id);
  const showCost = !!can(u, "costing", "view");
  const tab = sp.tab ?? "spec";
  const [lead, cust, rev, revs, spec, cost, items, docs, approvals, contacts, tpls, pms, execs, wo] = await Promise.all([
    one(`select * from lead where id=$1`, [p.lead_id]), one(`select * from customer where id=$1`, [p.customer_id]),
    one(`select * from proposal_revision where proposal_id=$1 and rev_no=$2`, [id, p.current_rev]),
    q(`select r.*, e.name by_name from proposal_revision r left join employee e on e.id=r.created_by where proposal_id=$1 order by rev_no desc`, [id]),
    q(`select s.* from spec_line s join proposal_revision r on r.id=s.revision_id where r.proposal_id=$1 and r.rev_no=$2 order by sl`, [id, p.current_rev]),
    showCost ? q(`select c.* from cost_line c join proposal_revision r on r.id=c.revision_id where r.proposal_id=$1 and r.rev_no=$2 order by spec_sl nulls last, category`, [id, p.current_rev]) : Promise.resolve([]),
    q(`select code, description, specification, make, moc, uom, hsn, gst_pct, last_purchase_rate, standard_rate, category from item where is_active order by code`),
    q(`select * from attachment where entity='proposal' and entity_id=$1 order by created_at desc`, [id]),
    q(`select a.*, r.name req, d.name dec from approval a left join employee r on r.id=a.requested_by left join employee d on d.id=a.decided_by where entity='proposal' and entity_id=$1 order by created_at desc`, [id]),
    q(`select name, email from contact where customer_id=$1 and email is not null`, [p.customer_id]),
    q(`select code, name, subject, body from template where kind='email' and is_active`),
    q(`select e.id, e.name from employee e join role r on r.id=e.role_id where r.code in ('PROJECT_MANAGER','OM_MANAGER','FACTORY_MANAGER') and e.is_active order by e.name`),
    q(`select e.id, e.name, r.name role from employee e join role r on r.id=e.role_id where r.code in ('SITE_ENGINEER','PRODUCTION_SUPERVISOR','IC_ENGINEER','OM_TECHNICIAN','QA_INSPECTOR') and e.is_active order by e.name`),
    one(`select id, wo_no from work_order where proposal_id=$1`, [id]),
  ]);
  const edit = !!can(u, "leads", "edit") && !rev.locked && ["DRAFT", "IN_DISCUSSION", "IN_NEGOTIATION", "ON_HOLD"].includes(p.status);
  const t = rev.totals ?? {};
  const pending = approvals.find((a) => a.status === "PENDING");
  const contact = lead.contact_id ? await one(`select * from contact where id=$1`, [lead.contact_id]) : null;
  const merge = { lead: { ...lead, date: dt(lead.enquiry_date) }, customer: cust, contact: contact ?? { name: "Sir/Madam" }, user: u, proposal: { no: p.proposal_no, rev: `R${p.current_rev}`, title: p.title } };
  const rendered = tpls.map((x) => ({ ...x, subject: fill(x.subject ?? "", merge), body: fill(x.body ?? "", merge) }));
  const latestGen = ["QUOTE_DOCX", "QUOTE_XLSX"].map((c) => docs.find((d) => d.doc_type === c && d.file_name.includes(`-R${p.current_rev} `))).filter(Boolean).map((d) => d!.id);
  const canWin = ["SUBMITTED", "IN_DISCUSSION", "IN_NEGOTIATION", "APPROVED", "ON_HOLD"].includes(p.status) && !!can(u, "leads", "approve");
  const statusOpts: Record<string, string[]> = { APPROVED: ["SUBMITTED", "CANCELLED"], SUBMITTED: ["IN_DISCUSSION", "IN_NEGOTIATION", "LOST", "ON_HOLD"], IN_DISCUSSION: ["IN_NEGOTIATION", "LOST", "ON_HOLD"], IN_NEGOTIATION: ["IN_DISCUSSION", "LOST", "ON_HOLD"], ON_HOLD: ["IN_DISCUSSION", "IN_NEGOTIATION", "LOST", "CANCELLED"], DRAFT: ["CANCELLED"] };
  const tabs = [
    { key: "spec", label: `Material spec (${spec.length})` }, ...(showCost ? [{ key: "cost", label: "Cost sheet" }] : []), { key: "terms", label: "Commercial terms" },
    { key: "docs", label: `Documents (${docs.length})` }, { key: "send", label: "Send to customer" }, { key: "revisions", label: `Revisions (${revs.length})` }, { key: "approvals", label: "Approvals" },
    ...(canWin ? [{ key: "won", label: "✓ Mark as Won" }] : []),
  ];
  return (
    <div>
      <PageHeader back={{ href: `/leads/${lead.id}`, label: `${lead.enquiry_no}` }} title={<>{p.proposal_no} <span className="text-slate-400">R{p.current_rev}</span></>}
        subtitle={<span className="flex flex-wrap items-center gap-2">{p.title} · <Link className="link" href={`/customers/${cust.id}`}>{cust.name}</Link> · <Badge status={p.status} />{rev.locked && <Badge tone="gray">🔒 R{p.current_rev} locked</Badge>}{wo && <Link href={`/work-orders/${wo.id}`} className="link">→ {wo.wo_no}</Link>}</span>}
        actions={<>
          {p.status === "DRAFT" && can(u, "leads", "edit") && <ActionForm action={submitApprovalAction} hideSubmit><input type="hidden" name="id" value={id} /><button className="btn-primary">Submit for internal approval</button></ActionForm>}
          {["IN_DISCUSSION", "IN_NEGOTIATION"].includes(p.status) && !rev.locked && can(u, "leads", "edit") && <ActionForm action={submitApprovalAction} hideSubmit><input type="hidden" name="id" value={id} /><button className="btn-primary">Re-approve R{p.current_rev}</button></ActionForm>}
          {pending && canApproveAs(u.roleCode, pending.approver_role) && <>
            <ActionForm action={decideApprovalAction} hideSubmit><input type="hidden" name="id" value={pending.id} /><input type="hidden" name="decision" value="APPROVE" /><button className="btn-primary">Approve</button></ActionForm>
            <Link href="/approvals" className="btn-secondary">Reject…</Link></>}
        </>} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="card p-3"><div className="text-[11px] uppercase text-slate-500">Net (excl. GST)</div><div className="font-semibold">{inr(t.netSelling)}</div></div>
        <div className="card p-3"><div className="text-[11px] uppercase text-slate-500">Grand total</div><div className="font-semibold">{inr(t.grandTotal)}</div></div>
        <div className="card p-3"><div className="text-[11px] uppercase text-slate-500">Margin</div><div className="font-semibold">{showCost ? `${t.marginPct ?? 0}%` : "•••"}</div></div>
        <div className="card p-3"><div className="text-[11px] uppercase text-slate-500">Discount</div><div className="font-semibold">{rev.params?.discount_pct ?? 0}%</div></div>
        <div className="card p-3"><div className="text-[11px] uppercase text-slate-500">{p.status === "WON" ? "Final PO value" : "Submitted"}</div><div className="font-semibold">{p.status === "WON" ? inr(p.final_value) : dt(p.submitted_at)}</div></div>
      </div>
      {pending && <div className="mb-4 rounded-lg bg-violet-50 p-3 text-sm text-violet-900 dark:bg-violet-900/20 dark:text-violet-200">Awaiting internal approval by <b>{label(pending.approver_role)}</b> (discount {pending.value}%), requested by {pending.req} on {dtm(pending.created_at)}.</div>}

      <Tabs tabs={tabs} active={tab} base={`/proposals/${id}`} />
      {["spec", "cost", "terms"].includes(tab) && (
        <>
          {!edit && ["SUBMITTED", "IN_DISCUSSION", "IN_NEGOTIATION", "APPROVED", "ON_HOLD", "PENDING_APPROVAL"].includes(p.status) && can(u, "leads", "edit") && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-900/20">
              R{p.current_rev} is locked. To change scope or price, create a new revision (it will need re-approval).
              <ActionForm action={newRevisionAction} hideSubmit className="flex gap-2"><input type="hidden" name="id" value={id} /><input name="notes" placeholder="Reason for revision" className="input w-64" required /><button className="btn-secondary">Create R{p.current_rev + 1}</button></ActionForm>
            </div>
          )}
          <RevisionEditor key={rev.id + tab} section={tab as any} revisionId={rev.id} editable={edit} showCost={showCost} canEditCost={!!can(u, "costing", "edit")} canMargin={!!can(u, "costing", "approve")}
            initial={{ spec: spec.map((s) => ({ ...s, qty: Number(s.qty), gst_pct: Number(s.gst_pct) })), cost: cost.map((c) => ({ ...c, qty: Number(c.qty), rate: Number(c.rate) })), params: { ...DEFAULT_PARAMS, ...rev.params }, terms: rev.terms ?? {} }} items={items} />
          {tab === "spec" && edit && (
            <Card title="Import / export material specification" className="mt-4">
              <div className="flex flex-wrap items-end gap-4">
                <ActionForm action={importSpecAction} submitLabel="Import & replace lines" submitClass="btn-secondary"><input type="hidden" name="revision_id" value={rev.id} /><input type="file" name="file" accept=".xlsx" className="text-sm" /></ActionForm>
                <a className="btn-ghost" href={`/api/export/spec?proposal=${id}`}>Download spec sheet (.xlsx)</a>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">Columns: Sl · Item code · Description · Specification · Make · MOC · Size/Rating · Standard · Qty · UOM · Drawing ref · Remarks · GST%.</p>
            </Card>
          )}
        </>
      )}
      {tab === "docs" && (
        <Card title="Quote documents" actions={<a className="btn-ghost btn-sm" href={`/proposals/${id}/print`} target="_blank">Print / PDF view</a>}>
          {["APPROVED", "SUBMITTED", "IN_DISCUSSION", "IN_NEGOTIATION", "WON", "ON_HOLD"].includes(p.status) ? (
            <ActionForm action={generateDocsAction} submitLabel={`Generate Word + Excel for R${p.current_rev}`} className="mb-4"><input type="hidden" name="id" value={id} />
              <div className="flex gap-4 text-sm"><label><input type="checkbox" name="kind" value="docx" defaultChecked /> Techno-commercial offer (.docx)</label><label><input type="checkbox" name="kind" value="xlsx" defaultChecked /> Price schedule / BOQ (.xlsx)</label></div>
            </ActionForm>
          ) : <p className="mb-4 text-sm text-amber-700">Customer documents can be generated once R{p.current_rev} is internally approved.</p>}
          {docs.length ? <Table head={["File", "Type", "Version", "Created"]}>{docs.map((d) => <tr key={d.id}><td><a className="link" href={`/api/files/${d.id}`}>{d.file_name}</a></td><td>{d.doc_type ?? d.folder}</td><td>v{d.version}</td><td>{dtm(d.created_at)}</td></tr>)}</Table> : <Empty>No documents generated yet</Empty>}
        </Card>
      )}
      {tab === "send" && (
        ["APPROVED", "SUBMITTED", "IN_DISCUSSION", "IN_NEGOTIATION", "ON_HOLD"].includes(p.status) && can(u, "leads", "send") ? (
          <Card title="Email offer to customer">
            {!latestGen.length && <p className="mb-2 text-sm text-amber-700">Tip: generate the Word & Excel documents for R{p.current_rev} first (Documents tab) — they will be pre-selected here.</p>}
            <EmailComposer leadId={lead.id} proposalId={id} contacts={contacts} templates={rendered} attachments={docs} defaultTemplate="EMAIL_QUOTE" markSubmitted={p.status === "APPROVED"} preselect={latestGen} />
            {p.status === "APPROVED" && <p className="mt-2 text-xs text-slate-500">Sending will move the proposal to <b>Submitted</b> and the lead to <b>Proposal Submitted</b>.</p>}
          </Card>
        ) : <Card><Empty>The offer can be sent after internal approval.</Empty></Card>
      )}
      {tab === "revisions" && <Revisions revs={revs} id={id} a={sp.a} b={sp.b} showCost={showCost} />}
      {tab === "approvals" && (
        <Card bodyClass="p-0">
          {approvals.length ? <Table head={["Requested", "By", "Approver role", "Discount", "Status", "Decided by", "Remarks"]}>{approvals.map((a) => <tr key={a.id}><td>{dtm(a.created_at)}</td><td>{a.req}</td><td>{label(a.approver_role)}</td><td>{a.value}%</td><td><Badge status={a.status} /></td><td>{a.dec ?? "—"} {a.decided_at && <span className="text-xs text-slate-500">{dtm(a.decided_at)}</span>}</td><td>{a.remarks}</td></tr>)}</Table> : <Empty>No approval requests yet</Empty>}
        </Card>
      )}
      {tab === "won" && canWin && (
        <Card title="Order won — record customer PO and create Work Order">
          <ActionForm action={markWonAction} submitLabel="Mark Won & create Work Order" confirm="Create the Work Order now? The cost sheet becomes the WO budget and specs go to Purchase.">
            <input type="hidden" name="id" value={id} />
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Customer PO / LOI no. *"><input name="po_no" required className="input" /></Field>
              <Field label="PO date *"><input type="date" name="po_date" required className="input" /></Field>
              <Field label="PO value excl. GST (₹) *"><input name="po_value" required defaultValue={Math.round(t.netSelling ?? 0)} className="input" /></Field>
              <Field label="Order type *"><select name="wo_type" className="input" defaultValue={lead.vertical_id ? undefined : "PROJECT"}>{WO_TYPES.map((w) => <option key={w} value={w}>{label(w)}</option>)}</select></Field>
              <Field label="Project manager (accountable)"><select name="pm_id" className="input"><option value="">—</option>{pms.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
              <Field label="Executor(s) / site engineer(s)" className="sm:col-span-2"><select name="executors" multiple className="input h-24">{execs.map((m) => <option key={m.id} value={m.id}>{m.name} – {m.role}</option>)}</select></Field>
              <div className="grid gap-3"><Field label="Start date"><input type="date" name="start_date" className="input" /></Field><Field label="Contract completion"><input type="date" name="end_date" className="input" /></Field></div>
              <Field label="Agreed changes vs offer" className="sm:col-span-3"><textarea name="changes" className="input" /></Field>
              <Field label="Upload customer PO / LOI"><input type="file" name="po_file" className="text-sm" /></Field>
            </div>
            <p className="mt-3 text-xs text-slate-500">On confirmation: WO number is generated · final cost sheet becomes the WO budget baseline · material spec flows to Purchase as a PR with auto-drafted vendor POs · fabrication lines route to Markal Factory · Business Head, PM, Purchase, Factory and Accounts are notified with kick-off tasks.</p>
          </ActionForm>
        </Card>
      )}
      {statusOpts[p.status] && can(u, "leads", "edit") && !["spec", "cost", "terms", "won"].includes(tab) && (
        <Card title="Update proposal status" className="mt-4 max-w-md"><StatusForm id={id} options={statusOpts[p.status].map((c) => ({ code: c, label: label(c) }))} reasons={LOST_REASONS} /></Card>
      )}
    </div>
  );
}

async function Revisions({ revs, id, a, b, showCost }: { revs: any[]; id: string; a?: string; b?: string; showCost: boolean }) {
  const ra = revs.find((r) => String(r.rev_no) === (a ?? String(revs[1]?.rev_no ?? revs[0].rev_no)));
  const rb = revs.find((r) => String(r.rev_no) === (b ?? String(revs[0].rev_no)));
  const [la, lb] = await Promise.all([q(`select * from spec_line where revision_id=$1 order by sl`, [ra.id]), q(`select * from spec_line where revision_id=$1 order by sl`, [rb.id])]);
  const key = (s: any) => `${s.item_code ?? ""}|${s.description}`;
  const all = [...new Set([...la.map(key), ...lb.map(key)])];
  const pa = new Map<number, any>((ra.totals?.lines ?? []).map((l: any) => [l.sl, l])), pb = new Map<number, any>((rb.totals?.lines ?? []).map((l: any) => [l.sl, l]));
  return (
    <div className="space-y-4">
      <Card bodyClass="p-0"><Table head={["Rev", "Created", "By", "Notes", "Net value", ...(showCost ? ["Margin"] : []), "Discount", "Locked"]}>
        {revs.map((r) => <tr key={r.id}><td>R{r.rev_no}</td><td>{dtm(r.created_at)}</td><td>{r.by_name}</td><td>{r.notes}</td><td className="num">{inr(r.totals?.netSelling)}</td>{showCost && <td className="num">{r.totals?.marginPct ?? "—"}%</td>}<td className="num">{r.params?.discount_pct ?? 0}%</td><td>{r.locked ? "🔒" : ""}</td></tr>)}
      </Table></Card>
      {revs.length > 1 && (
        <Card title={`Compare R${ra.rev_no} → R${rb.rev_no}`} actions={<form className="flex gap-1 text-sm"><input type="hidden" name="tab" value="revisions" /><select name="a" defaultValue={ra.rev_no} className="input w-20">{revs.map((r) => <option key={r.id}>{r.rev_no}</option>)}</select>→<select name="b" defaultValue={rb.rev_no} className="input w-20">{revs.map((r) => <option key={r.id}>{r.rev_no}</option>)}</select><button className="btn-secondary btn-sm">Compare</button></form>}>
          <Table head={["Line", `Qty R${ra.rev_no}`, `Qty R${rb.rev_no}`, `Amount R${ra.rev_no}`, `Amount R${rb.rev_no}`, "Change"]}>
            {all.map((k) => {
              const x = la.find((s) => key(s) === k), y = lb.find((s) => key(s) === k);
              const ax = x ? pa.get(x.sl)?.amount ?? 0 : 0, ay = y ? pb.get(y.sl)?.amount ?? 0 : 0;
              return <tr key={k} className={!x ? "bg-emerald-50 dark:bg-emerald-900/10" : !y ? "bg-rose-50 dark:bg-rose-900/10" : ""}><td>{(y ?? x).description}</td><td className="num">{x?.qty ?? "—"}</td><td className="num">{y?.qty ?? "—"}</td><td className="num">{inr(ax)}</td><td className="num">{inr(ay)}</td><td className={`num ${ay - ax < 0 ? "text-rose-600" : ay - ax > 0 ? "text-emerald-600" : ""}`}>{!x ? "added" : !y ? "removed" : inr(ay - ax)}</td></tr>;
            })}
            <tr className="font-semibold"><td>Net total</td><td /><td /><td className="num">{inr(ra.totals?.netSelling)}</td><td className="num">{inr(rb.totals?.netSelling)}</td><td className="num">{inr((rb.totals?.netSelling ?? 0) - (ra.totals?.netSelling ?? 0))}</td></tr>
          </Table>
        </Card>
      )}
    </div>
  );
}
