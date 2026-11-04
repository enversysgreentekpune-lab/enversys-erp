import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { q, one } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { saveSettingAction } from "@/app/actions/admin";

export const metadata = { title: "Admin & Settings" };
export default async function Admin() {
  await requirePage("settings");
  const [company, settings, series] = await Promise.all([one(`select * from company limit 1`), q(`select * from app_setting order by key`), q(`select * from number_series order by doc_type`)]);
  const links = [["/admin/roles", "Roles & permissions", "Module × action × scope matrix, editable without code"], ["/admin/approvals", "Approval matrix", "Discount %, PO value and expense-claim limits"],
    ["/admin/employees", "Employees & logins", "Register mobile numbers, roles, reporting lines, activate/deactivate"], ["/admin/masters", "Masters", "Verticals, departments, designations, locations & geofences, items, vendors"],
    ["/admin/templates", "Templates", "Word/Excel document templates and email templates with merge fields"], ["/admin/audit", "Audit log", "Every create, edit, approve, send and login"]];
  return (
    <div>
      <PageHeader title="Admin & settings" subtitle={company?.legal_name} />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {links.map(([href, t, d]) => <Link key={href} href={href} className="card p-4 hover:border-brand-500"><div className="font-semibold">{t}</div><div className="text-sm text-slate-500">{d}</div></Link>)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Company profile">
          <dl className="grid grid-cols-2 gap-2 text-sm">{[["Name", company.name], ["Legal name", company.legal_name], ["GSTIN", company.gstin], ["PAN", company.pan], ["Address", company.address], ["Website", company.website], ["Bank", `${company.bank_details?.bank} · ${company.bank_details?.account} · ${company.bank_details?.ifsc}`]].map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd>{v}</dd></div>)}</dl>
          <p className="mt-2 text-xs text-slate-500">Financial year: April–March. Currency INR (multi-currency ready on commercial documents).</p>
        </Card>
        <Card title="Document numbering (per type & FY)">
          <table className="tbl"><thead><tr><th>Type</th><th>FY</th><th>Prefix</th><th>Next</th></tr></thead><tbody>{series.map((s) => <tr key={s.doc_type + s.fy}><td>{s.doc_type}</td><td>{s.fy}</td><td>{s.prefix}</td><td>{s.prefix}/{s.fy}/{String(s.next_no).padStart(4, "0")}</td></tr>)}</tbody></table>
        </Card>
        {settings.map((st) => (
          <Card key={st.key} title={`Setting: ${st.key}`}>
            <ActionForm action={saveSettingAction}><input type="hidden" name="key" value={st.key} /><textarea name="value" defaultValue={JSON.stringify(st.value, null, 2)} className="input min-h-28 font-mono text-xs" /></ActionForm>
          </Card>
        ))}
      </div>
    </div>
  );
}
