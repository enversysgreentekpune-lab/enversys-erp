import Link from "next/link";
import { requireUser, can } from "@/lib/auth";
import { q, one } from "@/lib/db";
import { loadLead } from "@/lib/access";
import { inr, inrShort, dt, dtm, label } from "@/lib/format";
import { PageHeader, Card, Badge, Table, Field, Tabs, Empty } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { Timeline } from "@/components/Timeline";
import { EmailComposer } from "@/components/EmailComposer";
import { StageForm } from "@/components/StageForm";
import { GeoFields } from "@/components/GeoFields";
import { logActivityAction, uploadLeadDocsAction, updateLeadAction, startProposalAction } from "@/app/actions/leads";
import { LEAD_STAGES, LOST_REASONS, stageLabel, stageProb } from "@/lib/workflow";
import { fill } from "@/lib/email";

export default async function LeadDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const tab = (await searchParams).tab ?? "timeline";
  const lead = await loadLead(u, id);
  const [cust, contact, vertical, owner, acts, emails, docs, props, contacts, tpls, owners] = await Promise.all([
    one(`select * from customer where id=$1`, [lead.customer_id]), lead.contact_id ? one(`select * from contact where id=$1`, [lead.contact_id]) : null,
    one(`select name from vertical where id=$1`, [lead.vertical_id]), one(`select name, mobile, email from employee where id=$1`, [lead.assigned_to]),
    q(`select a.*, e.name by_name from activity a left join employee e on e.id=a.created_by where entity='lead' and entity_id=$1 order by created_at desc`, [id]),
    q(`select m.*, e.name sender from email_message m left join employee e on e.id=m.sent_by where lead_id=$1 order by created_at desc`, [id]),
    q(`select * from attachment where (entity='lead' and entity_id=$1) or (entity='proposal' and entity_id in (select id from proposal where lead_id=$1)) order by created_at desc`, [id]),
    q(`select * from proposal where lead_id=$1 order by created_at`, [id]),
    q(`select name, email from contact where customer_id=$1 and email is not null`, [lead.customer_id]),
    q(`select code, name, subject, body from template where kind='email' and is_active`),
    q(`select e.id, e.name from employee e join role r on r.id=e.role_id where r.code in ('SALES_ENGINEER','SALES_MANAGER','ESTIMATION_ENGINEER','BUSINESS_HEAD') and e.is_active order by e.name`),
  ]);
  const edit = !!can(u, "leads", "edit");
  const merge = { lead: { ...lead, date: dt(lead.enquiry_date) }, customer: cust, contact: contact ?? { name: "Sir/Madam" }, user: u, proposal: { no: props.at(-1)?.proposal_no ?? "", rev: props.at(-1)?.current_rev ?? 0, title: props.at(-1)?.title ?? lead.title } };
  const rendered = tpls.map((t) => ({ ...t, subject: fill(t.subject ?? "", merge), body: fill(t.body ?? "", merge) }));
  const closed = ["WON", "LOST", "DROPPED", "REGRETTED"].includes(lead.stage);
  const tabs = [{ key: "timeline", label: `Timeline (${acts.length})` }, { key: "email", label: `Emails (${emails.length})` }, { key: "docs", label: `Documents (${docs.length})` }, { key: "details", label: "Details" }];
  return (
    <div>
      <PageHeader back={{ href: "/leads", label: "Leads" }} title={lead.title}
        subtitle={<span className="flex flex-wrap items-center gap-2">{lead.enquiry_no} · <Link className="link" href={`/customers/${cust.id}`}>{cust.name}</Link> · {vertical?.name} · <Badge status={lead.stage}>{stageLabel(lead.stage)}</Badge> <Badge status={lead.priority} /></span>}
        actions={!closed && can(u, "leads", "create") && (
          <ActionForm action={startProposalAction} hideSubmit><input type="hidden" name="id" value={id} /><button className="btn-primary">+ New proposal</button></ActionForm>
        )} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[["Estimated value", inrShort(lead.est_value)], ["Weighted", inrShort(lead.est_value * stageProb(lead.stage) / 100)], ["Expected closure", dt(lead.expected_closure)], ["Next follow-up", lead.next_followup_at ? dtm(lead.next_followup_at) : "—"]].map(([k, v]) => (
              <div key={k} className="card p-3"><div className="text-[11px] uppercase text-slate-500">{k}</div><div className={`font-semibold ${k === "Next follow-up" && lead.next_followup_at && new Date(lead.next_followup_at) < new Date() && !closed ? "text-rose-600" : ""}`}>{v}</div></div>
            ))}
          </div>
          {props.length > 0 && (
            <Card title="Proposals" bodyClass="p-0">
              <Table head={["Proposal", "Rev", "Status", "Quoted", "Margin", "Created"]}>
                {props.map((p) => <tr key={p.id}><td><Link className="link font-medium" href={`/proposals/${p.id}`}>{p.proposal_no}</Link></td><td>R{p.current_rev}</td><td><Badge status={p.status} /></td><td className="num">{inr(p.final_value ?? p.quoted_value)}</td><td className="num">{can(u, "costing", "view") ? `${p.quoted_margin_pct ?? "—"}%` : "•••"}</td><td>{dt(p.created_at)}</td></tr>)}
              </Table>
            </Card>
          )}
          <Tabs tabs={tabs} active={tab} base={`/leads/${id}`} />
          {tab === "timeline" && <Card><Timeline items={acts} /></Card>}
          {tab === "email" && (
            <div className="space-y-4">
              {can(u, "leads", "send") && <Card title="Compose"><EmailComposer leadId={id} contacts={contacts} templates={rendered} attachments={docs} defaultTemplate="EMAIL_FOLLOWUP" /></Card>}
              <Card title="Email thread" bodyClass="p-0">
                {emails.length ? <ul className="divide-y divide-slate-100 dark:divide-slate-800">{emails.map((m) => (
                  <li key={m.id} className={`p-4 ${m.direction === "IN" ? "bg-blue-50/50 dark:bg-blue-900/10" : ""}`}>
                    <div className="flex flex-wrap items-center gap-2 text-sm"><Badge tone={m.direction === "IN" ? "blue" : "gray"}>{m.direction === "IN" ? "Received" : "Sent"}</Badge><b>{m.subject}</b><Badge status={m.status} /></div>
                    <div className="text-xs text-slate-500">{m.direction === "IN" ? `From ${m.from_addr}` : `To ${m.to_addrs}${m.cc_addrs ? `, cc ${m.cc_addrs}` : ""} · by ${m.sender ?? ""}`} · {dtm(m.created_at)}{m.opened_at && ` · opened ${dtm(m.opened_at)}`}{m.attachment_ids?.length ? ` · ${m.attachment_ids.length} attachment(s)` : ""}</div>
                    <div className="prose prose-sm mt-2 max-w-none text-sm dark:prose-invert" dangerouslySetInnerHTML={{ __html: sanitize(m.body ?? "") }} />
                  </li>))}</ul> : <Empty>No emails yet. Inbound replies with <code>[{lead.enquiry_no}]</code> in the subject thread here automatically.</Empty>}
              </Card>
            </div>
          )}
          {tab === "docs" && (
            <Card title="Documents">
              {docs.length ? <Table head={["File", "Folder", "Version", "Uploaded"]}>{docs.map((d) => <tr key={d.id}><td><a className="link" href={`/api/files/${d.id}`}>{d.file_name}</a>{d.entity === "proposal" && <Badge tone="purple">proposal</Badge>}</td><td className="text-xs">{d.folder}</td><td>v{d.version}</td><td>{dtm(d.created_at)}</td></tr>)}</Table> : <Empty>No documents</Empty>}
              {edit && <ActionForm action={uploadLeadDocsAction} reset submitLabel="Upload" className="mt-3"><input type="hidden" name="id" value={id} /><div className="flex flex-wrap gap-2"><select name="folder" className="input w-56"><option>01 Enquiry & RFQ</option><option>04 Drawings</option><option>13 Correspondence</option></select><input type="file" name="files" multiple className="text-sm" /></div></ActionForm>}
            </Card>
          )}
          {tab === "details" && (
            <Card title="Lead details">
              {edit ? (
                <ActionForm action={updateLeadAction} className="grid gap-3 sm:grid-cols-3">
                  <input type="hidden" name="id" value={id} />
                  <Field label="Title" className="sm:col-span-3"><input name="title" defaultValue={lead.title} className="input" /></Field>
                  <Field label="Scope" className="sm:col-span-3"><textarea name="scope" defaultValue={lead.scope ?? ""} className="input min-h-20" /></Field>
                  <Field label="Estimated value"><input name="est_value" defaultValue={lead.est_value} className="input" /></Field>
                  <Field label="Expected closure"><input type="date" name="expected_closure" defaultValue={lead.expected_closure ?? ""} className="input" /></Field>
                  <Field label="Priority"><select name="priority" defaultValue={lead.priority} className="input">{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((p) => <option key={p}>{p}</option>)}</select></Field>
                  <Field label="Assigned to"><select name="assigned_to" defaultValue={lead.assigned_to ?? ""} className="input">{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
                  <Field label="Category"><input name="category" defaultValue={lead.category ?? ""} className="input" /></Field>
                  <Field label="Site location"><input name="site_location" defaultValue={lead.site_location ?? ""} className="input" /></Field>
                  <Field label="Tender no."><input name="tender_no" defaultValue={lead.tender_no ?? ""} className="input" /></Field>
                  <Field label="Bid due date"><input type="date" name="bid_due_date" defaultValue={lead.bid_due_date ?? ""} className="input" /></Field>
                </ActionForm>
              ) : <p className="whitespace-pre-wrap text-sm">{lead.scope}</p>}
              <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                {[["Source", label(lead.source)], ["Owner", owner?.name], ["Contact", contact ? `${contact.name} (${contact.designation ?? ""})` : "—"], ["Enquiry date", dt(lead.enquiry_date)], ["EMD", lead.emd_amount ? inr(lead.emd_amount) : "—"], ["Pre-bid", dt(lead.prebid_date)], ["Lost reason", lead.lost_reason ?? "—"], ["Competitor", lead.competitor_name ? `${lead.competitor_name} ${lead.competitor_price ? inrShort(lead.competitor_price) : ""}` : "—"]].map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd>{v}</dd></div>)}
              </dl>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          {edit && !closed && <Card title="Change stage"><StageForm id={id} stage={lead.stage} stages={LEAD_STAGES.map((s) => ({ code: s.code, label: s.label }))} reasons={LOST_REASONS} /></Card>}
          {edit && (
            <Card title="Log call / meeting / note">
              <ActionForm action={logActivityAction} reset submitLabel="Log" className="space-y-2">
                <input type="hidden" name="id" value={id} />
                <select name="kind" className="input"><option value="CALL">Call</option><option value="MEETING">Meeting / site visit</option><option value="NOTE">Note</option></select>
                <input name="subject" placeholder="Subject" className="input" required />
                <textarea name="body" placeholder="Discussion / outcome" className="input" />
                <Field label="Next follow-up"><input type="datetime-local" name="next_followup_at" className="input" /></Field>
                <GeoFields />
              </ActionForm>
            </Card>
          )}
          <Card title="Customer">
            <div className="text-sm"><Link className="link font-medium" href={`/customers/${cust.id}`}>{cust.name}</Link><div className="text-xs text-slate-500">{cust.industry} · GSTIN {cust.gstin ?? "—"}</div></div>
            {contact && <div className="mt-2 text-sm">{contact.name}<div className="text-xs text-slate-500">{contact.designation} · {contact.mobile} · {contact.email}</div></div>}
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Minimal HTML sanitizer for stored email bodies (strips scripts, event handlers, iframes, javascript: URLs) */
function sanitize(html: string) {
  return html.replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, "").replace(/<(script|iframe|object|embed)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, "$1=\"#\"");
}
