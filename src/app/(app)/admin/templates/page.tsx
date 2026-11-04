import { requirePage } from "@/lib/auth";
import { q } from "@/lib/db";
import { dtm } from "@/lib/format";
import { PageHeader, Card, Table, Badge } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { uploadTemplateAction, saveEmailTemplateAction } from "@/app/actions/admin";

export const metadata = { title: "Templates" };
export default async function Templates() {
  await requirePage("settings");
  const [files, emails] = await Promise.all([q(`select t.*, e.name by_name from template t left join employee e on e.id=t.uploaded_by where kind in ('docx','xlsx') order by code, version desc`), q(`select * from template where kind='email' order by code`)]);
  const codes = [...new Set(files.map((f) => f.code))];
  return (
    <div>
      <PageHeader back={{ href: "/admin", label: "Admin" }} title="Template manager" subtitle="Word/Excel templates use {{merge.fields}} and {{#lines}}…{{/lines}} loops" />
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card title="Document templates" bodyClass="p-0">
          <Table head={["Code", "Name", "Type", "Version", "Status", "Uploaded", ""]}>
            {files.map((t) => <tr key={t.id}><td className="font-mono text-xs">{t.code}</td><td>{t.name}</td><td>{t.kind}</td><td>v{t.version}</td><td>{t.is_active ? <Badge tone="green">Active</Badge> : <Badge>Archived</Badge>}</td><td className="text-xs">{dtm(t.created_at)} {t.by_name}</td><td><a className="link text-xs" href={`/api/templates/${t.id}`}>Download</a></td></tr>)}
          </Table>
        </Card>
        <Card title="Upload new version">
          <ActionForm action={uploadTemplateAction} submitLabel="Upload & activate" className="space-y-2">
            <select name="code" className="input">{codes.map((c) => <option key={c}>{c}</option>)}</select>
            <input type="file" name="file" accept=".docx,.xlsx" className="text-sm" />
          </ActionForm>
          <div className="mt-3 text-xs text-slate-500">
            <p className="font-medium">Available merge fields (quotes)</p>
            <code className="block whitespace-pre-wrap">{`{{company.name}} {{company.gstin}} {{company.address}}
{{customer.name}} {{contact.name}} {{lead.enquiry_no}}
{{proposal.no}} {{proposal.rev}} {{proposal.date}} {{proposal.title}}
{{#lines}} {{sl}} {{description}} {{specification}} {{qty}} {{uom}} {{unit_price}} {{amount}} {{/lines}}
{{totals.net}} {{totals.gst}} {{totals.grand}} {{totals.words}}
{{terms.payment}} {{terms.delivery}} {{terms.validity}} … {{owner.name}}`}</code>
            <p className="mt-2">Templates are test-rendered on upload; a broken template is rejected and the active version stays live. Templates for PO, Job Order, Inspection, Dispatch, Commissioning certificate and Invoice ship with their Phase 2/3 modules.</p>
          </div>
        </Card>
      </div>
      <h2 className="mb-2 mt-6 font-semibold">Email templates</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {emails.map((t) => (
          <Card key={t.id} title={t.name}>
            <ActionForm action={saveEmailTemplateAction} className="space-y-2"><input type="hidden" name="id" value={t.id} />
              <input name="subject" defaultValue={t.subject} className="input" /><textarea name="body" defaultValue={t.body} className="input min-h-32 font-mono text-xs" /></ActionForm>
          </Card>
        ))}
      </div>
    </div>
  );
}
