import Link from "next/link";
import { requireUser, can } from "@/lib/auth";
import { q, one } from "@/lib/db";
import { loadWo } from "@/lib/access";
import { inr, inrShort, dt, dtm, pct, num, label } from "@/lib/format";
import { PageHeader, Card, Badge, Table, Tabs, Stat, Field, Progress, Empty } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { Bars } from "@/components/charts";
import { assignTeamAction, progressAction, addCostAction, milestoneAction, uploadWoDocsAction } from "@/app/actions/wo";
import { DOSSIER_FOLDERS } from "@/lib/attachments";
import { COST_CATEGORIES } from "@/lib/costing";

export default async function WoDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const tab = (await searchParams).tab ?? "overview";
  await loadWo(u, id);
  const showCost = !!can(u, "costing", "view") || !!can(u, "finance", "view");
  const edit = !!can(u, "work_orders", "edit");
  const showMoney = showCost || edit; // billing figures hidden from shop-floor / technician roles
  const [w, cust, cpo, team, budget, actual, spec, ms, prs, pos, costs, docs, hours, emps, acts, invs] = await Promise.all([
    one(`select p.*, v.name vertical from v_wo_pnl p join vertical v on v.id=p.vertical_id where p.id=$1`, [id]),
    one(`select c.* from customer c join work_order w on w.customer_id=c.id where w.id=$1`, [id]),
    one(`select cp.*, pr.proposal_no, pr.id pid from customer_po cp left join proposal pr on pr.id=cp.proposal_id join work_order w on w.customer_po_id=cp.id where w.id=$1`, [id]),
    q(`select t.*, e.name, r.name role from wo_team t join employee e on e.id=t.employee_id join role r on r.id=e.role_id where wo_id=$1 order by team_role`, [id]),
    q(`select category, sum(amount) amount from wo_budget_line where wo_id=$1 group by 1`, [id]),
    q(`select category, sum(amount) filter (where status='POSTED') actual, sum(amount) filter (where status='COMMITTED') committed from cost_entry where wo_id=$1 group by 1`, [id]),
    q(`select * from wo_spec_line where wo_id=$1 order by sl`, [id]),
    q(`select * from milestone where wo_id=$1 order by due_date nulls last, name`, [id]),
    q(`select pr.*, (select json_agg(l order by l.route, l.description) from pr_line l where l.pr_id=pr.id) lines from purchase_requisition pr where wo_id=$1`, [id]),
    q(`select po.*, v.name vendor from purchase_order po left join vendor v on v.id=po.vendor_id where wo_id=$1 order by po_no`, [id]),
    q(`select ce.*, e.name by_name from cost_entry ce left join employee e on e.id=ce.created_by where wo_id=$1 order by entry_date desc, created_at desc limit 200`, [id]),
    q(`select * from attachment where (entity='work_order' and entity_id=$1) or (entity='proposal' and entity_id=(select proposal_id from work_order where id=$1)) or (entity='lead' and entity_id=(select lead_id from proposal where id=(select proposal_id from work_order where id=$1))) order by folder, file_name, version desc`, [id]),
    q(`select e.name, sum(dl.hours) hours, max(d.report_date) last from dwr_line dl join dwr d on d.id=dl.dwr_id join employee e on e.id=d.employee_id where dl.wo_id=$1 group by 1 order by 2 desc`, [id]),
    q(`select e.id, e.name, r.code role from employee e join role r on r.id=e.role_id where e.is_active order by e.name`),
    q(`select * from audit_log where (entity='work_order' and entity_id=$1) order by at desc limit 30`, [id]),
    q(`select i.*, coalesce((select sum(amount) from receipt r where r.invoice_id=i.id),0) received from invoice i where wo_id=$1 order by invoice_date`, [id]),
  ]);
  const cats = [...new Set([...budget.map((b) => b.category), ...actual.map((a) => a.category)])];
  const bva = cats.map((c) => ({ c: label(c), budget: Number(budget.find((b) => b.category === c)?.amount ?? 0), actual: Number(actual.find((a) => a.category === c)?.actual ?? 0), committed: Number(actual.find((a) => a.category === c)?.committed ?? 0) }));
  const pm = team.find((t) => t.team_role === "PM");
  const tabs = [{ key: "overview", label: "Overview & P&L" }, { key: "team", label: "Team" }, { key: "scope", label: `Scope / BOM (${spec.length})` }, { key: "purchase", label: `Purchase (${pos.length})` }, ...(showCost ? [{ key: "costs", label: `Cost ledger (${costs.length})` }] : []), { key: "docs", label: `Dossier (${docs.length})` }, { key: "history", label: "History" }];
  return (
    <div>
      <PageHeader back={{ href: "/work-orders", label: "Work orders" }} title={<>{w.wo_no} <span className="text-base font-normal text-slate-500">{label(w.wo_type)}</span></>}
        subtitle={<span className="flex flex-wrap items-center gap-2">{w.title} · <Link className="link" href={`/customers/${cust.id}`}>{cust.name}</Link> · {w.vertical} · <Badge status={w.status} /> {w.has_fabrication && <Badge tone="purple">Markal fabrication</Badge>} Schedule <Badge status={w.schedule_rag} /> Cost <Badge status={w.cost_rag} /></span>}
        actions={<a className="btn-secondary" href={`/api/dossier/${id}`}>⬇ Download job dossier</a>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {showMoney && <>
        <Stat label="Contract value" value={inrShort(w.contract_value)} />
        <Stat label="Billed" value={inrShort(w.billed)} sub={pct((w.billed / w.contract_value) * 100, 0)} />
        <Stat label="Received" value={inrShort(w.received)} /></>}
        <Stat label="Progress" value={`${num(w.pct_complete)}%`} />
        {showCost && <>
          <Stat label="Budget (cost sheet)" value={inrShort(w.budget_cost)} />
          <Stat label="Actual + committed" value={inrShort(Number(w.actual_cost) + Number(w.committed_cost))} sub={`${w.consumed_pct}% of budget`} tone={w.consumed_pct > 100 ? "red" : undefined} />
          <Stat label="Cost to complete" value={inrShort(Math.max(0, w.eac - w.actual_cost - w.committed_cost))} />
          <Stat label="Margin quoted → est." value={`${pct(w.quoted_margin_pct)} → ${pct(w.est_margin_pct)}`} tone={w.est_margin_pct < w.quoted_margin_pct - 2 ? "red" : "green"} />
        </>}
      </div>
      <Tabs tabs={tabs} active={tab} base={`/work-orders/${id}`} />
      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          {showCost && <Card title="Budget vs actual by cost category" className="lg:col-span-2"><Bars data={bva} x="c" bars={[{ key: "budget", label: "Budget", color: "#cbd5e1" }, { key: "actual", label: "Actual" }, { key: "committed", label: "Committed (open POs)", color: "#e9a23b" }]} height={280} /></Card>}
          <Card title="Status & progress">
            {edit ? <ActionForm action={progressAction} className="space-y-2"><input type="hidden" name="id" value={id} />
              <Field label="% complete"><input name="pct" type="number" min={0} max={100} defaultValue={w.pct_complete} className="input" /></Field>
              <Field label="Status"><select name="status" defaultValue={w.status} className="input">{["KICKOFF", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CLOSED", "CANCELLED"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></Field>
              <Field label="Contract completion date"><input type="date" name="end_date" defaultValue={w.end_date ?? ""} className="input" /></Field></ActionForm>
              : <div className="text-sm">{num(w.pct_complete)}% complete<Progress value={w.pct_complete} /></div>}
            <dl className="mt-4 space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Customer PO</dt><dd>{cpo?.po_no} · {dt(cpo?.po_date)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">From proposal</dt><dd>{cpo?.pid ? <Link className="link" href={`/proposals/${cpo.pid}`}>{cpo.proposal_no}</Link> : "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Project manager</dt><dd>{pm?.name ?? "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Start → completion</dt><dd>{dt(w.start_date)} → {dt(w.end_date)}</dd></div>
            </dl>
            {cpo?.agreed_changes && <p className="mt-2 rounded bg-amber-50 p-2 text-xs dark:bg-amber-900/20">Agreed changes: {cpo.agreed_changes}</p>}
          </Card>
          {showMoney && <><Card title="Billing milestones" className="lg:col-span-2" bodyClass="p-0">
            <Table head={["Milestone", "%", "Amount", "Due", "Status", ""]}>
              {ms.map((m) => <tr key={m.id}><td>{m.name}</td><td className="num">{m.pct}</td><td className="num">{inr(m.amount)}</td><td className={m.status === "PENDING" && m.due_date && m.due_date < new Date().toISOString().slice(0, 10) ? "text-rose-600" : ""}>{dt(m.due_date)}</td><td><Badge status={m.status} /></td>
                <td>{edit && m.status === "PENDING" && <ActionForm action={milestoneAction} hideSubmit className="flex gap-1"><input type="hidden" name="mid" value={m.id} /><input type="date" name="due" defaultValue={m.due_date ?? ""} className="input w-36 py-1" /><button className="btn-ghost btn-sm">Save</button><button name="done" value="1" className="btn-secondary btn-sm">Achieved</button></ActionForm>}</td></tr>)}
            </Table>
          </Card>
          <Card title="Invoices & receipts" bodyClass="p-0">
            {invs.length ? <Table head={["Invoice", "Date", "Total", "Received"]}>{invs.map((i) => <tr key={i.id}><td>{i.invoice_no}</td><td>{dt(i.invoice_date)}</td><td className="num">{inrShort(i.total)}</td><td className="num">{inrShort(i.received)}</td></tr>)}</Table> : <Empty>No invoices yet</Empty>}
          </Card></>}
          <Card title="Labour hours booked (DWR)" bodyClass="p-0">
            {hours.length ? <Table head={["Employee", "Hours", "Last"]}>{hours.map((h) => <tr key={h.name}><td>{h.name}</td><td className="num">{num(h.hours, 1)}</td><td>{dt(h.last)}</td></tr>)}</Table> : <Empty>No hours booked</Empty>}
          </Card>
        </div>
      )}
      {tab === "team" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Execution team">
            <ul className="space-y-2 text-sm">{team.map((t) => <li key={t.employee_id + t.team_role} className="flex justify-between"><span><b>{t.name}</b> <span className="text-slate-500">· {t.role}</span></span><Badge tone={t.team_role === "PM" ? "blue" : t.team_role === "EXECUTOR" ? "green" : "gray"}>{t.team_role === "PM" ? "Accountable (PM)" : t.team_role === "EXECUTOR" ? "Responsible" : "Support"}</Badge></li>)}</ul>
            <p className="mt-3 text-xs text-slate-500">Business Head ({w.vertical}) and MD have automatic visibility.</p>
          </Card>
          {edit && (
            <Card title="Assign team">
              <ActionForm action={assignTeamAction} className="space-y-3"><input type="hidden" name="id" value={id} />
                <Field label="Project manager (accountable)"><select name="pm_id" defaultValue={pm?.employee_id ?? ""} className="input"><option value="">—</option>{emps.filter((e) => ["PROJECT_MANAGER", "OM_MANAGER", "FACTORY_MANAGER", "BUSINESS_HEAD"].includes(e.role)).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>
                <Field label="Executors / site engineers (responsible)" hint="Ctrl/⌘-click to select multiple"><select name="executors" multiple defaultValue={team.filter((t) => t.team_role === "EXECUTOR").map((t) => t.employee_id)} className="input h-28">{emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>
                <Field label="Supporting members (design, QA, safety)"><select name="support" multiple defaultValue={team.filter((t) => t.team_role === "SUPPORT").map((t) => t.employee_id)} className="input h-28">{emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>
              </ActionForm>
            </Card>
          )}
        </div>
      )}
      {tab === "scope" && (
        <Card title="Final material specification (frozen from won proposal)" bodyClass="p-0">
          <Table head={["#", "Item", "Description", "Specification", "Make / MOC", "Qty", "UOM", "Dwg", "Route", ...(showCost ? ["Budget unit cost"] : [])]}>
            {spec.map((s) => <tr key={s.id}><td>{s.sl}</td><td className="text-xs">{s.item_code}</td><td>{s.description}</td><td className="max-w-xs text-xs">{s.specification}</td><td className="text-xs">{[s.make, s.moc].filter(Boolean).join(" / ")}</td><td className="num">{num(s.qty, 2)}</td><td>{s.uom}</td><td className="text-xs">{s.drawing_ref}</td><td>{s.is_fabricated ? <Badge tone="purple">Markal</Badge> : <Badge>Vendor</Badge>}</td>{showCost && <td className="num">{inr(s.unit_cost)}</td>}</tr>)}
          </Table>
          {w.has_fabrication && <p className="p-3 text-xs text-slate-500">Lines routed to Markal will generate a fabrication & assembly job order (drawings, BOM, QAP/ITP, routing) when the Manufacturing module goes live in Phase 2. The Factory Manager has a kick-off task now.</p>}
        </Card>
      )}
      {tab === "purchase" && (
        <div className="space-y-4">
          {prs.map((pr) => (
            <Card key={pr.id} title={<>Purchase requisition {pr.pr_no} <span className="text-xs font-normal text-slate-500">auto-created {dtm(pr.created_at)} from the WO specification</span></>} bodyClass="p-0">
              <Table head={["Route", "Item", "Description", "Qty", "UOM", ...(showCost ? ["Budget rate"] : []), "Required by"]}>
                {(pr.lines ?? []).map((l: any) => <tr key={l.id}><td>{l.route === "MARKAL" ? <Badge tone="purple">Markal Factory</Badge> : <Badge>Vendor</Badge>}</td><td className="text-xs">{l.item_code}</td><td>{l.description}</td><td className="num">{num(l.qty, 2)}</td><td>{l.uom}</td>{showCost && <td className="num">{inr(l.budget_rate)}</td>}<td>{dt(l.required_by)}</td></tr>)}
              </Table>
            </Card>
          ))}
          <Card title="Purchase orders (auto-drafted, editable before approval)" bodyClass="p-0">
            {pos.length ? <Table head={["PO", "Vendor", "Status", "Value", "GST", "Delivery"]}>{pos.map((p) => <tr key={p.id}><td><Link className="link font-medium" href={`/purchase/${p.id}`}>{p.po_no}</Link></td><td>{p.vendor ?? <span className="text-amber-600">Vendor to be selected</span>}</td><td><Badge status={p.status} /></td><td className="num">{inr(p.total)}</td><td className="num">{inr(p.gst_total)}</td><td>{dt(p.delivery_date)}</td></tr>)}</Table> : <Empty>No POs (service-type order or nothing to buy)</Empty>}
          </Card>
        </div>
      )}
      {tab === "costs" && showCost && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Cost ledger — all costs booked to this WO" className="lg:col-span-2" bodyClass="p-0">
            <Table head={["Date", "Category", "Description", "Source", "Status", "Amount"]}>
              {costs.map((c) => <tr key={c.id}><td className="whitespace-nowrap">{dt(c.entry_date)}</td><td>{label(c.category)}</td><td className="text-xs">{c.description}</td><td className="text-xs">{label(c.source_type)}</td><td><Badge status={c.status === "POSTED" ? "DONE" : "PENDING"}>{c.status}</Badge></td><td className="num">{inr(c.amount)}</td></tr>)}
            </Table>
          </Card>
          {(edit || can(u, "finance", "create")) && (
            <Card title="Book a cost to this WO">
              <ActionForm action={addCostAction} reset submitLabel="Book cost" className="space-y-2"><input type="hidden" name="id" value={id} />
                <select name="category" className="input">{[...COST_CATEGORIES.map(([k, l]) => [k, l]), ["LABOUR", "Labour (manual)"], ["TRAVEL", "Travel"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <input name="description" required placeholder="Description (e.g. LR 4512 freight)" className="input" />
                <div className="grid grid-cols-2 gap-2"><input name="amount" required placeholder="Amount ₹ (excl. GST)" className="input" /><input name="gst" placeholder="GST ₹" className="input" /></div>
                <input type="date" name="date" className="input" />
                <div><span className="label">Bill / voucher</span><input type="file" name="bill" className="text-sm" /></div>
              </ActionForm>
              <p className="mt-2 text-[11px] text-slate-500">Purchase, DWR labour and factory production costs post here automatically.</p>
            </Card>
          )}
        </div>
      )}
      {tab === "docs" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Job dossier" className="lg:col-span-2">
            <div className="space-y-3">
              {DOSSIER_FOLDERS.map((f) => {
                const files = docs.filter((d) => (d.folder ?? "13 Correspondence") === f || (!d.folder && f === "13 Correspondence"));
                return (
                  <details key={f} open={files.length > 0} className="rounded-lg border border-slate-200 dark:border-slate-800">
                    <summary className="cursor-pointer px-3 py-2 text-sm font-medium">📁 {f} <span className="text-xs text-slate-400">({files.length})</span></summary>
                    {files.length > 0 && <ul className="border-t border-slate-100 px-3 py-2 text-sm dark:border-slate-800">{files.map((d) => <li key={d.id} className="flex justify-between py-0.5"><a className="link" href={`/api/files/${d.id}`}>{d.file_name}</a><span className="text-xs text-slate-400">v{d.version} · {dt(d.created_at)}</span></li>)}</ul>}
                  </details>
                );
              })}
            </div>
          </Card>
          <Card title="Upload to dossier">
            <ActionForm action={uploadWoDocsAction} reset submitLabel="Upload" className="space-y-2"><input type="hidden" name="id" value={id} />
              <select name="folder" className="input">{DOSSIER_FOLDERS.map((f) => <option key={f}>{f}</option>)}</select><input type="file" name="files" multiple className="text-sm" /></ActionForm>
            <a className="btn-primary mt-4 w-full" href={`/api/dossier/${id}`}>⬇ Download complete dossier (ZIP)</a>
          </Card>
        </div>
      )}
      {tab === "history" && <Card bodyClass="p-0"><Table head={["When", "Action", "Details"]}>{acts.map((a) => <tr key={a.id}><td>{dtm(a.at)}</td><td>{a.action}</td><td className="text-xs"><code>{JSON.stringify(a.new_value)}</code></td></tr>)}</Table></Card>}
    </div>
  );
}
