import { requirePage } from "@/lib/auth";
import { q } from "@/lib/db";
import { dtm } from "@/lib/format";
import { PageHeader, Card, Table } from "@/components/ui";

export const metadata = { title: "Audit log" };
export default async function Audit({ searchParams }: { searchParams: Promise<{ entity?: string; actor?: string; action?: string; id?: string; page?: string }> }) {
  await requirePage("audit");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const rows = await q(`select a.*, e.name actor from audit_log a left join employee e on e.id=a.actor_id
    where ($1::text is null or a.entity=$1) and ($2::uuid is null or a.actor_id=$2) and ($3::text is null or a.action ilike $3) and ($4::text is null or a.entity_id=$4)
    order by a.at desc limit 100 offset $5`, [sp.entity || null, sp.actor || null, sp.action ? `%${sp.action}%` : null, sp.id || null, (page - 1) * 100]);
  const [entities, actors] = await Promise.all([q(`select distinct entity from audit_log order by 1`), q(`select distinct e.id, e.name from audit_log a join employee e on e.id=a.actor_id order by 2`)]);
  const qs = (p: number) => `/admin/audit?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v)) as any, page: String(p) })}`;
  return (
    <div>
      <PageHeader title="Audit log" subtitle="Append-only record: who, when, what changed (old → new), IP and device" />
      <form className="card mb-4 flex flex-wrap gap-2 p-3">
        <select name="entity" defaultValue={sp.entity ?? ""} className="input w-44"><option value="">All entities</option>{entities.map((e) => <option key={e.entity}>{e.entity}</option>)}</select>
        <select name="actor" defaultValue={sp.actor ?? ""} className="input w-48"><option value="">All users</option>{actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <input name="action" defaultValue={sp.action} placeholder="Action (e.g. LOGIN, APPROVE)" className="input w-56" />
        <button className="btn-secondary">Filter</button>
      </form>
      <Card bodyClass="p-0">
        <Table head={["When", "User", "Action", "Entity", "Old → New", "IP / device"]}>
          {rows.map((r) => <tr key={r.id}><td className="whitespace-nowrap text-xs">{dtm(r.at)}</td><td>{r.actor ?? "system"}</td><td className="font-mono text-xs">{r.action}</td><td className="text-xs">{r.entity}<div className="text-slate-400">{r.entity_id?.slice(0, 8)}</div></td>
            <td className="max-w-md text-xs">{r.old_value && <div className="text-rose-600 line-through decoration-rose-300">{JSON.stringify(r.old_value).slice(0, 200)}</div>}{r.new_value && <div className="text-emerald-700 dark:text-emerald-400">{JSON.stringify(r.new_value).slice(0, 240)}</div>}</td>
            <td className="max-w-[180px] truncate text-xs text-slate-500" title={r.device ?? ""}>{r.ip}<br />{r.device?.slice(0, 40)}</td></tr>)}
        </Table>
      </Card>
      <div className="mt-3 flex gap-2">{page > 1 && <a className="btn-secondary" href={qs(page - 1)}>← Newer</a>}{rows.length === 100 && <a className="btn-secondary" href={qs(page + 1)}>Older →</a>}</div>
    </div>
  );
}
