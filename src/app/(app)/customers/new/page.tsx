import { requirePage } from "@/lib/auth";
import { q } from "@/lib/db";
import { PageHeader, Card, Field } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { createCustomerAction } from "@/app/actions/customers";
import { LEAD_SOURCES } from "@/lib/workflow";

export const metadata = { title: "New customer" };
export default async function NewCustomer() {
  await requirePage("customers", "create");
  const [verts, owners] = await Promise.all([q(`select id, name from vertical order by sort`), q(`select e.id, e.name from employee e join role r on r.id=e.role_id where r.code in ('SALES_ENGINEER','SALES_MANAGER','BUSINESS_HEAD','MD') and e.is_active order by e.name`)]);
  return (
    <div className="max-w-4xl">
      <PageHeader title="New customer" back={{ href: "/customers", label: "Customers" }} />
      <ActionForm action={createCustomerAction} submitLabel="Create customer">
        <Card title="Company">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Company name *" className="sm:col-span-2"><input name="name" required className="input" /></Field>
            <Field label="Group / parent company"><input name="group_name" className="input" /></Field>
            <Field label="Industry"><input name="industry" className="input" list="industries" /></Field>
            <Field label="GSTIN" hint="PAN is derived from GSTIN"><input name="gstin" className="input uppercase" maxLength={15} /></Field>
            <Field label="Phone"><input name="phone" className="input" /></Field>
            <Field label="Email"><input name="email" type="email" className="input" /></Field>
            <Field label="Website"><input name="website" className="input" /></Field>
            <Field label="Rating"><select name="rating" className="input"><option value="">—</option><option>A</option><option>B</option><option>C</option></select></Field>
            <Field label="Credit limit (₹)"><input name="credit_limit" inputMode="numeric" className="input" /></Field>
            <Field label="Payment terms"><input name="payment_terms" className="input" placeholder="e.g. 30 days" /></Field>
            <Field label="Source"><select name="source" className="input">{LEAD_SOURCES.map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Primary vertical"><select name="vertical_id" className="input"><option value="">—</option>{verts.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
            <Field label="Account owner"><select name="owner_id" className="input"><option value="">Me</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
          </div>
          <datalist id="industries">{["Automotive", "Chemicals", "Pharma", "Real Estate", "Process Engineering", "Energy & Environment", "Food & Beverage", "Government / Utility", "Steel", "Textiles"].map((i) => <option key={i} value={i} />)}</datalist>
        </Card>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Card title="Billing address">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Address" className="sm:col-span-2"><input name="line1" className="input" /></Field>
              <Field label="City"><input name="city" className="input" /></Field><Field label="State"><input name="state" className="input" defaultValue="Maharashtra" /></Field>
              <Field label="PIN code"><input name="pincode" className="input" /></Field>
            </div>
          </Card>
          <Card title="Primary contact (decision maker)">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name"><input name="contact_name" className="input" /></Field><Field label="Designation"><input name="contact_designation" className="input" /></Field>
              <Field label="Email"><input name="contact_email" type="email" className="input" /></Field><Field label="Mobile"><input name="contact_mobile" className="input" /></Field>
            </div>
          </Card>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" name="confirm_dup" value="1" /> Create anyway if similar customers exist</label>
      </ActionForm>
    </div>
  );
}
