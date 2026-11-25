import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage, can } from "@/lib/auth";
import { q, one } from "@/lib/db";
import { dt, num } from "@/lib/format";
import { PageHeader, Card, Badge, Empty, Progress, Stepper } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { IC_STAGES, IC_STAGE_LABEL, IC_DOCS, latestDocs } from "@/lib/ic";
import { icUpdateAction, icDetailsAction, icGenerateAction, icSendAction, icSignedAction } from "@/app/actions/icom";

export const metadata = { title: "I&C project" };

export default async function IcDetail({ params }: { params: Promise<{ id: string }> }) {
  const u = await requirePage("field_services");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ic = await one(`select ic.*, w.wo_no, w.title, w.id wid, w.site_location, w.status wo_status, c.name customer, c.email customer_email, c.id customer_id, e.name engineer
    from ic_project ic join work_order w on w.id=ic.wo_id join customer c on c.id=w.customer_id left join employee e on e.id=ic.engineer_id where ic.id=$1`, [id]);
  if (!ic) notFound();
  const all = can(u, "field_services", "view") === "company";
  if (!all && ic.engineer_id !== u.id && !(await one(`select 1 from wo_team where wo_id=$1 and employee_id=$2`, [ic.wid, u.id]))) notFound();
  const edit = !!can(u, "field_services", "edit") || !!can(u, "field_services", "create");
  const [updates, docs, engineers, contact, dispatches] = await Promise.all([
    q(`select x.*, e.name by_name, (select json_agg(json_build_object('id', a.id, 'name', a.file_name, 'mime', a.mime, 'type', a.doc_type) order by a.created_at) from attachment a where a.entity='ic_update' and a.entity_id=x.id) files
       from ic_update x left join employee e on e.id=x.created_by where x.ic_id=$1 order by x.update_date desc, x.created_at desc`, [id]),
    latestDocs(id),
    q(`select e.id, e.name, r.name role from employee e join role r on r.id=e.role_id where e.is_active and r.code in ('IC_ENGINEER','SITE_ENGINEER','PROJECT_MANAGER','OM_SUPERVISOR') order by e.name`),
    one(`select name, email from contact where customer_id=$1 and email is not null order by is_decision_maker desc limit 1`, [ic.customer_id]),
    q(`select dispatch_no, dispatch_date, status, delivered_date from dispatch where wo_id=$1 order by dispatch_date`, [ic.wid]),
  ]);
  const doc = (t: string) => docs.find((d) => d.doc_type === t);
  const generated = !!ic.docs_generated_at, done = ic.status === "COMPLETED";
  const nextStage = IC_STAGES[Math.min(IC_STAGES.length - 1, Math.max(0, IC_STAGES.indexOf(ic.stage) + (Number(ic.pct) > 0 ? 0 : 0)))];
  return (
    <div>
      <PageHeader title={<>{ic.wo_no} <span className="text-base font-normal text-slate-500">· I&C</span></>} subtitle={`${ic.title} · ${ic.customer}`} back={{ href: "/ic", label: "I&C" }}
        actions={<Badge status={ic.status}>{ic.status === "HANDOVER_PENDING" ? "Handover pending" : ic.status.replace(/_/g, " ").toLowerCase()}</Badge>} />
      <Stepper steps={[
        { label: "Dispatched", done: dispatches.length > 0 },
        { label: "I&C in progress", done: Number(ic.pct) > 0, current: ic.status === "NOT_STARTED" },
        { label: "100% commissioned", done: Number(ic.pct) >= 100, current: ic.status === "IN_PROGRESS" },
        { label: "Handover documents", done: generated, current: Number(ic.pct) >= 100 && !generated },
        { label: "Sent to client", done: !!ic.docs_sent_at, current: generated && !ic.docs_sent_at },
        { label: "Signed handover", done: !!ic.handover_signed_id, current: !!ic.docs_sent_at && !ic.handover_signed_id },
        { label: "Signed appreciation", done: !!ic.appreciation_signed_id, current: !!ic.docs_sent_at && !ic.appreciation_signed_id },
        { label: "Project completed", done },
      ]} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-4">
          <Card title={<>Progress <span className="text-sm font-normal text-slate-500">· {IC_STAGE_LABEL[ic.stage]} · {num(ic.pct)}%</span></>}>
            <Progress value={Number(ic.pct)} tone={Number(ic.pct) >= 100 ? "green" : undefined} />
            <ol className="mt-3 grid grid-cols-2 gap-1 text-xs sm:grid-cols-4">
              {IC_STAGES.map((s, i) => <li key={s} className={`rounded border px-2 py-1 ${IC_STAGES.indexOf(ic.stage) > i || done ? "border-brand-600 bg-brand-50 text-brand-700" : ic.stage === s ? "border-navy-600 text-navy-600" : "border-slate-200 text-slate-400"}`}>{i + 1}. {IC_STAGE_LABEL[s]}</li>)}
            </ol>
          </Card>
          {edit && !done && (
            <Card title="Add progress update">
              <ActionForm action={icUpdateAction} reset submitLabel="Save update" className="space-y-3">
                <input type="hidden" name="ic_id" value={id} />
                <div className="grid gap-2 sm:grid-cols-4">
                  <label><span className="label">Date</span><input type="date" name="date" defaultValue={new Date().toISOString().slice(0, 10)} className="input" /></label>
                  <label><span className="label">Stage</span><select name="stage" defaultValue={nextStage} className="input">{IC_STAGES.map((s) => <option key={s} value={s}>{IC_STAGE_LABEL[s]}</option>)}</select></label>
                  <label><span className="label">Overall progress %</span><input name="pct" inputMode="decimal" required defaultValue={ic.pct} className="input" /></label>
                  <label><span className="label">Manpower at site</span><input name="manpower" inputMode="numeric" className="input" /></label>
                </div>
                <textarea name="activity" required rows={2} placeholder="Work done today (e.g. MBBR tank erected and levelled, blower foundation grouted)" className="input" />
                <input name="issues" placeholder="Issues / hold-ups (optional)" className="input" />
                <div className="grid gap-3 sm:grid-cols-2 text-sm">
                  <label><span className="label">Photographs / evidence</span><input type="file" name="evidence" multiple accept="image/*,application/pdf" className="text-xs" /></label>
                  <div className="rounded-md border border-slate-200 p-2 dark:border-slate-700">
                    <label className="flex items-center gap-2"><input type="checkbox" name="client_signed" /> Report signed by the client</label>
                    <input name="client_rep" placeholder="Client representative" className="input mt-2 py-1" />
                    <input type="file" name="signed_report" accept="image/*,application/pdf" className="mt-2 text-xs" aria-label="Signed report" />
                  </div>
                </div>
              </ActionForm>
            </Card>
          )}
          <Card title={`I&C log (${updates.length})`}>
            {updates.length ? (
              <ol className="space-y-3">
                {updates.map((x) => {
                  const files: any[] = x.files ?? [];
                  return (
                    <li key={x.id} className="border-l-2 border-brand-600 pl-3">
                      <div className="flex flex-wrap items-center gap-2 text-sm"><b>{dt(x.update_date)}</b><span className="text-slate-500">{IC_STAGE_LABEL[x.stage]} · {num(x.pct)}%</span>{x.manpower != null && <span className="text-xs text-slate-500">· {x.manpower} at site</span>}
                        {x.client_signed && <Badge tone="green">Client signed — {x.client_rep}</Badge>}<span className="text-xs text-slate-400">by {x.by_name}</span></div>
                      <div className="text-sm">{x.activity}</div>{x.issues && <div className="text-xs text-amber-700">Issue: {x.issues}</div>}
                      {files.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{files.map((f) => f.mime?.startsWith("image/")
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <a key={f.id} href={`/api/files/${f.id}`} target="_blank"><img src={`/api/files/${f.id}`} alt={f.name} className="h-16 w-24 rounded border border-slate-200 object-cover" /></a>
                        : <a key={f.id} href={`/api/files/${f.id}`} className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:border-brand-600">📄 {f.type === IC_DOCS.clientReport ? "Client-signed report" : f.name}</a>)}</div>}
                    </li>
                  );
                })}
              </ol>
            ) : <Empty>No progress updates yet</Empty>}
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Handover & completion">
            {done ? <p className="mb-3 rounded-md bg-brand-50 p-2 text-sm text-brand-700">Completed on {dt(ic.completed_at)} — signed handover and appreciation certificates on file.</p>
              : <p className="mb-3 text-xs text-slate-500">The project is completed only when the signed handover certificate and the signed appreciation certificate are both uploaded.</p>}
            <div className="space-y-2 text-sm">
              {[[IC_DOCS.report, "Handover report"], [IC_DOCS.handover, "Handover certificate"], [IC_DOCS.appreciation, "Appreciation certificate"]].map(([t, l]) => (
                <div key={t} className="flex items-center justify-between gap-2"><span>{l}</span>{doc(t) ? <a className="link text-xs" href={`/api/files/${doc(t)!.id}`}>Download (Word)</a> : <span className="text-xs text-slate-400">not generated</span>}</div>
              ))}
            </div>
            {edit && !done && (
              <ActionForm action={icGenerateAction} submitLabel={generated ? "Regenerate documents" : "Generate handover documents"} submitClass={generated ? "btn-secondary btn-sm mt-3" : "btn-primary mt-3"}>
                <input type="hidden" name="ic_id" value={id} />
                {Number(ic.pct) < 100 && <p className="mt-2 text-xs text-amber-700">Available when progress reaches 100%.</p>}
              </ActionForm>
            )}
            {edit && generated && !done && (
              <ActionForm action={icSendAction} submitLabel={ic.docs_sent_at ? "Send again" : "Email to client"} className="mt-4 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                <input type="hidden" name="ic_id" value={id} />
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Send to client</div>
                {ic.docs_sent_at && <p className="text-xs text-slate-500">Sent {dt(ic.docs_sent_at)} to {ic.docs_sent_to}</p>}
                <input name="to" type="email" required defaultValue={contact?.email ?? ic.customer_email ?? ""} placeholder="Client email" className="input" />
                <input name="cc" placeholder="Cc (optional)" className="input" />
                <textarea name="note" rows={2} placeholder="Message (optional)" className="input" />
              </ActionForm>
            )}
            {edit && generated && (
              <div className="mt-4 space-y-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Signed copies from the client</div>
                {([["HANDOVER", "Signed handover certificate", ic.handover_signed_id], ["APPRECIATION", "Signed appreciation certificate", ic.appreciation_signed_id]] as const).map(([k, l, att]) => (
                  <div key={k} className="text-sm">
                    <div className="flex items-center justify-between"><span>{l}</span>{att ? <a className="link text-xs" href={`/api/files/${att}`}>✓ View signed copy</a> : <Badge tone="amber">Pending</Badge>}</div>
                    {!done && <ActionForm action={icSignedAction} hideSubmit className="mt-1 flex items-center gap-2"><input type="hidden" name="ic_id" value={id} /><input type="hidden" name="kind" value={k} />
                      <input type="file" name="file" accept="image/*,application/pdf" className="text-xs" aria-label={l} /><button className="btn-secondary btn-sm">Upload</button></ActionForm>}
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="Project details">
            {edit && !done ? (
              <ActionForm action={icDetailsAction} submitLabel="Save" submitClass="btn-secondary btn-sm" className="space-y-2">
                <input type="hidden" name="ic_id" value={id} />
                <label className="block"><span className="label">I&C engineer</span><select name="engineer_id" defaultValue={ic.engineer_id ?? ""} className="input"><option value="">— select —</option>{engineers.map((e) => <option key={e.id} value={e.id}>{e.name} · {e.role}</option>)}</select></label>
                <label className="block"><span className="label">Site address</span><input name="site_address" defaultValue={ic.site_address ?? ic.site_location ?? ""} className="input" /></label>
                <label className="block"><span className="label">Target handover date</span><input type="date" name="target_date" defaultValue={ic.target_date ? new Date(ic.target_date).toISOString().slice(0, 10) : ""} className="input" /></label>
                <label className="block"><span className="label">Observations / pending points (printed in the handover report)</span><textarea name="observations" rows={3} defaultValue={ic.observations ?? ""} className="input" /></label>
              </ActionForm>
            ) : <dl className="space-y-1 text-sm"><div>Engineer: {ic.engineer ?? "—"}</div><div>Site: {ic.site_address ?? ic.site_location ?? "—"}</div><div>Observations: {ic.observations ?? "—"}</div></dl>}
          </Card>
          <Card title="Dispatches">
            {dispatches.map((d) => <div key={d.dispatch_no} className="flex justify-between text-sm"><span>{d.dispatch_no} · {dt(d.dispatch_date)}</span>{d.status === "DELIVERED" ? <Badge tone="green">Delivered {dt(d.delivered_date)}</Badge> : <Badge tone="amber">In transit</Badge>}</div>)}
            <Link className="link mt-2 inline-block text-xs" href={`/dispatch?project=${ic.wid}`}>Dispatch item register →</Link>
          </Card>
        </div>
      </div>
    </div>
  );
}
