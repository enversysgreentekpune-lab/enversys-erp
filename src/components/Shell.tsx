"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import {
  LayoutDashboard, Gauge, Building2, Target, BarChart3, FileText, Briefcase, ShoppingCart, Clock, Wallet, CheckSquare, Settings, ShieldCheck, Menu, X, Bell,
  Search, Sun, Moon, LogOut, User, Factory, Warehouse, Truck, Landmark, ClipboardList, Users, ListTodo, Award, Wrench, HardHat, Droplets,
} from "lucide-react";
import { LocationPing } from "./LocationPing";

const ICONS: Record<string, any> = {
  me: LayoutDashboard, md: Gauge, customers: Building2, leads: Target, stats: BarChart3, proposals: FileText, wo: Briefcase, purchase: ShoppingCart,
  attendance: Clock, expenses: Wallet, approvals: CheckSquare, admin: Settings, audit: ShieldCheck, mfg: Factory, store: Warehouse, dispatch: Truck,
  accounts: Landmark, so: Wrench, ic: HardHat, om: Droplets, employees: Users, tasks: ListTodo, performance: Award, orders: ClipboardList,
};
export type NavItem = { href: string; label: string; icon: string; badge?: number; group?: string };

export function Shell({ nav, user, unread, children, logout }: { nav: NavItem[]; user: { name: string; role: string }; unread: number; children: ReactNode; logout: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => { setDark(document.documentElement.classList.contains("dark")); }, []);
  const toggleTheme = () => {
    const d = !dark; setDark(d);
    document.documentElement.classList.toggle("dark", d);
    try { localStorage.setItem("theme", d ? "dark" : "light"); } catch {}
  };
  const isActive = (href: string) => {
    const [p] = href.split("?");
    return path === p || (p !== "/" && path.startsWith(p + "/") && !nav.some((o) => o.href !== href && o.href.split("?")[0].startsWith(p) && path.startsWith(o.href.split("?")[0]) && o.href.length > href.length));
  };
  const groups = [...new Set(nav.map((n) => n.group ?? ""))];
  const side = (
    <nav className="flex flex-col gap-3 p-3">
      {groups.map((g) => (
        <div key={g}>
          {g && <div className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{g}</div>}
          <div className="flex flex-col gap-0.5">
            {nav.filter((n) => (n.group ?? "") === g).map((n) => {
              const Icon = ICONS[n.icon] ?? LayoutDashboard;
              const active = isActive(n.href);
              return (
                <Link key={n.href} href={n.href} className={clsx("flex items-center gap-3 rounded-md border-l-2 px-3 py-1.5 text-sm",
                  active ? "border-brand-600 bg-brand-50 font-medium text-brand-700 dark:bg-brand-700/20 dark:text-brand-200" : "border-transparent text-slate-600 hover:bg-slate-50 hover:text-navy-900 dark:text-slate-300 dark:hover:bg-slate-800")}>
                  <Icon size={16} strokeWidth={1.8} /> <span className="flex-1">{n.label}</span>
                  {!!n.badge && <span className="rounded-full bg-rose-50 px-1.5 text-[11px] font-semibold text-rose-700">{n.badge}</span>}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
  return (
    <div className="min-h-dvh bg-white lg:pl-64 print:pl-0 dark:bg-slate-950">
      <LocationPing />
      <aside className="print:hidden fixed inset-y-0 left-0 z-30 hidden w-64 overflow-y-auto border-r border-slate-200 bg-white lg:block dark:border-slate-800 dark:bg-slate-900">
        <Brand />
        {side}
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-white dark:bg-slate-900">
            <div className="flex items-center justify-between pr-3"><Brand /><button onClick={() => setOpen(false)} className="btn-ghost" aria-label="Close menu"><X size={18} /></button></div>
            {side}
          </aside>
        </div>
      )}
      <header className="print:hidden sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-slate-200 bg-white px-3 sm:px-5 dark:border-slate-800 dark:bg-slate-900">
        <button className="btn-ghost lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
        <form action="/search" className="relative max-w-md flex-1">
          <Search size={16} className="absolute left-2.5 top-2.5 text-slate-400" />
          <input name="q" placeholder="Search client, enquiry, proposal, project code, PO…" className="input bg-slate-50 pl-8 dark:bg-slate-900" />
        </form>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={toggleTheme} className="btn-ghost" aria-label="Toggle theme">{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
          <Link href="/notifications" className="btn-ghost relative" aria-label="Notifications">
            <Bell size={18} />
            {unread > 0 && <span className="absolute right-0.5 top-0.5 rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">{unread > 99 ? "99+" : unread}</span>}
          </Link>
          <Link href="/profile" className="btn-ghost hidden sm:inline-flex"><User size={16} /><span className="max-w-40 truncate">{user.name}</span><span className="hidden text-xs text-slate-400 md:inline">· {user.role}</span></Link>
          <form action={logout}><button className="btn-ghost" aria-label="Log out" title="Log out"><LogOut size={18} /></button></form>
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] p-4 sm:p-6">{children}</main>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="block px-5 pb-3 pt-5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/enversys-logo.png" alt="Enversys" width={160} height={31} className="h-auto w-40 dark:brightness-125" />
      <span className="mt-1 block text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">Business Suite</span>
    </Link>
  );
}
