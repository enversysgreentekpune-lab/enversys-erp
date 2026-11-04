// Generates docs/PERMISSIONS.md from the seeded default matrix in src/lib/rbac.ts
import fs from "node:fs";
import { ROLES, MODULES, ACTIONS, expandMatrix } from "../src/lib/rbac";
const S: Record<string, string> = { own: "O", team: "T", dept: "V", company: "C" };
let md = `# Default role–permission matrix\n\n_Generated from \`src/lib/rbac.ts\` (\`npx tsx scripts/gen-permissions-doc.ts\`). This is the **seed**; the live matrix is edited in **Admin → Roles & permissions** without code changes, and every edit is audit-logged._\n\n`;
md += `Scope letters: **O** = own records · **T** = team (me + all reportees, recursive) · **V** = my vertical/department · **C** = company. Actions: v=view c=create e=edit d=delete a=approve x=export s=send/print. "—" = no access.\n\n`;
md += `Every role also inherits self-service grants: own tasks on WOs / manufacturing / field services, own HR record, own attendance (view + check-in), and submitting own expense claims.\n\n`;
md += `| Role | ${MODULES.map((m) => m.name).join(" | ")} |\n|---|${MODULES.map(() => "---").join("|")}|\n`;
for (const r of ROLES) {
  const p = expandMatrix(r.code);
  const cells = MODULES.map((m) => {
    const byScope: Record<string, string> = {};
    for (const a of ACTIONS) { const sc = p[`${m.code}:${a}`]; if (sc) byScope[sc] = (byScope[sc] ?? "") + a[0]; }
    const parts = Object.entries(byScope).map(([sc, acts]) => `${acts}:${S[sc]}`);
    return parts.length ? parts.join(" ") : "—";
  });
  md += `| **${r.name}** | ${cells.join(" | ")} |\n`;
}
md += `\n## Sensitive fields\n\nThe **Cost Sheets / Margin** module gates all cost, budget, margin and contribution figures (proposal cost sheet, WO budget vs actual, margin columns in registers and exports). Without \`costing.view\` they are hidden or shown as •••. \`costing.edit\` allows editing cost lines; \`costing.approve\` is required to change the margin %. Billing figures on a WO are additionally hidden from roles without WO edit rights (shop-floor, technicians), and assignment notifications to executors omit contract values.\n\n## Approval matrix (seeded, editable in Admin → Approval matrix)\n\n| Document | Range | Approver |\n|---|---|---|\n| Quote discount | 0 – 5 % | Sales Manager |\n| Quote discount | 5 – 10 % | Business Head (of the lead's vertical) |\n| Quote discount | ≥ 10 % | MD |\n| Purchase order | < ₹5 L | Purchase Manager |\n| Purchase order | ₹5 L – ₹25 L | Business Head |\n| Purchase order | ≥ ₹25 L | MD |\n| Expense claim | < ₹25,000 | Accounts Manager |\n| Expense claim | ≥ ₹25,000 | Business Head |\n\nA higher role can always approve a lower-level item (MD > Business Head > managers). Leave goes to the reporting manager (HR can decide any).\n`;
fs.writeFileSync("docs/PERMISSIONS.md", md);
console.log("docs/PERMISSIONS.md written");
