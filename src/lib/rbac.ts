// Role-based access control: Module x Action -> Scope (own < team < dept < company)
export const MODULES = [
  { code: "dashboard_md", name: "MD / Executive Dashboard" },
  { code: "customers", name: "Customers" },
  { code: "leads", name: "Leads & Proposals" },
  { code: "costing", name: "Cost Sheets / Margin (sensitive)" },
  { code: "purchase", name: "Purchase Orders" },
  { code: "work_orders", name: "Work Orders / Projects" },
  { code: "manufacturing", name: "Manufacturing (Markal)" },
  { code: "inspection", name: "Inspection & Dispatch" },
  { code: "field_services", name: "I&C / O&M / Maintenance" },
  { code: "finance", name: "Finance" },
  { code: "hr", name: "HR" },
  { code: "attendance", name: "Time Office / Attendance" },
  { code: "office_admin", name: "Office Admin Expenses" },
  { code: "factory_admin", name: "Factory Admin Expenses" },
  { code: "settings", name: "Settings / Roles / Masters" },
  { code: "audit", name: "Audit Log" },
] as const;
export type ModuleCode = (typeof MODULES)[number]["code"];

export const ACTIONS = ["view", "create", "edit", "delete", "approve", "export", "send"] as const;
export type Action = (typeof ACTIONS)[number];
export const SCOPES = ["own", "team", "dept", "company"] as const;
export type Scope = (typeof SCOPES)[number];
export const scopeRank = (s: Scope | null | undefined) => (s ? SCOPES.indexOf(s) + 1 : 0);
export const maxScope = (a: Scope | null | undefined, b: Scope | null | undefined): Scope | null =>
  scopeRank(a) >= scopeRank(b) ? a ?? null : b ?? null;

export const ROLES: { code: string; name: string }[] = [
  ["SUPER_ADMIN", "Super Admin (IT)"], ["MD", "Managing Director"], ["BUSINESS_HEAD", "Business Head"],
  ["SALES_MANAGER", "Sales Manager"], ["SALES_ENGINEER", "Sales Engineer"], ["ESTIMATION_ENGINEER", "Estimation Engineer"],
  ["PURCHASE_MANAGER", "Purchase Manager"], ["PURCHASE_EXEC", "Purchase Executive"], ["PROJECT_MANAGER", "Project Manager"],
  ["SITE_ENGINEER", "Executor / Site Engineer"], ["FACTORY_MANAGER", "Factory Manager"], ["PRODUCTION_SUPERVISOR", "Production Supervisor"],
  ["FACTORY_WORKER", "Factory Worker"], ["QA_INSPECTOR", "QA/QC Inspector"], ["IC_ENGINEER", "I&C Engineer"],
  ["OM_MANAGER", "O&M Manager"], ["OM_TECHNICIAN", "O&M Technician"], ["CONSULTANT", "Consultant"],
  ["ACCOUNTS_MANAGER", "Accounts Manager"], ["ACCOUNTANT", "Accountant"], ["HR_MANAGER", "HR Manager"],
  ["TIME_OFFICE", "Time Office Keeper"], ["ADMIN_EXEC", "Admin Executive"], ["STOREKEEPER", "Storekeeper"],
  ["DISPATCH_INCHARGE", "Dispatch In-charge"], ["EMPLOYEE", "Employee (basic)"],
].map(([code, name]) => ({ code, name }));

// action letters: v=view c=create e=edit d=delete a=approve x=export s=send
const L: Record<string, Action> = { v: "view", c: "create", e: "edit", d: "delete", a: "approve", x: "export", s: "send" };
type Grant = [string, Scope]; // e.g. ["vcedxs","company"]
type RoleMatrix = Partial<Record<ModuleCode, Grant | Grant[]>>;
const FULL = "vcedaxs";

// Base grants every employee gets (self-service)
const BASE: RoleMatrix = {
  work_orders: ["v", "own"], manufacturing: ["v", "own"], field_services: ["v", "own"],
  hr: ["v", "own"], attendance: ["vc", "own"], office_admin: ["c", "own"],
};

