import Link from "next/link";
import { requirePage, can } from "@/lib/auth";
import { q } from "@/lib/db";
import { resolveFrame, type Frame } from "@/lib/period";
import { inrShort, pct, num, label } from "@/lib/format";
import { salesKpis, pipeline, funnel, lossReasons, byDimension, leaderboard, cycleTimes, ageing, forecast } from "@/lib/queries";
import { PageHeader, Card, Stat, Table, Empty } from "@/components/ui";
import { FrameBar } from "@/components/FrameBar";
import { Bars, Donut, Funnel, Trend } from "@/components/charts";

export const metadata = { title: "Sales Analytics" };
export default async function LeadStats({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requirePage("leads");
  const sp = await searchParams;
  const r = resolveFrame((sp.frame as Frame) ?? "fy", new Date(), { from: sp.from, to: sp.to });
  const sc = can(u, "leads", "view");
  const f = { verticalId: sc === "dept" ? u.verticalId : sp.vertical || null, ownerId: sc === "own" ? u.id : null };
  const [k, pipe, fun, loss, byV, byS, byO, byC, byI, byM, lb, cyc, age, fc] = await Promise.all([
    salesKpis(r, f), pipeline(f), funnel(r, f), lossReasons(r, f), byDimension("vertical", r, f), byDimension("source", r, f), byDimension("owner", r, f),
    byDimension("customer", r, f), byDimension("industry", r, f), byDimension("month", r, f), leaderboard(r), cycleTimes(r), ageing(), forecast(),
  ]);
  const verts = await q(`select id, name from vertical order by sort`);
  const dimTable = (rows: any[], title: string) => (
    <Card title={title} bodyClass="p-0"><Table head={["", "Enquiries", "Value", "Open", "Won", "Lost", "Hit %"]}>
      {rows.slice(0, 10).map((x) => <tr key={x.k}><td>{label(x.k) || x.k}</td><td className="num">{x.n}</td><td className="num">{inrShort(x.v)}</td><td className="num">{x.open}</td><td className="num">{x.won}</td><td className="num">{x.lost}</td><td className="num">{x.won + x.lost ? pct((x.won / (x.won + x.lost)) * 100, 0) : "—"}</td></tr>)}
    </Table>{!rows.length && <Empty>No data</Empty>}</Card>
  );
  return (
    <div>
      <PageHeader title="Lead statistics & sales analytics" subtitle={r.label} />
      <FrameBar verticals={sc === "company" ? verts : undefined} showCompare={false} showUnit={false} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Enquiries" value={k.enquiries.n} sub={inrShort(k.enquiries.v)} href="/leads" />
        <Stat label="Proposals submitted" value={k.submitted.n} sub={inrShort(k.submitted.v)} href="/proposals" />
        <Stat label="Won" value={k.won.n} sub={inrShort(k.won.v)} tone="green" href="/proposals?status=WON" />
        <Stat label="Lost" value={k.lost.n} sub={inrShort(k.lost.v)} tone="red" href="/proposals?status=LOST" />
        <Stat label="Win rate (count / value)" value={`${pct(k.winRateCount, 0)} / ${pct(k.winRateValue, 0)}`} />
        <Stat label="Avg days to quote" value={num(cyc?.avg_days_to_quote, 1)} />
        <Stat label="Avg sales cycle (days)" value={num(cyc?.avg_sales_cycle, 1)} />
        <Stat label="Weighted pipeline" value={inrShort(pipe.weighted)} sub={`${pipe.count} open`} href="/leads?open=1" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Conversion funnel"><Funnel data={fun} /></Card>
        <Card title="Monthly enquiry inflow"><Bars data={byM.map((m) => ({ k: m.k, n: m.n }))} x="k" bars={[{ key: "n", label: "Enquiries" }]} money={false} height={220} /></Card>
        <Card title="Forecast — weighted pipeline by expected closure month"><Trend data={fc.map((x) => ({ ...x, v: Number(x.v), weighted: Number(x.weighted) }))} x="m" lines={[{ key: "weighted", label: "Weighted" }]} bars={[{ key: "v", label: "Gross pipeline", color: "#cbd5e1" }]} height={240} /></Card>
        <Card title="Loss reason analysis">{loss.length ? <><Donut data={loss.map((x) => ({ ...x, v: Number(x.v) }))} name="reason" value="v" /><div className="mt-2 text-xs text-slate-500">Competitors: {loss.map((l) => l.competitors).filter(Boolean).join(", ") || "—"}</div></> : <Empty>No losses</Empty>}</Card>
        <Card title="Ageing of open leads"><Bars data={age.map((a) => ({ k: a.bucket + " d", n: a.n, v: Number(a.v) }))} x="k" bars={[{ key: "v", label: "Value" }]} height={200} /></Card>
        <Card title="Leads by source"><Donut data={byS.map((x) => ({ k: label(x.k), n: x.n }))} name="k" value="n" money={false} /></Card>
        {dimTable(byV, "By vertical")}{dimTable(byO, "By sales engineer")}{dimTable(byC, "By customer")}{dimTable(byI, "By industry")}
        <Card title="Margins & discount leakage">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {can(u, "costing", "view") && <><div><dt className="text-xs text-slate-500">Avg margin quoted</dt><dd className="text-lg font-semibold">{pct(cyc?.avg_margin_quoted)}</dd></div><div><dt className="text-xs text-slate-500">Avg margin won</dt><dd className="text-lg font-semibold">{pct(cyc?.avg_margin_won)}</dd></div></>}
            <div><dt className="text-xs text-slate-500">Won — quoted value</dt><dd className="text-lg font-semibold">{inrShort(cyc?.won_quoted)}</dd></div>
            <div><dt className="text-xs text-slate-500">Won — final negotiated</dt><dd className="text-lg font-semibold">{inrShort(cyc?.won_final)}</dd></div>
          </dl>
        </Card>
        <Card title="Sales engineer leaderboard" bodyClass="p-0"><Table head={["Engineer", "Enquiries", "Proposals", "Won", "Lost", "Hit", "Value won"]}>{lb.map((x) => <tr key={x.id}><td>{x.name}</td><td className="num">{x.enquiries}</td><td className="num">{x.proposals}</td><td className="num">{x.won}</td><td className="num">{x.lost}</td><td className="num">{x.won + x.lost ? pct((x.won / (x.won + x.lost)) * 100, 0) : "—"}</td><td className="num">{inrShort(x.won_value)}</td></tr>)}</Table></Card>
      </div>
    </div>
  );
}
