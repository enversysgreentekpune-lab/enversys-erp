import { requireUser, can, logout } from "@/lib/auth";
import { one } from "@/lib/db";
import { Shell, type NavItem } from "@/components/Shell";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  const unread = (await one<{ n: number }>(`select count(*)::int n from notification where employee_id=$1 and read_at is null`, [u.id]))?.n ?? 0;
  const pendingAppr = (await one<{ n: number }>(`select count(*)::int n from approval where status='PENDING' and approver_role = any($1)`,
    [u.roleCode === "MD" || u.roleCode === "SUPER_ADMIN" ? ["MD", "BUSINESS_HEAD", "SALES_MANAGER", "PURCHASE_MANAGER"] : u.roleCode === "BUSINESS_HEAD" ? ["BUSINESS_HEAD", "SALES_MANAGER", "PURCHASE_MANAGER"] : [u.roleCode]]))?.n ?? 0;
  const nav: NavItem[] = [{ href: "/me", label: "My Dashboard", icon: "me" }];
  if (can(u, "dashboard_md", "view")) nav.push({ href: "/md", label: u.roleCode === "MD" ? "MD Command Centre" : "Executive Dashboard", icon: "md" });
  if (can(u, "customers", "view")) nav.push({ href: "/customers", label: "Customers", icon: "customers" });
  if (can(u, "leads", "view")) {
    nav.push({ href: "/leads", label: "Leads & Enquiries", icon: "leads" });
    nav.push({ href: "/proposals", label: "Proposals", icon: "proposals" });
    nav.push({ href: "/leads/stats", label: "Sales Analytics", icon: "stats" });
  }
  if (can(u, "work_orders", "view")) nav.push({ href: "/work-orders", label: "Work Orders", icon: "wo" });
  if (can(u, "purchase", "view")) nav.push({ href: "/purchase", label: "Purchase", icon: "purchase" });
  const att = can(u, "attendance", "view");
  if (att && att !== "own") nav.push({ href: "/attendance", label: "Time Office", icon: "attendance" });
  if (can(u, "office_admin", "view") || can(u, "factory_admin", "view")) nav.push({ href: "/expenses", label: "Admin Expenses", icon: "expenses" });
  nav.push({ href: "/approvals", label: "Approvals", icon: "approvals", badge: pendingAppr });
  if (!can(u, "settings", "view") && can(u, "hr", "view") === "company") nav.push({ href: "/admin/employees", label: "Employees", icon: "admin" });
  if (can(u, "settings", "view")) nav.push({ href: "/admin", label: "Admin & Settings", icon: "admin" });
  if (can(u, "audit", "view")) nav.push({ href: "/admin/audit", label: "Audit Log", icon: "audit" });

  async function doLogout() {
    "use server";
    await logout();
    redirect("/login");
  }
  return <Shell nav={nav} user={{ name: u.name, role: u.roleName }} unread={unread} logout={doLogout}>{children}</Shell>;
}
