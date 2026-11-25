import Link from "next/link";
import { requirePage, can } from "@/lib/auth";
import { q, one } from "@/lib/db";
import { inr, num, dt, label } from "@/lib/format";
import { PageHeader, Card, Table, Badge, Stat, Tabs, Empty, Progress } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { dispatchAction, deliveredAction, additionalRequisitionAction } from "@/app/actions/ops";
import { allowedMaterial } from "@/lib/material";

export const metadata = { title: "Dispatch" };
const DOC_LABEL: Record<string, string> = { PHOTO: "Photo", DELIVERY_CHALLAN: "Delivery challan", EWAY_BILL: "E-way bill", INVOICE: "Bill / invoice", CLIENT_RECEIPT: "Client received copy" };

export default async function Dispatch({ searchParams }: { searchParams: Promise<{ tab?: string; project?: string; mr?: string }> }) {
  const u = await requirePage("inspection");
  const sp = await searchParams;
  const projects = await q(`select w.id, w.wo_no, w.title, c.name customer, w.status,
      coalesce((select sum(qty) from wo_spec_line s where s.wo_id=w.id),0) ordered,
      coalesce((select sum(dl.qty) from dispatch_line dl join dispatch d on d.id=dl.dispatch_id where d.wo_id=w.id),0) sent,
      (select count(*)::int from dispatch d where d.wo_id=w.id) dispatches
    from work_order w join customer c on c.id=w.customer_id where w.order_kind='PO' and w.status not in ('CANCELLED') order by w.wo_no`);
  const stateOf = (p: any) => (Number(p.sent) <= 0 ? "PENDING" : Number(p.sent) + 0.0001 >= Number(p.ordered) ? "DISPATCHED" : "PARTIAL");
  const counts = { done: projects.filter((p) => stateOf(p) === "DISPATCHED").length, partial: projects.filter((p) => stateOf(p) === "PARTIAL").length, pending: projects.filter((p) => stateOf(p) === "PENDING").length };
  const k = await one(`select count(*)::int total, count(*) filter (where status='DISPATCHED')::int transit, count(*) filter (where status='DELIVERED')::int delivered,
      count(*) filter (where dispatch_date >= date_trunc('month', current_date))::int this_month from dispatch`);
  const tab = sp.tab ?? (sp.project ? "project" : "projects");
  const tabs = [{ key: "projects", label: "Projects" }, { key: "requisitions", label: "Material requisitions + cost sheet" }, { key: "material", label: "Material register — stores (received)" },
    { key: "dispatches", label: "Dispatch register" }, ...(sp.project && tab === "project" ? [{ key: "project", label: "Project item register" }] : [])];
  return (
    <div>
      <PageHeader title="Dispatch" subtitle="Project-wise item register, dispatch challans with photographs, e-way bills, invoices and client received copies" />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Projects fully dispatched" value={counts.done} tone="green" />
        <Stat label="Partly dispatched" value={counts.partial} tone={counts.partial ? "amber" : undefined} />
        <Stat label="Pending dispatch" value={counts.pending} />
        <Stat label="Dispatches" value={k!.total} sub={`${k!.this_month} this month`} href="/dispatch?tab=dispatches" />
        <Stat label="In transit" value={k!.transit} tone={k!.transit ? "amber" : undefined} />
        <Stat label="Delivered (client signed)" value={k!.delivered} tone="green" />
      </div>
      <Tabs tabs={tabs} active={tab} base={sp.project && tab !== "project" ? `/dispatch?project=${sp.project}` : "/dispatch"} />
      {tab === "projects" && (
        <Card bodyClass="p-0">
          <Table head={["Project code", "Client", "Items ordered", "Dispatched", "Progress", "Dispatches", "Status", ""]}>
            {projects.map((p) => (
              <tr key={p.id}><td><Link className="link font-medium" href={`/dispatch?project=${p.id}`}>{p.wo_no}</Link><div className="max-w-[240px] truncate text-xs text-slate-500">{p.title}</div></td><td>{p.customer}</td>
                <td className="num">{num(p.ordered)}</td><td className="num">{num(p.sent)}</td><td className="w-32"><Progress value={p.ordered ? (p.sent / p.ordered) * 100 : 0} /></td><td className="num">{p.dispatches}</td>
                <td>{stateOf(p) === "DISPATCHED" ? <Badge tone="green">Dispatched</Badge> : stateOf(p) === "PARTIAL" ? <Badge tone="amber">Partial</Badge> : <Badge>Pending</Badge>}</td>
                <td><Link className="btn-secondary btn-sm" href={`/dispatch?project=${p.id}`}>Item register</Link></td></tr>
            ))}
          </Table>
        </Card>
      )}
      {tab === "dispatches" && <DispatchList woId={null} canEdit={!!can(u, "inspection", "edit")} />}
      {tab === "requisitions" && <Requisitions projects={projects} woId={sp.project ?? projects.find((p) => p.status !== "CLOSED")?.id ?? projects[0]?.id} canRaise={!!can(u, "purchase", "create")} />}
      {tab === "material" && <MaterialRegister woId={sp.project ?? null} projects={projects} />}
      {tab === "project" && sp.project && <ProjectRegister woId={sp.project} canCreate={!!can(u, "inspection", "create")} canEdit={!!can(u, "inspection", "edit")} />}
    </div>
  );
}

