import Link from "next/link";
import { requirePage, can } from "@/lib/auth";
import { q } from "@/lib/db";
import { MODULES, ACTIONS } from "@/lib/rbac";
import { PageHeader, Card } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { savePermissionsAction, createRoleAction } from "@/app/actions/admin";

export const metadata = { title: "Roles & permissions" };
export default async function Roles({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const u = await requirePage("settings");
  const roles = await q(`select r.*, (select count(*)::int from employee e where e.role_id=r.id and e.is_active) users from role r order by sort, name`);
  const { role: roleParam } = await searchParams;
  const sel = roles.find((r) => r.id === roleParam) ?? roles.find((r) => r.code === "SALES_ENGINEER") ?? roles[0];
  const perms = await q(`select module, action, scope from permission where role_id=$1`, [sel.id]);
  const get = (m: string, a: string) => perms.find((p) => p.module === m && p.action === a)?.scope ?? "";
  const editable = !!can(u, "settings", "edit");
  return (
    <div>
      <PageHeader back={{ href: "/admin", label: "Admin" }} title="Roles & permissions" subtitle="RBAC + data scoping: Own → Team → Department/Vertical → Company" />
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <Card bodyClass="p-2">
          <ul className="space-y-0.5 text-sm">{roles.map((r) => <li key={r.id}><Link href={`/admin/roles?role=${r.id}`} className={`flex justify-between rounded px-2 py-1.5 ${r.id === sel.id ? "bg-brand-600 text-white" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}><span>{r.name}</span><span className="text-xs opacity-70">{r.users}</span></Link></li>)}</ul>
          {can(u, "settings", "create") && (
            <details className="mt-3 px-2"><summary className="cursor-pointer text-sm text-brand-600">+ New role</summary>
              <ActionForm action={createRoleAction} submitLabel="Create" className="mt-2 space-y-2"><input name="code" required placeholder="CODE" className="input" /><input name="name" required placeholder="Name" className="input" />
                <select name="copy_from" className="input"><option value="">Start empty</option>{roles.map((r) => <option key={r.id} value={r.id}>Copy from {r.name}</option>)}</select></ActionForm></details>
          )}
        </Card>
        <Card title={<>{sel.name} <span className="text-xs font-normal text-slate-500">({sel.code})</span></>} bodyClass="overflow-x-auto p-0">
          <ActionForm action={savePermissionsAction} hideSubmit={!editable} submitLabel="Save permissions" className="p-3">
            <input type="hidden" name="role_id" value={sel.id} />
            <table className="tbl min-w-[860px]">
              <thead><tr><th>Module</th>{ACTIONS.map((a) => <th key={a} className="text-center">{a}</th>)}</tr></thead>
              <tbody>
                {MODULES.map((m) => (
                  <tr key={m.code}>
                    <td className="font-medium">{m.name}</td>
                    {ACTIONS.map((a) => (
                      <td key={a} className="p-1">
                        <select name={`${m.code}:${a}`} defaultValue={get(m.code, a)} disabled={!editable}
                          className={`w-full rounded border px-1 py-1 text-xs ${get(m.code, a) ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20" : "border-slate-200 bg-transparent dark:border-slate-700"}`}>
                          <option value="">—</option><option value="own">Own</option><option value="team">Team</option><option value="dept">Vertical</option><option value="company">Company</option>
                        </select>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-500">“Cost Sheets / Margin” controls sensitive cost & margin fields: without <i>view</i> they are hidden everywhere; <i>approve</i> allows overriding the margin %.</p>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