// Default matrix (spec §3.3) — editable afterwards from Admin → Roles & Permissions
export const DEFAULT_MATRIX: Record<string, RoleMatrix> = {
  SUPER_ADMIN: Object.fromEntries(MODULES.map((m) => [m.code, [FULL, "company"]])) as RoleMatrix,
  MD: Object.fromEntries(MODULES.map((m) => [m.code, [FULL, "company"]])) as RoleMatrix,
  BUSINESS_HEAD: {
    dashboard_md: ["vx", "dept"], customers: [FULL, "dept"], leads: [FULL, "dept"], costing: [FULL, "dept"],
    purchase: ["vax", "dept"], work_orders: [FULL, "dept"], manufacturing: ["vx", "company"], inspection: ["vx", "company"],
    field_services: [FULL, "dept"], finance: ["vx", "dept"], hr: ["v", "team"], attendance: [["v", "team"], ["c", "own"]],
    office_admin: [["v", "company"], ["c", "own"]], factory_admin: ["v", "company"],
  },
  SALES_MANAGER: { customers: [["vx", "company"], ["ce", "team"]], leads: ["vcedaxs", "team"], costing: ["vce", "team"] },
  SALES_ENGINEER: { customers: [["v", "company"], ["ce", "own"]], leads: ["vcexs", "own"], costing: ["vce", "own"] },
  ESTIMATION_ENGINEER: { customers: ["v", "company"], leads: [["v", "company"], ["ce", "own"]], costing: ["vce", "company"] },
  PURCHASE_MANAGER: { customers: ["v", "company"], leads: ["v", "company"], costing: ["v", "company"], purchase: [FULL, "company"], work_orders: ["v", "company"], manufacturing: ["v", "company"] },
  PURCHASE_EXEC: { customers: ["v", "company"], costing: ["v", "company"], purchase: ["vcexs", "company"], work_orders: ["v", "company"] },
  PROJECT_MANAGER: {
    customers: ["v", "company"], leads: ["v", "own"], costing: ["v", "own"], purchase: ["vc", "own"],
    work_orders: [FULL, "own"], manufacturing: ["vc", "own"], inspection: [FULL, "own"], field_services: [FULL, "own"],
    finance: ["v", "own"], hr: ["v", "team"], attendance: [["v", "team"], ["c", "own"]],
  },
  SITE_ENGINEER: { work_orders: ["ve", "own"], inspection: ["vc", "own"], field_services: ["vce", "own"] },
  FACTORY_MANAGER: {
    purchase: ["vc", "company"], work_orders: ["v", "company"], manufacturing: [FULL, "company"], inspection: ["vc", "company"],
    finance: ["v", "own"], hr: ["v", "team"], attendance: [["v", "team"], ["ce", "team"]], factory_admin: [FULL, "company"],
  },
  PRODUCTION_SUPERVISOR: { manufacturing: ["vce", "team"], inspection: ["vc", "team"], attendance: ["v", "team"] },
  QA_INSPECTOR: { work_orders: ["v", "company"], manufacturing: ["v", "company"], inspection: ["vcexs", "company"] },
  IC_ENGINEER: { field_services: ["vce", "own"] },
  OM_MANAGER: { customers: ["v", "company"], work_orders: ["v", "dept"], field_services: [FULL, "dept"], hr: ["v", "team"], attendance: ["v", "team"] },
  CONSULTANT: { work_orders: ["v", "own"] },
  ACCOUNTS_MANAGER: {
    dashboard_md: ["v", "company"], customers: ["vx", "company"], leads: ["v", "company"], costing: ["v", "company"], purchase: ["vx", "company"],
    work_orders: ["vx", "company"], manufacturing: ["v", "company"], inspection: ["v", "company"], field_services: ["v", "company"],
    finance: [FULL, "company"], hr: ["vex", "company"], attendance: ["vx", "company"],
    office_admin: [FULL, "company"], factory_admin: [FULL, "company"],
  },
  ACCOUNTANT: {
    customers: ["v", "company"], purchase: ["v", "company"], work_orders: ["v", "company"], finance: ["vcex", "company"],
    hr: ["v", "company"], office_admin: ["vcex", "company"], factory_admin: ["vcex", "company"],
  },
  HR_MANAGER: { hr: [FULL, "company"], attendance: [FULL, "company"], office_admin: [["vcex", "company"]] },
  TIME_OFFICE: { hr: ["v", "company"], attendance: ["vcex", "company"] },
  ADMIN_EXEC: { office_admin: ["vce", "company"], attendance: ["v", "own"] },
  STOREKEEPER: { purchase: ["v", "company"], work_orders: ["v", "company"], manufacturing: ["v", "company"] },
  DISPATCH_INCHARGE: { work_orders: ["v", "company"], inspection: ["vce", "company"] },
};

export type PermMap = Record<string, Scope>; // key `${module}:${action}`

export function expandMatrix(roleCode: string): PermMap {
  const out: PermMap = {};
  const add = (m: RoleMatrix) => {
    for (const [mod, g] of Object.entries(m)) {
      const grants: Grant[] = Array.isArray(g![0]) ? (g as Grant[]) : [g as Grant];
      for (const [letters, scope] of grants)
        for (const ch of letters) {
          const k = `${mod}:${L[ch]}`;
          out[k] = maxScope(out[k], scope)!;
        }
    }
  };
  add(BASE);
  add(DEFAULT_MATRIX[roleCode] ?? {});
  return out;
}

export function scopeOf(perms: PermMap, module: ModuleCode, action: Action): Scope | null {
  return perms[`${module}:${action}`] ?? null;
}
