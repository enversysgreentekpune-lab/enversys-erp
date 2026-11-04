import { requireUser } from "@/lib/auth";
import { q, one } from "@/lib/db";
import { dtm } from "@/lib/format";
import { PageHeader, Card, Table, Badge } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { setPinAction, revokeSessionAction, revokeOthersAction } from "@/app/actions/auth";

export const metadata = { title: "My profile" };
export default async function Profile() {
  const u = await requireUser();
  const [me, sessions] = await Promise.all([
    one(`select e.*, d.name dept, g.name desig, l.name loc, m.name mgr from employee e left join department d on d.id=e.department_id left join designation g on g.id=e.designation_id left join location l on l.id=e.location_id left join employee m on m.id=e.manager_id where e.id=$1`, [u.id]),
    q(`select * from user_session where employee_id=$1 and revoked_at is null and expires_at > now() order by last_seen_at desc`, [u.id]),
  ]);
  return (
    <div className="max-w-4xl">
      <PageHeader title={me.name} subtitle={`${me.emp_code} · ${u.roleName} · ${me.desig ?? ""}`} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Profile">
          <dl className="grid grid-cols-2 gap-2 text-sm">{[["Mobile (login)", me.mobile], ["Email", me.email], ["Department", me.dept], ["Location", me.loc], ["Reports to", me.mgr], ["Date of joining", me.doj]].map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd>{v ?? "—"}</dd></div>)}</dl>
          <p className="mt-3 text-xs text-slate-500">To change personal details or bank info, contact HR.</p>
        </Card>
        <Card title={u.hasPin ? "Change quick-login PIN" : "Set a quick-login PIN"}>
          <ActionForm action={setPinAction} reset submitLabel="Save PIN" className="grid grid-cols-2 gap-2">
            <input name="pin" type="password" inputMode="numeric" maxLength={4} pattern="\d{4}" required placeholder="4-digit PIN" className="input" />
            <input name="confirm" type="password" inputMode="numeric" maxLength={4} pattern="\d{4}" required placeholder="Confirm PIN" className="input" />
          </ActionForm>
          <p className="mt-2 text-xs text-slate-500">PIN works only on devices where you have logged in with OTP. 5 wrong attempts lock PIN login for 15 minutes.</p>
        </Card>
        <Card title="Active devices" className="md:col-span-2" bodyClass="p-0" actions={sessions.length > 1 && <form action={async () => { "use server"; await revokeOthersAction(); }}><button className="btn-secondary btn-sm">Log out all other devices</button></form>}>
          <Table head={["Device", "Method", "IP", "Signed in", "Last active", ""]}>
            {sessions.map((s) => <tr key={s.id}><td>{s.device_label} {s.id === u.sessionId && <Badge tone="green">This device</Badge>}</td><td>{s.method}</td><td className="text-xs">{s.ip}</td><td>{dtm(s.created_at)}</td><td>{dtm(s.last_seen_at)}</td>
              <td>{s.id !== u.sessionId && <ActionForm action={revokeSessionAction} hideSubmit><input type="hidden" name="id" value={s.id} /><button className="btn-ghost btn-sm text-rose-600">Log out</button></ActionForm>}</td></tr>)}
          </Table>
        </Card>
      </div>
    </div>
  );
}
