import { requirePage } from "@/lib/auth";
import { q } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { saveApprovalRuleAction } from "@/app/actions/admin";
import { label } from "@/lib/format";

export const metadata = { title: "Approval matrix" };
const DOCS = ["QUOTE_DISCOUNT", "PURCHASE_ORDER", "EXPENSE_CLAIM", "LEAVE"];
export default async function ApprovalRules() {
  await requirePage("settings");
  const [rules, roles] = await Promise.all([q(`select * from approval_rule order by doc_type, sequence`), q(`select code, name from role order by sort`)]);
  const row = (r?: any) => (
    <ActionForm key={r?.id ?? "new"} action={saveApprovalRuleAction} hideSubmit className="grid grid-cols-2 items-center gap-2 border-b border-slate-100 py-2 sm:grid-cols-7 dark:border-slate-800">
      {r && <input type="hidden" name="id" value={r.id} />}
      <select name="doc_type" defaultValue={r?.doc_type} className="input">{DOCS.map((d) => <option key={d} value={d}>{label(d)}</option>)}</select>
      <input name="min_value" defaultValue={r?.min_value ?? 0} className="input" placeholder="From (≥)" />
      <input name="max_value" defaultValue={r?.max_value ?? ""} className="input" placeholder="To (<) — blank = no limit" />
      <select name="approver_role" defaultValue={r?.approver_role} className="input">{roles.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select>
      <input name="sequence" defaultValue={r?.sequence ?? 1} className="input" placeholder="Level" />
      <select name="active" defaultValue={r?.is_active === false ? "0" : "1"} className="input"><option value="1">Active</option><option value="0">Inactive</option></select>
      <div className="flex gap-1"><button className="btn-primary btn-sm">{r ? "Save" : "Add"}</button>{r && <button name="delete" value="1" className="btn-ghost btn-sm text-rose-600">Delete</button>}</div>
    </ActionForm>
  );
  return (
    <div>
      <PageHeader back={{ href: "/admin", label: "Admin" }} title="Approval matrix" subtitle="Value limits are % for quote discount and ₹ for POs and expense claims. Higher roles can always approve lower-level items." />
      <Card title="Rules">
        <div className="hidden grid-cols-7 gap-2 text-xs font-semibold uppercase text-slate-500 sm:grid"><span>Document</span><span>From ≥</span><span>To &lt;</span><span>Approver</span><span>Level</span><span>Status</span><span /></div>
        {rules.map((r) => row(r))}
        <div className="mt-3 text-sm font-medium">Add rule</div>{row()}
      </Card>
    </div>
  );
}
