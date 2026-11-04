import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { dtm } from "@/lib/format";
import { PageHeader, Card, Empty } from "@/components/ui";
import { markNotificationsRead } from "@/app/actions/me";

export const metadata = { title: "Notifications" };
export default async function Notifications() {
  const u = await requireUser();
  const rows = await q(`select * from notification where employee_id=$1 order by created_at desc limit 200`, [u.id]);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Notifications" actions={<form action={markNotificationsRead}><button className="btn-secondary">Mark all read</button></form>} />
      <Card bodyClass="p-0">
        {rows.length ? <ul className="divide-y divide-slate-100 dark:divide-slate-800">{rows.map((n) => (
          <li key={n.id} className={`px-4 py-3 ${n.read_at ? "" : "bg-brand-50/60 dark:bg-brand-700/10"}`}>
            <Link href={n.link ?? "#"} className="block"><div className="text-sm font-medium">{n.title}</div><div className="text-sm text-slate-600 dark:text-slate-300">{n.body}</div><div className="text-[11px] text-slate-400">{dtm(n.created_at)}</div></Link>
          </li>))}</ul> : <Empty>No notifications</Empty>}
      </Card>
      <p className="mt-3 text-xs text-slate-500">Email/WhatsApp/SMS channels per event and the daily digest are configured in Phase 3; in-app notifications are live.</p>
    </div>
  );
}
