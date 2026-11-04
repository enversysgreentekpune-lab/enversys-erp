import Link from "next/link";
import clsx from "clsx";
import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && <Link href={back.href} className="text-xs text-slate-500 hover:underline">← {back.label}</Link>}
        <h1 className="truncate text-xl font-semibold sm:text-2xl">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, bodyClass, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; id?: string }) {
  return (
    <section id={id} className={clsx("card", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={clsx("p-4", bodyClass)}>{children}</div>
    </section>
  );
}

const TONES: Record<string, string> = {
  gray: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  red: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
  purple: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
};
const STATUS_TONE: Record<string, string> = {
  NEW: "blue", QUALIFIED: "blue", SITE_VISIT: "purple", ESTIMATION: "purple", PROPOSAL_SUBMITTED: "amber", SUBMITTED: "amber",
  IN_DISCUSSION: "amber", IN_NEGOTIATION: "amber", WON: "green", APPROVED: "green", DONE: "green", P: "green", COMPLETED: "green", RECEIVED: "green", SENT: "green", INVOICED: "green",
  LOST: "red", REJECTED: "red", A: "red", FAILED: "red", CANCELLED: "gray", DROPPED: "gray", REGRETTED: "gray", ON_HOLD: "gray",
  DRAFT: "gray", PENDING_APPROVAL: "purple", PENDING: "purple", TODO: "blue", IN_PROGRESS: "amber", KICKOFF: "blue",
  CRITICAL: "red", HIGH: "amber", MEDIUM: "blue", LOW: "gray", L: "purple", HD: "amber", OD: "blue", WO: "gray", H: "gray",
  RED: "red", AMBER: "amber", GREEN: "green",
};
export function Badge({ children, tone, status }: { children?: ReactNode; tone?: keyof typeof TONES; status?: string }) {
  const t = tone ?? (status ? STATUS_TONE[status] ?? "gray" : "gray");
  return <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONES[t])}>{children ?? status?.replace(/_/g, " ")}</span>;
}

export function Stat({ label, value, sub, href, tone, delta }: { label: string; value: ReactNode; sub?: ReactNode; href?: string; tone?: "red" | "green" | "amber"; delta?: number | null }) {
  const inner = (
    <div className={clsx("card h-full p-3 transition", href && "hover:border-brand-500 hover:shadow")}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={clsx("mt-1 text-lg font-semibold tabular-nums sm:text-xl", tone === "red" && "text-rose-600", tone === "green" && "text-emerald-600", tone === "amber" && "text-amber-600")}>{value}</div>
      <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
        {delta != null && Number.isFinite(delta) && (
          <span className={clsx("font-medium", delta >= 0 ? "text-emerald-600" : "text-rose-600")}>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(0)}%</span>
        )}
        {sub}
      </div>
    </div>
  );
  return href ? <Link href={href} className="block">{inner}</Link> : inner;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-8 text-center text-sm text-slate-500">{children}</div>;
}

export function Field({ label, children, className, hint }: { label: string; children: ReactNode; className?: string; hint?: string }) {
  return (
    <label className={clsx("block", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

export function Tabs({ tabs, active, base }: { tabs: { key: string; label: string }[]; active: string; base: string }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
      {tabs.map((t) => (
        <Link key={t.key} href={`${base}${base.includes("?") ? "&" : "?"}tab=${t.key}`} scroll={false}
          className={clsx("whitespace-nowrap border-b-2 px-3 py-2 text-sm", active === t.key ? "border-brand-600 font-semibold text-brand-600" : "border-transparent text-slate-500 hover:text-slate-800")}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}

export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={clsx("overflow-x-auto", className)}>
      <table className="tbl">
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Progress({ value, tone }: { value: number; tone?: "red" | "amber" | "green" }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800">
      <div className={clsx("h-1.5 rounded-full", tone === "red" ? "bg-rose-500" : tone === "amber" ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${v}%` }} />
    </div>
  );
}
