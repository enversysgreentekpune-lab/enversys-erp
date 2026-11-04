import { requireUser, can } from "@/lib/auth";
import { redirect } from "next/navigation";
import { q, one } from "@/lib/db";
import { dt, inr } from "@/lib/format";
import { PageHeader, Card, Table, Badge, Field } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { saveEmployeeAction } from "@/app/actions/admin";

export const metadata = { title: "Employees" };
export default async function Employees({ searchParams }: { searchParams: Promise<{ edit?: string; q?: string }> }) {
  const u = await requireUser();
  if (!can(u, "settings", "view") && can(u, "hr", "view") !== "company") redirect("/forbidden");
  const sp = await searchParams;
  const [emps, roles, depts, desigs, verts, locs] = await Promise.all([
    q(`select e.*, r.name role, d.name dept, l.name loc, m.name mgr, (select max(last_seen_at) from user_session s where s.employee_id=e.id) last_seen from employee e join role r on r.id=e.role_id left join department d on d.id=e.department_id left join location l on l.id=e.location_id left join employee m on m.id=e.manager_id
       where ($1::text is null or e.name ilike $1 or e.mobile like $1 or e.emp_code ilike $1) order by e.is_active desc, e.name`, [sp.q ? `%${sp.q}%` : null]),
    q(`select id, name from role order by sort`), q(`select id, name from department order by name`), q(`select id, name from designation order by level`), q(`select id, name from vertical order by sort`), q(`select id, name from location order by name`),
  ]);
  const ed = sp.edit ? await one(`select * from employee where id=$1`, [sp.edit]) : null;
  const sel = (name: string, opts: any[], val?: string | null, blank = true) => <select name={name} defaultValue={val ?? ""} className="input">{blank && <option value="">—</option>}{opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>;
  const showPay = !!can(u, "hr", "edit");
  return (
    <div>
      <PageHeader title="Employees & logins" subtitle="Only numbers registered and active here can log in via OTP" back={{ href: "/admin", label: "Admin" }} />
      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <Card bodyClass="p-0" title={<form className="flex gap-2"><input name="q" defaultValue={sp.q} placeholder="Search name / mobile / code" className="input w-64" /><button className="btn-secondary btn-sm">Search</button></form>}>
          <Table head={["Code", "Name", "Mobile (login)", "Role", "Dept / Location", "Reports to", "Last seen", "Status", ""]}>
            {emps.map((e) => <tr key={e.id}><td className="text-xs">{e.emp_code}</td><td>{e.name}</td><td>{e.mobile}</td><td className="text-xs">{e.role}</td><td className="text-xs">{e.dept}<br />{e.loc}</td><td className="text-xs">{e.mgr}</td><td className="text-xs">{e.last_seen ? dt(e.last_seen) : "never"}</td><td>{e.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}</td><td><a className="link text-xs" href={`/admin/employees?edit=${e.id}`}>Edit</a></td></tr>)}
          </Table>
        </Card>
        <Card title={ed ? `Edit ${ed.name}` : "Register employee"}>
          <ActionForm action={saveEmployeeAction} submitLabel={ed ? "Save" : "Register"} key={ed?.id ?? "new"} className="grid grid-cols-2 gap-2">
            {ed && <input type="hidden" name="id" value={ed.id} />}
            <Field label="Full name *" className="col-span-2"><input name="name" required defaultValue={ed?.name} className="input" /></Field>
            <Field label="Mobile (login ID) *"><input name="mobile" required defaultValue={ed?.mobile} className="input" /></Field>
            <Field label="Email"><input name="email" defaultValue={ed?.email ?? ""} className="input" /></Field>
            <Field label="Role *">{sel("role_id", roles, ed?.role_id, false)}</Field>
            <Field label="Reports to">{sel("manager_id", emps.filter((x) => x.is_active && x.id !== ed?.id), ed?.manager_id)}</Field>
            <Field label="Department">{sel("department_id", depts, ed?.department_id)}</Field>
            <Field label="Designation">{sel("designation_id", desigs, ed?.designation_id)}</Field>
            <Field label="Vertical">{sel("vertical_id", verts, ed?.vertical_id)}</Field>
            <Field label="Location">{sel("location_id", locs, ed?.location_id)}</Field>
            <Field label="Date of joining"><input type="date" name="doj" defaultValue={ed?.doj ?? ""} className="input" /></Field>
            {showPay && <><Field label="Monthly CTC (₹)"><input name="monthly_ctc" defaultValue={ed?.monthly_ctc ?? ""} className="input" /></Field>
              <Field label="Labour cost rate (₹/h)" hint="Used to cost DWR hours to WOs"><input name="hourly_cost" defaultValue={ed?.hourly_cost ?? ""} className="input" /></Field></>}
            <label className="col-span-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={ed ? ed.is_active : true} /> Active (can log in)</label>
            <label className="col-span-2 text-sm"><input type="checkbox" name="single_device" defaultChecked={ed?.single_device} /> Single-device lock (field staff)</label>
          </ActionForm>
          {ed && showPay && <p className="mt-2 text-xs text-slate-500">CTC {inr(ed.monthly_ctc)} · Deactivating or changing role logs the user out of all devices.</p>}
        </Card>
      </div>
    </div>
  );
}
