# Default role–permission matrix

_Generated from `src/lib/rbac.ts` (`npx tsx scripts/gen-permissions-doc.ts`). This is the **seed**; the live matrix is edited in **Admin → Roles & permissions** without code changes, and every edit is audit-logged._

Scope letters: **O** = own records · **T** = team (me + all reportees, recursive) · **V** = my vertical/department · **C** = company. Actions: v=view c=create e=edit d=delete a=approve x=export s=send/print. "—" = no access.

**Leads and proposals:** only the MD (and Super Admin) see every lead and proposal. Everyone else sees only the leads assigned to them or created by them, and only the proposals they created or that are assigned to them, plus any proposal they are asked to approve. **Field employees** (Site Engineer, O&M Technician, I&C Engineer) see only their attendance, tasks and their own expense claims.

Every other role also inherits self-service grants: own tasks on WOs / manufacturing / field services, own HR record, own attendance (view + check-in), and submitting own expense claims.

| Role | MD / Executive Dashboard | Customers | Leads & Proposals | Cost Sheets / Margin (sensitive) | Purchase Orders | Work Orders / Projects | Manufacturing (Markal) | Stores & Material | Inspection & Dispatch | I&C / O&M / Maintenance | Finance | HR | Time Office / Attendance | Tasks & Performance | Office Admin Expenses | Factory Admin Expenses | Settings / Roles / Masters | Audit Log |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Super Admin (IT)** | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C |
| **Managing Director** | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C | vcedaes:C |
| **Business Head** | ve:V | vcedaes:V | vcedes:O a:C | vcedaes:V | vae:V | vcedaes:V | ve:C | v:C | ve:C | vcedaes:V | ve:V | v:T | v:T c:O | vcea:T | v:C c:O | v:C | — | — |
| **Sales Manager** | — | ve:C ce:T | vcedes:O a:C | vce:O | — | v:O | v:O | — | — | v:O | — | v:O | vc:O | vcea:T | c:O | — | — | — |
| **Sales Engineer** | — | v:C ce:O | vcees:O | vce:O | — | v:O | v:O | — | — | v:O | — | v:O | vc:O | vce:O | c:O | — | — | — |
| **Estimation Engineer** | — | v:C | vcees:O | vce:O | — | v:O | v:O | — | — | v:O | — | v:O | vc:O | vce:O | c:O | — | — | — |
| **Purchase Manager** | — | v:C | — | v:C | vcedaes:C | v:C | v:C | ve:C | — | v:O | — | v:O | vc:O | vcea:T | c:O | — | — | — |
| **Purchase Executive** | — | v:C | — | v:C | vcees:C | v:C | v:O | v:C | — | v:O | — | v:O | vc:O | vce:O | c:O | — | — | — |
| **Project Manager** | — | v:C | v:O | v:O | vc:O | vcedaes:O | vc:O | v:C | vcedaes:O | vcedaes:O | v:O | v:T | v:T c:O | vcea:T | c:O | — | — | — |
| **Executor / Site Engineer** | — | — | — | — | — | — | — | — | — | — | — | v:O | vc:O | vce:O | c:O | — | — | — |
| **Factory Manager** | — | — | — | — | vc:C | v:C | vcedaes:C | vce:C | vc:C | v:O | v:O | v:T | vce:T | vcea:T | c:O | vcedaes:C | — | — |
| **Production Supervisor** | — | — | — | — | — | v:O | vce:C | vc:C | vc:T | v:O | — | v:O | v:T c:O | vcea:T | c:O | — | — | — |
| **Factory Worker** | — | — | — | — | — | v:O | v:O | — | — | v:O | — | v:O | vc:O | vce:O | c:O | — | — | — |
| **QA/QC Inspector** | — | — | — | — | — | v:C | v:C | — | vcees:C | v:O | — | v:O | vc:O | vce:O | c:O | — | — | — |
| **I&C Engineer** | — | — | — | — | — | — | — | — | — | — | — | v:O | vc:O | vce:O | c:O | — | — | — |
| **O&M Manager** | — | v:C | — | — | — | v:V | v:O | — | — | vcedaes:V | — | v:T | v:T c:O | vcea:T | c:O | — | — | — |
| **O&M Technician** | — | — | — | — | — | — | — | — | — | — | — | v:O | vc:O | vce:O | c:O | — | — | — |
| **Consultant** | — | — | — | — | — | v:O | v:O | — | — | v:O | — | v:O | vc:O | vce:O | c:O | — | — | — |
| **Accounts Manager** | v:C | ve:C | — | v:C | ve:C | ve:C | v:C | v:C | v:C | v:C | vcedaes:C | vee:C | ve:C c:O | vcea:T | vcedaes:C | vcedaes:C | — | — |
| **Accountant** | — | v:C | — | — | v:C | v:C | v:O | — | — | v:O | vcee:C | v:C | vc:O | vce:O | vcee:C | vcee:C | — | — |
| **HR Manager** | — | — | — | — | — | v:O | v:O | — | — | v:O | — | vcedaes:C | vcedaes:C | vceae:C | vcee:C | — | — | — |
| **Time Office Keeper** | — | — | — | — | — | v:O | v:O | — | — | v:O | — | v:C | vcee:C | vce:O | c:O | — | — | — |
| **Admin Executive** | — | — | — | — | — | v:O | v:O | — | — | v:O | — | v:O | vc:O | vce:O | vce:C | — | — | — |
| **Storekeeper** | — | — | — | — | vc:C | v:C | v:C | vcee:C | — | v:O | — | v:O | vc:O | vce:O | c:O | — | — | — |
| **Dispatch In-charge** | — | — | — | — | — | v:C | v:O | v:C | vcees:C | v:O | — | v:O | vc:O | vce:O | c:O | — | — | — |
| **Employee (basic)** | — | — | — | — | — | v:O | v:O | — | — | v:O | — | v:O | vc:O | vce:O | c:O | — | — | — |

## Sensitive fields

The **Cost Sheets / Margin** module gates all cost, budget, margin and contribution figures (proposal cost sheet, WO budget vs actual, margin columns in registers and exports). Without `costing.view` they are hidden or shown as •••. `costing.edit` allows editing cost lines; `costing.approve` is required to change the margin %. Billing figures on a WO are additionally hidden from roles without WO edit rights (shop-floor, technicians), and assignment notifications to executors omit contract values.

## Approval matrix (seeded, editable in Admin → Approval matrix)

| Document | Range | Approver |
|---|---|---|
| Quote discount | 0 – 5 % | Sales Manager |
| Quote discount | 5 – 10 % | Business Head (of the lead's vertical) |
| Quote discount | ≥ 10 % | MD |
| Purchase order | < ₹5 L | Purchase Manager |
| Purchase order | ₹5 L – ₹25 L | Business Head |
| Purchase order | ≥ ₹25 L | MD |
| Expense claim | step 1 | The employee's reporting manager |
| Expense claim | step 2 | Accounts Manager (head of accounts) |

A higher role can always approve a lower-level item (MD > Business Head > managers). Leave goes to the reporting manager (HR can decide any).
