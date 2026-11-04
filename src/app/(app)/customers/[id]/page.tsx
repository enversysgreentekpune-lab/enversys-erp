import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage, can } from "@/lib/auth";
import { q, one } from "@/lib/db";
import { inrShort, dt, dtm, label } from "@/lib/format";
import { PageHeader, Card, Table, Badge, Tabs, Stat, Field, Empty } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { addContactAction, addAddressAction, updateCustomerAction } from "@/app/actions/customers";
import { stageLabel } from "@/lib/workflow";
import { Timeline } from "@/components/Timeline";

export default async function Customer360({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const u = await requirePage("customers");
  const { id } = await params;
  const tab = (await searchParams).tab ?? "overview";
  const c = await one(`select c.*, e.name owner from customer c left join employee e on e.id=c.owner_id where c.id=$1`, [id]);
  if (!c) notFound();
  const [contacts, addrs, leads, props, wos, invs, acts, docs, owners] = await Promise.all([
    q(`select * from contact where customer_id=$1 order by is_decision_maker desc, name`, [id]),
    q(`select * from customer_address where customer_id=$1 order by is_default desc`, [id]),
    q(`select l.*, e.name owner from lead l left join employee e on e.id=l.assigned_to where customer_id=$1 order by enquiry_date desc`, [id]),
    q(`select * from proposal where customer_id=$1 order by created_at desc`, [id]),
    q(`select * from v_wo_pnl where customer_id=$1 order by created_at desc`, [id]),
    q(`select i.*, i.total - coalesce((select sum(amount) from receipt r where r.invoice_id=i.id),0) due from invoice i where customer_id=$1 order by invoice_date desc`, [id]),
    q(`select a.*, e.name by_name, l.enquiry_no from activity a left join employee e on e.id=a.created_by left join lead l on l.id=a.entity_id where (a.entity='customer' and a.entity_id=$1) or (a.entity='lead' and a.entity_id in (select id from lead where customer_id=$1)) order by a.created_at desc limit 50`, [id]),
    q(`select * from attachment where (entity='customer' and entity_id=$1) or (entity='lead' and entity_id in (select id from lead where customer_id=$1)) or (entity='proposal' and entity_id in (select id from proposal where customer_id=$1)) order by created_at desc`, [id]),
    q(`select e.id, e.name from employee e join role r on r.id=e.role_id where r.code in ('SALES_ENGINEER','SALES_MANAGER','BUSINESS_HEAD','MD') order by e.name`),
  ]);
  const edit = !!can(u, "customers", "edit");
  const recv = invs.reduce((a, i) => a + Number(i.due), 0);
  const tabs = [{ key: "overview", label: "Overview" }, { key: "leads", label: `Leads (${leads.length})` }, { key: "proposals", label: `Proposals (${props.length})` }, { key: "orders", label: `Orders (${wos.length})` }, { key: "invoices", label: "Invoices & receivables" }, { key: "docs", label: `Documents (${docs.length})` }, { key: "timeline", label: "Timeline" }];
  return (
    <div>
      <PageHeader title={c.name} back={{ href: "/customers", label: "Customers" }} subtitle={<>{c.code} · {c.industry} {c.group_name && `· ${c.group_name}`} · Owner {c.owner} {c.rating && <Badge tone="blue">Rating {c.rating}</Badge>}</>}
        actions={can(u, "leads", "create") && <Link className="btn-primary" href={`/leads/new?customer=${c.id}`}>+ New enquiry</Link>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Open leads" value={leads.filter((l) => !["WON", "LOST", "DROPPED", "REGRETTED"].includes(l.stage)).length} />
        <Stat label="Proposals won / lost" value={`${props.filter((p) => p.status === "WON").length} / ${props.filter((p) => p.status === "LOST").length}`} />
        <Stat label="Order value" value={inrShort(wos.reduce((a, w) => a + Number(w.contract_value), 0))} />
        <Stat label="Receivable" value={inrShort(recv)} tone={recv > 0 ? "amber" : undefined} />
        <Stat label="Credit limit" value={c.credit_limit ? inrShort(c.credit_limit) : "—"} tone={c.credit_limit && recv > c.credit_limit ? "red" : undefined} />
      </div>
      <Tabs tabs={tabs} active={tab} base={`/customers/${id}`} />
      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Details" className="lg:col-span-2">
            {edit ? (
              <ActionForm action={updateCustomerAction} className="grid gap-3 sm:grid-cols-3">
                <input type="hidden" name="id" value={c.id} />
                <Field label="Name" className="sm:col-span-2"><input name="name" defaultValue={c.name} className="input" /></Field>
                <Field label="Group"><input name="group_name" defaultValue={c.group_name ?? ""} className="input" /></Field>
                <Field label="Industry"><input name="industry" defaultValue={c.industry ?? ""} className="input" /></Field>
                <Field label="GSTIN"><input name="gstin" defaultValue={c.gstin ?? ""} className="input" /></Field>
                <Field label="Phone"><input name="phone" defaultValue={c.phone ?? ""} className="input" /></Field>
                <Field label="Email"><input name="email" defaultValue={c.email ?? ""} className="input" /></Field>
                <Field label="Credit limit"><input name="credit_limit" defaultValue={c.credit_limit ?? ""} className="input" /></Field>
                <Field label="Payment terms"><input name="payment_terms" defaultValue={c.payment_terms ?? ""} className="input" /></Field>
                <Field label="Rating"><select name="rating" defaultValue={c.rating ?? ""} className="input"><option value="">—</option><option>A</option><option>B</option><option>C</option></select></Field>
                <Field label="Account owner"><select name="owner_id" defaultValue={c.owner_id ?? ""} className="input">{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
              </ActionForm>
            ) : (
              <dl className="grid grid-cols-2 gap-2 text-sm">{[["GSTIN", c.gstin], ["PAN", c.pan], ["Phone", c.phone], ["Email", c.email], ["Payment terms", c.payment_terms], ["Source", c.source]].map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd>{v ?? "—"}</dd></div>)}</dl>
            )}
          </Card>
          <div className="space-y-4">
            <Card title="Contacts">
              <ul className="space-y-2 text-sm">{contacts.map((ct) => <li key={ct.id}><b>{ct.name}</b> {ct.is_decision_maker && <Badge tone="green">Decision maker</Badge>}<div className="text-xs text-slate-500">{ct.designation} · {ct.mobile} · {ct.email}</div></li>)}</ul>
              {edit && <details className="mt-3"><summary className="cursor-pointer text-sm text-brand-600">+ Add contact</summary>
                <ActionForm action={addContactAction} reset submitLabel="Add" className="mt-2 grid gap-2"><input type="hidden" name="customer_id" value={id} />
                  <input name="name" required placeholder="Name" className="input" /><input name="designation" placeholder="Designation" className="input" /><input name="email" type="email" placeholder="Email" className="input" /><input name="mobile" placeholder="Mobile" className="input" />
                  <label className="text-sm"><input type="checkbox" name="dm" /> Decision maker</label></ActionForm></details>}
            </Card>
            <Card title="Addresses">
              <ul className="space-y-2 text-sm">{addrs.map((a) => <li key={a.id}><Badge>{a.kind}</Badge> {a.line1}, {a.city}, {a.state} {a.pincode}</li>)}</ul>
              {edit && <details className="mt-3"><summary className="cursor-pointer text-sm text-brand-600">+ Add address</summary>
                <ActionForm action={addAddressAction} reset submitLabel="Add" className="mt-2 grid gap-2"><input type="hidden" name="customer_id" value={id} />
                  <select name="kind" className="input"><option>BILLING</option><option>SHIPPING</option><option>SITE</option></select>
                  <input name="line1" required placeholder="Address" className="input" /><input name="city" placeholder="City" className="input" /><input name="state" placeholder="State" className="input" /><input name="pincode" placeholder="PIN" className="input" /></ActionForm></details>}
            </Card>
          </div>
        </div>
      )}
      {tab === "leads" && <Card bodyClass="p-0"><Table head={["Enquiry", "Date", "Title", "Stage", "Owner", "Value"]}>{leads.map((l) => <tr key={l.id}><td><Link className="link" href={`/leads/${l.id}`}>{l.enquiry_no}</Link></td><td>{dt(l.enquiry_date)}</td><td>{l.title}</td><td><Badge status={l.stage}>{stageLabel(l.stage)}</Badge></td><td>{l.owner}</td><td className="num">{inrShort(l.est_value)}</td></tr>)}</Table></Card>}
      {tab === "proposals" && <Card bodyClass="p-0"><Table head={["Proposal", "Title", "Rev", "Status", "Value"]}>{props.map((p) => <tr key={p.id}><td><Link className="link" href={`/proposals/${p.id}`}>{p.proposal_no}</Link></td><td>{p.title}</td><td>R{p.current_rev}</td><td><Badge status={p.status} /></td><td className="num">{inrShort(p.final_value ?? p.quoted_value)}</td></tr>)}</Table></Card>}
      {tab === "orders" && <Card bodyClass="p-0"><Table head={["WO", "Type", "Status", "Contract", "Billed", "Received"]}>{wos.map((w) => <tr key={w.id}><td><Link className="link" href={`/work-orders/${w.id}`}>{w.wo_no}</Link><div className="text-xs text-slate-500">{w.title}</div></td><td>{label(w.wo_type)}</td><td><Badge status={w.status} /></td><td className="num">{inrShort(w.contract_value)}</td><td className="num">{inrShort(w.billed)}</td><td className="num">{inrShort(w.received)}</td></tr>)}</Table>{!wos.length && <Empty>No orders yet</Empty>}</Card>}
      {tab === "invoices" && <Card bodyClass="p-0"><Table head={["Invoice", "Date", "Due date", "Total", "Outstanding"]}>{invs.map((i) => <tr key={i.id}><td>{i.invoice_no}</td><td>{dt(i.invoice_date)}</td><td>{dt(i.due_date)}</td><td className="num">{inrShort(i.total)}</td><td className="num">{Number(i.due) > 1 ? inrShort(i.due) : <Badge status="DONE">Paid</Badge>}</td></tr>)}</Table>{!invs.length && <Empty>No invoices</Empty>}</Card>}
      {tab === "docs" && <Card bodyClass="p-0"><Table head={["File", "Linked to", "Version", "Uploaded"]}>{docs.map((d) => <tr key={d.id}><td><a className="link" href={`/api/files/${d.id}`}>{d.file_name}</a></td><td>{d.entity}</td><td>v{d.version}</td><td>{dtm(d.created_at)}</td></tr>)}</Table>{!docs.length && <Empty>No documents</Empty>}</Card>}
      {tab === "timeline" && <Card><Timeline items={acts} showRef /></Card>}
      <p className="mt-4 text-xs text-slate-500">O&amp;M contracts and complaints appear here once those modules go live (Phase 3).</p>
    </div>
  );
}
