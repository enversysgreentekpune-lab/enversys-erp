import { requirePage } from "@/lib/auth";
import { q } from "@/lib/db";
import { PageHeader, Card, Field } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { createLeadAction } from "@/app/actions/leads";
import { LEAD_SOURCES } from "@/lib/workflow";
import { label } from "@/lib/format";

export const metadata = { title: "New enquiry" };
export default async function NewLead({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const u = await requirePage("leads", "create");
  const { customer } = await searchParams;
  const [custs, verts, owners, contacts] = await Promise.all([
    q(`select id, name from customer where is_active order by name`), q(`select id, name from vertical order by sort`),
    q(`select e.id, e.name from employee e join role r on r.id=e.role_id where r.code in ('SALES_ENGINEER','SALES_MANAGER','ESTIMATION_ENGINEER','BUSINESS_HEAD') and e.is_active order by e.name`),
    customer ? q(`select id, name, designation from contact where customer_id=$1`, [customer]) : Promise.resolve([]),
  ]);
  return (
    <div className="max-w-5xl">
      <PageHeader title="Register enquiry" back={{ href: "/leads", label: "Leads" }} />
      <ActionForm action={createLeadAction} submitLabel="Register enquiry">
        <Card title="Customer">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Existing customer"><select name="customer_id" defaultValue={customer ?? ""} className="input"><option value="">— or create new →</option>{custs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="New customer name"><input name="new_customer" className="input" placeholder="Auto-creates customer" /></Field>
            {contacts.length ? <Field label="Contact"><select name="contact_id" className="input">{contacts.map((c) => <option key={c.id} value={c.id}>{c.name} – {c.designation}</option>)}</select></Field>
              : <Field label="Contact name"><input name="contact_name" className="input" /></Field>}
            {!contacts.length && <><Field label="Contact email"><input name="contact_email" type="email" className="input" /></Field><Field label="Contact mobile"><input name="contact_mobile" className="input" /></Field></>}
          </div>
        </Card>
        <Card title="Enquiry" className="mt-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Title *" className="sm:col-span-3"><input name="title" required className="input" placeholder="e.g. 50 KLD ETP for paint shop" /></Field>
            <Field label="Enquiry date"><input type="date" name="enquiry_date" className="input" /></Field>
            <Field label="Business vertical *"><select name="vertical_id" required className="input"><option value="">—</option>{verts.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
            <Field label="Product / service category"><input name="category" className="input" list="cats" /></Field>
            <Field label="Estimated value (₹)"><input name="est_value" inputMode="numeric" className="input" /></Field>
            <Field label="Expected closure"><input type="date" name="expected_closure" className="input" /></Field>
            <Field label="Scope description" className="sm:col-span-4"><textarea name="scope" className="input min-h-20" /></Field>
            <Field label="Site location"><input name="site_location" className="input" /></Field>
            <Field label="Priority"><select name="priority" defaultValue="MEDIUM" className="input">{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((p) => <option key={p}>{p}</option>)}</select></Field>
            <Field label="Source"><select name="source" className="input">{LEAD_SOURCES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></Field>
            <Field label="Assigned sales engineer"><select name="assigned_to" defaultValue={u.id} className="input">{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}{!owners.some((o) => o.id === u.id) && <option value={u.id}>Me</option>}</select></Field>
            <Field label="Next follow-up"><input type="datetime-local" name="next_followup_at" className="input" /></Field>
          </div>
          <datalist id="cats">{["Effluent Treatment", "Sewage Treatment", "Water Treatment", "Air Pollution Control", "Storage Tanks", "Pressure Vessels", "Skids", "Ducting & Structures", "O&M Contract", "AMC", "Consultancy", "Trading – Pumps", "Trading – Valves"].map((c) => <option key={c} value={c} />)}</datalist>
        </Card>
        <Card title="Tender details (optional)" className="mt-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Tender no."><input name="tender_no" className="input" /></Field><Field label="EMD (₹)"><input name="emd_amount" className="input" /></Field>
            <Field label="Pre-bid date"><input type="date" name="prebid_date" className="input" /></Field><Field label="Bid due date"><input type="date" name="bid_due_date" className="input" /></Field>
          </div>
        </Card>
        <Card title="Attachments — RFQ, drawings, specs, BOQ" className="mt-4"><input type="file" name="files" multiple className="text-sm" /></Card>
      </ActionForm>
    </div>
  );
}
