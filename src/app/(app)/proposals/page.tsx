import Link from "next/link";
import { requirePage, can, scopeSql } from "@/lib/auth";
import { q } from "@/lib/db";
import { inr, inrShort, dt, pct, label } from "@/lib/format";
import { resolveFrame, type Frame } from "@/lib/period";
import { PageHeader, Card, Table, Badge, Stat, Empty } from "@/components/ui";
import { FrameBar } from "@/components/FrameBar";
import { Bars } from "@/components/charts";
import { PROPOSAL_STATUSES } from "@/lib/workflow";

export const metadata = { title: "Proposals" };
type SP = { frame?: string; from?: string; to?: string; status?: string; vertical?: string; owner?: string; q?: string };

export default async function Proposals({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await requirePage("leads");
  const sp = await searchParams;
  const range = resolveFrame((sp.frame as Frame) ?? "fy", new Date(), { from: sp.from, to: sp.to });
  const showCost = !!can(u, "costing", "view");
  const p: unknown[] = [range.from, range.to];
  const w = [`p.created_at::date between $1 and $2`, scopeSql(u, can(u, "leads", "view")!, { owner: ["p.owner_id", "p.created_by", "l.assigned_to"], vertical: "l.vertical_id" }, p)];
  if (sp.vertical) { p.push(sp.vertical); w.push(`l.vertical_id=$${p.length}`); }
  if (sp.owner) { p.push(sp.owner); w.push(`p.owner_id=$${p.length}`); }
  if (sp.q) { p.push(`%${sp.q}%`); w.push(`(p.proposal_no ilike $${p.length} or p.title ilike $${p.length} or c.name ilike $${p.length})`); }
  const all = await q(`select p.*, c.name customer, v.name vertical, e.name owner, l.enquiry_no from proposal p join lead l on l.id=p.lead_id join customer c on c.id=p.customer_id
    join vertical v on v.id=l.vertical_id left join employee e on e.id=p.owner_id where ${w.join(" and ")} order by p.created_at desc`, p);
  const rows = sp.status ? all.filter((r) => r.status === sp.status) : all;
  const verts = await q(`select id, name from vertical order by sort`);
  const by = (s: string) => { const x = all.filter((r) => r.status === s); return { n: x.length, v: x.reduce((a, r) => a + Number(r.final_value ?? r.quoted_value), 0) }; };
  const won = by("WON"), lost = by("LOST");
  const avg = (xs: any[]) => (xs.length ? xs.reduce((a, r) => a + Number(r.quoted_margin_pct ?? 0), 0) / xs.length : 0);
  const submitted = all.filter((r) => !["DRAFT", "PENDING_APPROVAL", "APPROVED", "CANCELLED"].includes(r.status));
  const wonRows = all.filter((r) => r.status === "WON");
  const leak = wonRows.reduce((a, r) => a + Number(r.quoted_value) - Number(r.final_value ?? r.quoted_value), 0);
  const group = (k: string) => Object.values(all.reduce((a: Record<string, any>, r) => { const g = (a[r[k]] ??= { k: r[k], n: 0, v: 0, won: 0, lost: 0 }); g.n++; g.v += Number(r.quoted_value); if (r.status === "WON") g.won += Number(r.final_value); if (r.status === "LOST") g.lost += Number(r.quoted_value); return a; }, {}));
  const qs = (st: string) => { const x = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]); x.set("status", st); return `/proposals?${x}`; };
  return (
    <div>
      <PageHeader title="Proposal register & statistics" subtitle={range.label} actions={can(u, "leads", "export") && <a className="btn-secondary" href={`/api/export/proposals?${new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][])}`}>Export Excel</a>} />
      <FrameBar verticals={verts} showCompare={false} showUnit={false} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {(["WON", "LOST", "IN_DISCUSSION", "IN_NEGOTIATION", "SUBMITTED", "ON_HOLD", "PENDING_APPROVAL", "DRAFT"] as const).map((s) => <Stat key={s} label={label(s)} value={by(s).n} sub={inrShort(by(s).v)} href={qs(s)} tone={s === "WON" ? "green" : s === "LOST" ? "red" : undefined} />)}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Submitted (count / value)" value={submitted.length} sub={inrShort(submitted.reduce((a, r) => a + Number(r.quoted_value), 0))} />
        <Stat label="Win ratio — count" value={won.n + lost.n ? pct((won.n / (won.n + lost.n)) * 100, 0) : "—"} />
        <Stat label="Win ratio — value" value={won.v + lost.v ? pct((won.v / (won.v + lost.v)) * 100, 0) : "—"} />
        {showCost && <Stat label="Avg margin quoted vs won" value={`${pct(avg(submitted))} / ${pct(avg(wonRows))}`} />}
        <Stat label="Discount leakage (quoted → final)" value={inrShort(leak)} tone={leak > 0 ? "amber" : undefined} />
      </div>
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card title="By vertical"><Bars data={group("vertical").map((g: any) => ({ k: g.k, v: g.v, won: g.won }))} x="k" bars={[{ key: "v", label: "Quoted" }, { key: "won", label: "Won" }]} height={200} /></Card>
        <Card title="By sales engineer"><Bars data={group("owner").map((g: any) => ({ k: g.k, v: g.v, won: g.won }))} x="k" bars={[{ key: "v", label: "Quoted" }, { key: "won", label: "Won" }]} height={200} /></Card>
        <Card title="By month"><Bars data={Object.values(all.reduce((a: Record<string, any>, r) => { const m = String(r.created_at.toISOString?.() ?? r.created_at).slice(0, 7); (a[m] ??= { m, v: 0, n: 0 }).v += Number(r.quoted_value); a[m].n++; return a; }, {})).sort((a: any, b: any) => a.m.localeCompare(b.m))} x="m" bars={[{ key: "v", label: "Quoted value" }]} height={200} /></Card>
      </div>
      <Card title={sp.status ? `${label(sp.status)} (${rows.length})` : `All proposals (${rows.length})`} actions={sp.status && <Link className="link text-xs" href="/proposals">Clear filter</Link>} bodyClass="p-0">
        {rows.length ? (
          <Table head={["Proposal", "Enquiry", "Customer", "Title", "Vertical", "Owner", "Rev", "Status", "Quoted", "Final", ...(showCost ? ["Margin"] : []), "Created"]}>
            {rows.map((r) => (
              <tr key={r.id}><td><Link className="link font-medium" href={`/proposals/${r.id}`}>{r.proposal_no}</Link></td><td className="text-xs">{r.enquiry_no}</td><td>{r.customer}</td><td className="max-w-xs">{r.title}</td><td>{r.vertical}</td><td>{r.owner}</td>
                <td>R{r.current_rev}</td><td><Badge status={r.status} /></td><td className="num">{inr(r.quoted_value)}</td><td className="num">{r.final_value ? inr(r.final_value) : "—"}</td>{showCost && <td className="num">{r.quoted_margin_pct ?? "—"}%</td>}<td>{dt(r.created_at)}</td></tr>
            ))}
          </Table>
        ) : <Empty>No proposals in this period</Empty>}
      </Card>
      <div className="mt-2 text-xs text-slate-500">Statuses: {PROPOSAL_STATUSES.map(label).join(" · ")}</div>
    </div>
  );
}