async function ProjectRegister({ woId, canCreate, canEdit }: { woId: string; canCreate: boolean; canEdit: boolean }) {
  const wo = await one(`select w.*, c.name customer from work_order w join customer c on c.id=w.customer_id where w.id=$1`, [woId]);
  if (!wo) return <Empty>Project not found</Empty>;
  const lines = await q(`select s.*,
      coalesce((select sum(pl.qty) from po_line pl join purchase_order po on po.id=pl.po_id where po.wo_id=s.wo_id and pl.item_code=s.item_code and po.status not in ('DRAFT','CANCELLED')),0) purchased,
      coalesce((select sum(gl.qty_accepted) from grn_line gl join po_line pl on pl.id=gl.po_line_id join purchase_order po on po.id=pl.po_id where po.wo_id=s.wo_id and pl.item_code=s.item_code),0) received,
      coalesce((select sum(j.qty) from job_order j where j.wo_spec_line_id=s.id and j.status='COMPLETED'),0) made,
      (select count(*)::int from job_order j where j.wo_spec_line_id=s.id) jobs,
      coalesce((select sum(dl.qty) from dispatch_line dl where dl.wo_spec_line_id=s.id),0) sent
    from wo_spec_line s where s.wo_id=$1 order by s.sl`, [woId]);
  const ready = (l: any) => (l.is_fabricated ? Number(l.made) : Number(l.received));
  return (
    <div className="space-y-4">
      <Card title={<>{wo.wo_no} · {wo.customer} <span className="text-xs font-normal text-slate-500">cost-sheet item register</span></>} bodyClass="p-0">
        <Table head={["Project item code", "Item", "Source", "Order qty", "Purchased", "Received", "Manufactured", "Dispatched", "Balance", "Status"]}>
          {lines.map((l) => {
            const bal = Number(l.qty) - Number(l.sent);
            const status = bal <= 0.0001 ? <Badge tone="green">Dispatched</Badge> : ready(l) >= Number(l.qty) ? <Badge tone="blue">Ready</Badge> : ready(l) > 0 ? <Badge tone="amber">{l.is_fabricated ? "Partly made" : "Partly received"}</Badge> : <Badge tone="red">{l.is_fabricated ? "Not made" : "Not received"}</Badge>;
            return <tr key={l.id}><td className="font-mono text-xs">{l.project_item_code}</td><td>{l.description}</td><td className="text-xs">{l.is_fabricated ? `Markal (${l.jobs} job)` : "Vendor"}</td>
              <td className="num">{num(l.qty, 2)} {l.uom}</td><td className="num">{l.is_fabricated ? "—" : num(l.purchased, 2)}</td><td className="num">{l.is_fabricated ? "—" : num(l.received, 2)}</td><td className="num">{l.is_fabricated ? num(l.made, 2) : "—"}</td>
              <td className="num">{num(l.sent, 2)}</td><td className="num font-medium">{num(bal, 2)}</td><td>{status}</td></tr>;
          })}
        </Table>
      </Card>
      {canCreate && lines.some((l) => Number(l.qty) > Number(l.sent)) && (
        <Card title="Create dispatch / delivery challan">
          <ActionForm action={dispatchAction} reset submitLabel="Create dispatch" className="space-y-3">
            <input type="hidden" name="wo_id" value={woId} />
            <table className="tbl"><thead><tr><th>Item</th><th>Balance</th><th>Dispatch qty</th></tr></thead><tbody>
              {lines.filter((l) => Number(l.qty) > Number(l.sent)).map((l) => <tr key={l.id}><td className="text-sm">{l.project_item_code} · {l.description}<input type="hidden" name="spec_line_id" value={l.id} /></td><td className="num text-xs">{num(l.qty - l.sent, 2)} {l.uom}</td><td><input name="qty" inputMode="decimal" className="input w-28 py-1" /></td></tr>)}
            </tbody></table>
            <div className="grid gap-2 sm:grid-cols-4">
              <input type="date" name="date" className="input" aria-label="Dispatch date" /><input name="vehicle_no" required placeholder="Vehicle no." className="input" /><input name="transporter" placeholder="Transporter" className="input" /><input name="lr_no" placeholder="LR no." className="input" />
              <input name="dc_no" placeholder="Delivery challan no. (auto if blank)" className="input" /><input name="eway_bill_no" placeholder="E-way bill no." className="input" /><input name="invoice_no" placeholder="Invoice no." className="input" /><input name="freight" placeholder="Freight ₹" className="input" />
            </div>
            <div className="grid gap-3 sm:grid-cols-4 text-sm">
              {[["photos", "Loading photographs"], ["dc_file", "Delivery challan copy"], ["eway_file", "E-way bill copy"], ["invoice_file", "Bill / invoice copy"]].map(([n, l]) => <label key={n}><span className="label">{l}</span><input type="file" name={n} multiple={n === "photos"} accept="image/*,application/pdf" className="text-xs" /></label>)}
            </div>
            <input name="remarks" placeholder="Remarks" className="input" />
          </ActionForm>
        </Card>
      )}
      <DispatchList woId={woId} canEdit={canEdit} />
    </div>
  );
}

