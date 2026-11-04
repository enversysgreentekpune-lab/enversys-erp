"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { LayoutDashboard, Gauge, Building2, Target, BarChart3, FileText, Briefcase, ShoppingCart, Clock, Wallet, CheckSquare, Settings, ShieldCheck, Menu, X, Bell, Search, Sun, Moon, LogOut, User } from "lucide-react";

const ICONS: Record<string, any> = { me: LayoutDashboard, md: Gauge, customers: Building2, leads: Target, stats: BarChart3, proposals: FileText, wo: Briefcase, purchase: ShoppingCart, attendance: Clock, expenses: Wallet, approvals: CheckSquare, admin: Settings, audit: ShieldCheck };
export type NavItem = { href: string; label: string; icon: string; badge?: number };

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
  const side = (
    <nav className="flex flex-col gap-0.5 p-3">
      {nav.map((n) => {
        const Icon = ICONS[n.icon] ?? LayoutDashboard;
        const active = path === n.href || (n.href !== "/" && path.startsWith(n.href + "/") && !nav.some((o) => o.href !== n.href && o.href.startsWith(n.href) && path.startsWith(o.href)));
        return (
          <Link key={n.href} href={n.href} className={clsx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm", active ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")}>
            <Icon size={17} /> <span className="flex-1">{n.label}</span>
            {!!n.badge && <span className={clsx("rounded-full px-1.5 text-[11px] font-semibold", active ? "bg-white/20" : "bg-rose-100 text-rose-700")}>{n.badge}</span>}
          </Link>
        );
      })}
    </nav>
  );
  return (
    <div className="min-h-dvh lg:pl-60 print:pl-0">
      <aside className="print:hidden fixed inset-y-0 left-0 z-30 hidden w-60 overflow-y-auto border-r border-slate-200 bg-white lg:block dark:border-slate-800 dark:bg-slate-900">
        <Brand />
        {side}
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-white dark:bg-slate-900">
            <div className="flex items-center justify-between pr-3"><Brand /><button onClick={() => setOpen(false)} className="btn-ghost" aria-label="Close menu"><X size={18} /></button></div>
            {side}
          </aside>
        </div>
      )}
      <header className="print:hidden sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-slate-200 bg-white/90 px-3 backdrop-blur sm:px-5 dark:border-slate-800 dark:bg-slate-900/90">
        <button className="btn-ghost lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
        <form action="/search" className="relative max-w-md flex-1">
          <Search size={16} className="absolute left-2.5 top-2.5 text-slate-400" />
          <input name="q" placeholder="Search customer, enquiry, proposal, WO, PO…" className="input pl-8" />
        </form>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={toggleTheme} className="btn-ghost" aria-label="Toggle theme">{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
          <Link href="/notifications" className="btn-ghost relative" aria-label="Notifications">
            <Bell size={18} />
            {unread > 0 && <span className="absolute right-0.5 top-0.5 rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">{unread > 99 ? "99+" : unread}</span>}
          </Link>
          <Link href="/profile" className="btn-ghost hidden sm:inline-flex"><User size={16} /><span className="max-w-32 truncate">{user.name}</span></Link>
          <form action={logout}><button className="btn-ghost" aria-label="Log out" title="Log out"><LogOut size={18} /></button></form>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] p-4 sm:p-6">{children}</main>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 px-5 py-4">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">E</span>
      <span className="leading-tight"><span className="block font-semibold tracking-wide">ENVERSYS</span><span className="block text-[10px] text-slate-500">Business Suite</span></span>
    </Link>
  );
}
