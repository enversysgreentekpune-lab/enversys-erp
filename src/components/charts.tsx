"use client";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, PieChart, Pie, Cell, LineChart, Line, ComposedChart, Area } from "recharts";

const COLORS = ["#0b5394", "#2a9d8f", "#e9a23b", "#e76f51", "#8e7cc3", "#5fa8d3", "#90be6d", "#f4a261", "#6c757d"];
const fmt = (v: number) => (Math.abs(v) >= 1e7 ? `${(v / 1e7).toFixed(2)} Cr` : Math.abs(v) >= 1e5 ? `${(v / 1e5).toFixed(1)} L` : Math.round(v).toLocaleString("en-IN"));
const tip = { contentStyle: { borderRadius: 8, fontSize: 12 }, formatter: (v: any) => (typeof v === "number" ? fmt(v) : v) };

export function Bars({ data, x, bars, height = 240, stacked, horizontal, money = true }: { data: any[]; x: string; bars: { key: string; label: string; color?: string }[]; height?: number; stacked?: boolean; horizontal?: boolean; money?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ left: horizontal ? 10 : 0, right: 10, top: 5, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        {horizontal ? <><XAxis type="number" tickFormatter={money ? fmt : undefined} fontSize={11} /><YAxis type="category" dataKey={x} width={110} fontSize={11} /></>
          : <><XAxis dataKey={x} fontSize={11} /><YAxis tickFormatter={money ? fmt : undefined} fontSize={11} width={55} /></>}
        <Tooltip {...tip} formatter={(v: any) => (money ? fmt(Number(v)) : v)} />
        {bars.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {bars.map((b, i) => <Bar key={b.key} dataKey={b.key} name={b.label} fill={b.color ?? COLORS[i]} stackId={stacked ? "s" : undefined} radius={stacked ? 0 : [3, 3, 0, 0]} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, name, value, height = 220, money = true }: { data: any[]; name: string; value: string; height?: number; money?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey={value} nameKey={name} innerRadius="55%" outerRadius="85%" paddingAngle={2}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip {...tip} formatter={(v: any) => (money ? fmt(Number(v)) : v)} />
        <Legend wrapperStyle={{ fontSize: 11 }} layout="vertical" align="right" verticalAlign="middle" />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function Trend({ data, x, lines, bars = [], height = 260 }: { data: any[]; x: string; lines: { key: string; label: string; color?: string }[]; bars?: { key: string; label: string; color?: string }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ left: 0, right: 10, top: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey={x} fontSize={11} /><YAxis tickFormatter={fmt} fontSize={11} width={55} />
        <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
        {bars.map((b, i) => <Bar key={b.key} dataKey={b.key} name={b.label} fill={b.color ?? COLORS[i + 3]} stackId="s" />)}
        {lines.map((l, i) => <Line key={l.key} dataKey={l.key} name={l.label} stroke={l.color ?? COLORS[i]} strokeWidth={2} dot={{ r: 2 }} type="linear" />)}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function Funnel({ data }: { data: { label: string; n: number; v: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  return (
    <div className="space-y-1.5">
      {data.map((d, i) => (
        <div key={d.label} className="flex items-center gap-2 text-xs">
          <div className="w-24 shrink-0 text-slate-500">{d.label}</div>
          <div className="flex-1">
            <div className="flex h-6 items-center rounded px-2 font-medium text-white" style={{ width: `${Math.max(8, (d.n / max) * 100)}%`, background: COLORS[0], opacity: 1 - i * 0.12 }}>{d.n}</div>
          </div>
          <div className="w-20 shrink-0 text-right tabular-nums text-slate-600">{fmt(d.v)}</div>
          <div className="w-12 shrink-0 text-right text-slate-400">{i > 0 && data[i - 1].n ? `${Math.round((d.n / data[i - 1].n) * 100)}%` : ""}</div>
        </div>
      ))}
    </div>
  );
}