async function DispatchList({ woId, canEdit }: { woId: string | null; canEdit: boolean }) {
  const rows = await q(`select d.*, w.wo_no, c.name customer,
      (select json_agg(json_build_object('id', a.id, 'name', a.file_name, 'type', a.doc_type, 'mime', a.mime) order by a.created_at) from attachment a where a.entity='dispatch' and a.entity_id=d.id) docs,
      (select string_agg(s.project_item_code || ' × ' || rtrim(rtrim(dl.qty::text, '0'), '.'), ', ') from dispatch_line dl join wo_spec_line s on s.id=dl.wo_spec_line_id where dl.dispatch_id=d.id) items
    from dispatch d join work_order w on w.id=d.wo_id join customer c on c.id=w.customer_id where ($1::uuid is null or d.wo_id=$1) order by d.dispatch_date desc, d.dispatch_no desc`, [woId]);
  if (!rows.length) return <Card><Empty>No dispatches yet</Empty></Card>;
  return (
    <div className="space-y-3">
      {rows.map((d) => {
        const docs: any[] = d.docs ?? [];
        return (
          <div key={d.id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><b className="font-display">{d.dispatch_no}</b> <span className="text-sm text-slate-500">· {d.wo_no} · {d.customer}</span><div className="text-xs text-slate-500">{dt(d.dispatch_date)} · vehicle {d.vehicle_no}{d.transporter && ` · ${d.transporter}`}{d.lr_no && ` · LR ${d.lr_no}`}{d.eway_bill_no && ` · e-way ${d.eway_bill_no}`}{d.invoice_no && ` · invoice ${d.invoice_no}`}{Number(d.freight) > 0 && ` · freight ${inr(d.freight)}`}</div>
                <div className="mt-1 text-xs">{d.items}</div></div>
              <div className="text-right">{d.status === "DELIVERED" ? <Badge tone="green">Delivered {dt(d.delivered_date)}</Badge> : <Badge tone="amber">In transit</Badge>}{d.received_by_name && <div className="text-xs text-slate-500">Received by {d.received_by_name}</div>}</div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {docs.filter((x) => x.mime?.startsWith("image/")).map((x) => (
                // eslint-disable-next-line @next/next/no-img-element
                <a key={x.id} href={`/api/files/${x.id}`} target="_blank" title={DOC_LABEL[x.type] ?? x.name}><img src={`/api/files/${x.id}`} alt={DOC_LABEL[x.type] ?? x.name} className="h-16 w-24 rounded border border-slate-200 object-cover" /></a>
              ))}
              {docs.filter((x) => !x.mime?.startsWith("image/")).map((x) => <a key={x.id} href={`/api/files/${x.id}`} className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:border-brand-600">📄 {DOC_LABEL[x.type] ?? x.name}</a>)}
              {["DELIVERY_CHALLAN", "EWAY_BILL", "INVOICE", "CLIENT_RECEIPT"].filter((t) => !docs.some((x) => x.type === t)).map((t) => <span key={t} className="rounded-md border border-dashed border-slate-300 px-2 py-1 text-xs text-slate-400">{DOC_LABEL[t]} missing</span>)}
            </div>
            {canEdit && d.status === "DISPATCHED" && (
              <ActionForm action={deliveredAction} hideSubmit className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                <input type="hidden" name="id" value={d.id} /><input type="date" name="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="input w-40 py-1" />
                <input name="received_by" required placeholder="Received by (client)" className="input w-52 py-1" />
                <label className="text-xs">Client received copy <input type="file" name="receipt_file" accept="image/*,application/pdf" className="text-xs" /></label>
                <button className="btn-primary btn-sm">Mark delivered</button>
              </ActionForm>
            )}
          </div>
        );
      })}
    </div>
  );
}

async function Requisitions({ projects, woId, canRaise }: { projects: any[]; woId?: string; canRaise: boolean }) {
  if (!woId) return <Card><Empty>No projects yet</Empty></Card>;
  const wo = await one(`select w.id, w.wo_no, w.title, c.name customer from work_order w join customer c on c.id=w.customer_id where w.id=$1`, [woId]);
  if (!wo) return <Empty>Project not found</Empty>;
  const [spec, mrs, allowed, bought] = await Promise.all([
    q(`select s.*, coalesce((select sum(gl.qty_accepted) from grn_line gl join po_line pl on pl.id=gl.po_line_id join purchase_order po on po.id=pl.po_id where po.wo_id=s.wo_id and coalesce(pl.item_code, pl.description)=coalesce(s.item_code, s.description)),0) received
        from wo_spec_line s where s.wo_id=$1 order by s.sl`, [woId]),
    q(`select pr.*, e.name by_name, d.name decided_name,
        (select json_agg(l order by l.description) from pr_line l where l.pr_id=pr.id) lines,
        (select string_agg(po.po_no, ', ') from purchase_order po where po.pr_id=pr.id) pos
        from purchase_requisition pr left join employee e on e.id=pr.created_by left join employee d on d.id=pr.decided_by where pr.wo_id=$1 order by pr.created_at`, [woId]),
    allowedMaterial(woId),
    q(`select coalesce(pl.item_code, pl.description) k, sum(pl.qty) qty from po_line pl join purchase_order po on po.id=pl.po_id where po.wo_id=$1 and po.status<>'CANCELLED' group by 1`, [woId]),
  ]);
  const recvExtra = await q(`select pl.description, sum(gl.qty_accepted) qty from grn_line gl join po_line pl on pl.id=gl.po_line_id join purchase_order po on po.id=pl.po_id where po.wo_id=$1 group by 1`, [woId]);
  const boughtOf = (code: string | null, d: string) => Number(bought.find((b) => b.k === (code ?? d))?.qty ?? 0);
  const extra = [...allowed.values()].filter((a) => a.additional > 0);
  const MR_TONE: Record<string, any> = { PENDING_APPROVAL: "amber", APPROVED: "green", PO_RAISED: "green", REJECTED: "red", OPEN: "blue" };
  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-center gap-2" action="/dispatch">
        <input type="hidden" name="tab" value="requisitions" />
        <label className="text-sm text-slate-500" htmlFor="mr-project">Project code</label>
        <select id="mr-project" name="project" defaultValue={woId} className="input w-auto">{projects.map((p) => <option key={p.id} value={p.id}>{p.wo_no} · {p.customer}</option>)}</select>
        <button className="btn-secondary btn-sm">Show</button>
      </form>
      <Card title={<>{wo.wo_no} · {wo.customer} <span className="text-xs font-normal text-slate-500">cost sheet items — the only material this project may buy</span></>} bodyClass="p-0">
        <Table head={["Item code", "Item", "Source", "Cost sheet qty", "Additional approved", "Allowed", "On purchase orders", "Received in store", "Status"]}>
          {spec.map((l) => {
            const a = allowed.get(l.item_code?.trim() ? `I:${l.item_code.trim().toUpperCase()}` : `D:${l.description.trim().toLowerCase()}`);
            const po = boughtOf(l.item_code, l.description), rec = Number(l.received);
            return <tr key={l.id}><td className="font-mono text-xs">{l.project_item_code}</td><td>{l.description}<div className="text-[11px] text-slate-500">{l.item_code}</div></td>
              <td className="text-xs">{l.is_fabricated ? "Markal (made in-house)" : "Purchase"}</td><td className="num">{num(l.qty, 2)} {l.uom}</td>
              <td className="num">{a?.additional ? num(a.additional, 2) : "—"}</td><td className="num font-medium">{l.is_fabricated ? "—" : num(a?.qty ?? l.qty, 2)}</td>
              <td className="num">{l.is_fabricated ? "—" : num(po, 2)}</td><td className="num">{l.is_fabricated ? "—" : num(rec, 2)}</td>
              <td>{l.is_fabricated ? <Badge>Manufacturing</Badge> : rec >= Number(a?.qty ?? l.qty) ? <Badge tone="green">Received</Badge> : rec > 0 ? <Badge tone="amber">Part received</Badge> : po > 0 ? <Badge tone="blue">Ordered</Badge> : <Badge tone="red">Not ordered</Badge>}</td></tr>;
          })}
          {extra.filter((a) => a.costSheet === 0).map((a) => <tr key={a.description} className="bg-amber-50/40 dark:bg-amber-900/10"><td className="text-xs text-amber-700">Additional</td><td>{a.description}</td><td className="text-xs">Purchase (approved MR)</td><td className="num">—</td><td className="num">{num(a.additional, 2)}</td><td className="num font-medium">{num(a.qty, 2)}</td><td className="num">{num(boughtOf(null, a.description), 2)}</td><td className="num">{num(Number(recvExtra.find((r) => r.description === a.description)?.qty ?? 0), 2)}</td>
            <td>{Number(recvExtra.find((r) => r.description === a.description)?.qty ?? 0) >= a.qty ? <Badge tone="green">Received</Badge> : boughtOf(null, a.description) > 0 ? <Badge tone="blue">Ordered</Badge> : <Badge tone="red">Not ordered</Badge>}</td></tr>)}
        </Table>
      </Card>
      <Card title="Material requisitions" bodyClass="p-0">
        {mrs.length ? <Table head={["Requisition", "Type", "Items", "Raised by", "Status", "Decision", "Purchase orders"]}>
          {mrs.map((m) => <tr key={m.id}><td className="font-medium">{m.pr_no}<div className="text-[11px] text-slate-500">{dt(m.created_at)}</div></td>
            <td className="text-xs">{m.kind === "COST_SHEET" ? "From cost sheet (auto on win)" : <>Additional<div className="text-slate-500">{m.reason}</div></>}</td>
            <td className="max-w-[320px] text-xs">{(m.lines ?? []).map((l: any) => `${l.description} × ${num(l.qty, 2)} ${l.uom}`).join(", ")}</td>
            <td className="text-xs">{m.by_name}</td><td><Badge tone={MR_TONE[m.status]}>{m.kind === "COST_SHEET" ? "Cost sheet" : m.status === "PO_RAISED" ? "Approved · PO raised" : label(m.status)}</Badge></td>
            <td className="text-xs">{m.decided_name ? `${m.decided_name} · ${dt(m.decided_at)}` : m.kind === "ADDITIONAL" ? "Awaiting proposal head" : "—"}</td><td className="text-xs">{m.pos ?? "—"}</td></tr>)}
        </Table> : <Empty>No requisitions yet</Empty>}
      </Card>
      {canRaise ? (
        <Card title="Raise additional material requisition">
          <p className="mb-3 text-xs text-slate-500">Use this only for items that are not on the cost sheet or for quantity beyond it. It goes to the proposal head for approval; on approval a draft purchase order is created. Purchase orders cannot include any other item.</p>
          <ActionForm action={additionalRequisitionAction} reset submitLabel="Send for approval" className="space-y-3">
            <input type="hidden" name="wo_id" value={woId} />
            <table className="tbl"><thead><tr><th>Item description</th><th>Item code (optional)</th><th>Qty</th><th>UoM</th><th>Est. rate ₹</th></tr></thead><tbody>
              {[0, 1, 2].map((i) => <tr key={i}><td><input name="description" required={i === 0} className="input py-1" placeholder={i === 0 ? "e.g. SS 304 pipe 2 in, Sch 10" : ""} /></td><td><input name="item_code" className="input w-28 py-1" /></td>
                <td><input name="qty" inputMode="decimal" className="input w-20 py-1" /></td><td><input name="uom" defaultValue="NOS" className="input w-20 py-1" /></td><td><input name="rate" inputMode="decimal" className="input w-24 py-1" /></td></tr>)}
            </tbody></table>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]"><input name="reason" required placeholder="Reason (e.g. site change requested by client, drawing revision R2)" className="input" /><input type="date" name="required_by" className="input" aria-label="Required by" /></div>
          </ActionForm>
        </Card>
      ) : <p className="text-xs text-slate-500">Additional material requisitions are raised by the Purchase department and approved by a proposal head.</p>}
    </div>
  );
}

/** Stores material register: only material actually received (GRN), by project code */
async function MaterialRegister({ woId, projects }: { woId: string | null; projects: any[] }) {
  const rows = await q(`select g.grn_no, g.received_date, g.challan_no, g.vehicle_no, gl.qty_received, gl.qty_accepted, gl.qty_rejected, pl.description, pl.item_code, pl.uom,
      po.po_no, po.id po_id, w.wo_no, v.name vendor, loc.name location, pr.kind pr_kind, pr.pr_no
    from grn_line gl join grn g on g.id=gl.grn_id join po_line pl on pl.id=gl.po_line_id join purchase_order po on po.id=pl.po_id join work_order w on w.id=po.wo_id
    left join vendor v on v.id=po.vendor_id left join location loc on loc.id=g.location_id left join purchase_requisition pr on pr.id=po.pr_id
    where gl.qty_received > 0 and ($1::uuid is null or po.wo_id=$1) order by g.received_date desc, g.grn_no desc`, [woId]);
  return (
    <div className="space-y-3">
      <form className="flex flex-wrap items-center gap-2" action="/dispatch">
        <input type="hidden" name="tab" value="material" />
        <label className="text-sm text-slate-500" htmlFor="mr-filter">Project code</label>
        <select id="mr-filter" name="project" defaultValue={woId ?? ""} className="input w-auto"><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.wo_no} · {p.customer}</option>)}</select>
        <button className="btn-secondary btn-sm">Show</button>
      </form>
      <Card title="Material received in stores, by project code" bodyClass="p-0">
        {rows.length ? <Table head={["Project code", "GRN · date", "Item", "Received", "Accepted", "Rejected", "Against", "PO · vendor", "Challan · vehicle", "Store"]}>
          {rows.map((r, i) => <tr key={i}><td className="font-medium">{r.wo_no}</td><td>{r.grn_no}<div className="text-[11px] text-slate-500">{dt(r.received_date)}</div></td>
            <td>{r.description}<div className="text-[11px] text-slate-500">{r.item_code}</div></td><td className="num">{num(r.qty_received, 2)} {r.uom}</td><td className="num">{num(r.qty_accepted, 2)}</td>
            <td className={`num ${Number(r.qty_rejected) > 0 ? "text-rose-600" : ""}`}>{num(r.qty_rejected, 2)}</td>
            <td>{r.pr_kind === "ADDITIONAL" ? <Badge tone="amber">Additional MR {r.pr_no}</Badge> : <Badge tone="green">Cost sheet</Badge>}</td>
            <td><Link className="link" href={`/purchase/${r.po_id}`}>{r.po_no}</Link><div className="text-[11px] text-slate-500">{r.vendor}</div></td>
            <td className="text-xs">{r.challan_no ?? "—"}{r.vehicle_no && <div className="text-slate-500">{r.vehicle_no}</div>}</td><td className="text-xs">{r.location}</td></tr>)}
        </Table> : <Empty>No material received yet. Items appear here once Stores records a material receipt (GRN).</Empty>}
      </Card>
    </div>
  );
}
