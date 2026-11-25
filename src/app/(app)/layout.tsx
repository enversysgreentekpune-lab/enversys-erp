import { requireUser, can, logout } from "@/lib/auth";
import { one } from "@/lib/db";
import { Shell, type NavItem } from "@/components/Shell";
import { redirect } from "next/navigation";
import { FIELD_ROLES, OM_FIELD_ROLES } from "@/lib/rbac";
import { approvableRoles } from "@/lib/access";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  const unread = (await one<{ n: number }>(`select count(*)::int n from notification where employee_id=$1 and read_at is null`, [u.id]))?.n ?? 0;
  const pendingAppr = (await one<{ n: number }>(`select count(*)::int n from approval where status='PENDING' and (approver_id=$1 or (approver_id is null and approver_role = any($2)))`, [u.id, approvableRoles(u)]))?.n ?? 0;
  const wide = (s: string | null) => !!s && s !== "own";
  const nav: NavItem[] = [];
  const add = (group: string, href: string, label: string, icon: string, badge?: number) => nav.push({ group, href, label, icon, badge });

  if (FIELD_ROLES.includes(u.roleCode)) {
    // Field employees: attendance, tasks and their own expense claims only
    add("", "/me", "My Attendance", "me");
    add("", "/tasks", "My Tasks", "tasks");
    add("", "/expenses?tab=claims", "My Expenses", "expenses");
    if (OM_FIELD_ROLES.includes(u.roleCode)) add("", "/om", "My O&M Site", "om");
    if (["IC_ENGINEER", "SITE_ENGINEER"].includes(u.roleCode)) add("", "/ic", "My I&C Projects", "ic");
  } else {
    add("Overview", "/me", "My Dashboard", "me");
    if (can(u, "dashboard_md", "view")) add("Overview", "/md", u.roleCode === "MD" ? "Directors Dashboard" : "Executive Dashboard", "md");
    if (can(u, "customers", "view")) add("Sales", "/customers", "Clients", "customers");
    if (can(u, "leads", "view")) {
      add("Sales", "/leads", "Lead Enquiries", "leads");
      add("Sales", "/proposals", "Proposals", "proposals");
      add("Sales", "/leads/stats", "Sales Analytics", "stats");
    }
    if (wide(can(u, "work_orders", "view")) || can(u, "work_orders", "edit")) {
      add("Operations", "/work-orders", "Projects (PO & Supply)", "wo");
      add("Operations", "/so", "Work Orders (WO)", "so");
    }
    if (can(u, "purchase", "view")) add("Operations", "/purchase", "Purchase", "purchase");
    if (can(u, "stores", "view")) add("Operations", "/store", "Store", "store");
    if (wide(can(u, "manufacturing", "view"))) add("Operations", "/manufacturing", "Manufacturing", "mfg");
    if (can(u, "inspection", "view")) add("Operations", "/dispatch", "Dispatch", "dispatch");
    if (wide(can(u, "field_services", "view")) || wide(can(u, "inspection", "view"))) add("Operations", "/ic", "Installation & Commissioning", "ic");
    if (can(u, "field_services", "view")) add("Operations", "/om", "O&M Operations", "om");
    if (can(u, "finance", "view")) add("Operations", "/accounts", "Accounts", "accounts");
    if (wide(can(u, "attendance", "view")) || wide(can(u, "hr", "view"))) add("People", "/employees", "Employees", "employees");
    add("People", "/tasks", "Tasks", "tasks");
    if (wide(can(u, "tasks", "view"))) add("People", "/performance", "Performance", "performance");
    if (wide(can(u, "attendance", "view"))) add("People", "/attendance", "Time Office", "attendance");
    add("People", "/expenses", "Expenses", "expenses");
    add("People", "/approvals", "Approvals", "approvals", pendingAppr);
    if (can(u, "settings", "view")) add("Admin", "/admin", "Admin & Settings", "admin");
    else if (can(u, "hr", "view") === "company") add("Admin", "/admin/employees", "Employee Master", "admin");
    if (can(u, "audit", "view")) add("Admin", "/admin/audit", "Audit Log", "audit");
  }

  async function doLogout() {
    "use server";
    await logout();
    redirect("/login");
  }
  return <Shell nav={nav} user={{ name: u.name, role: u.roleName }} unread={unread} logout={doLogout}>{children}</Shell>;
}
