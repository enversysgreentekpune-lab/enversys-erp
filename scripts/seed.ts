// Seeds masters, roles/permissions, demo employees and an end-to-end demo dataset.
// Uses the real workflow engine (proposal -> approval -> won -> WO -> PR -> draft PO) so seed data is consistent.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { pool, q, one } from "../src/lib/db";
import { ROLES, MODULES, expandMatrix } from "../src/lib/rbac";
import { putFile } from "../src/lib/storage";
import { nextNo } from "../src/lib/numbering";
import { createProposal, saveRevision, submitForApproval, decideApproval, setProposalStatus, markWon, changeLeadStage, submitPoForApproval } from "../src/lib/workflow";
import { DEFAULT_PARAMS } from "../src/lib/costing";
import { iso } from "../src/lib/period";

let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const ins = async (table: string, row: Record<string, any>) => {
  const k = Object.keys(row);
  return (await one(`insert into ${table}(${k.join(",")}) values (${k.map((_, i) => "$" + (i + 1)).join(",")}) returning *`,
    k.map((x) => (row[x] !== null && typeof row[x] === "object" && !(row[x] instanceof Date) && !Array.isArray(row[x]) ? JSON.stringify(row[x]) : row[x]))))!;
};

async function main() {
  const existing = await one(`select count(*)::int n from employee`);
  if (existing?.n) { console.log("Database already seeded. Use npm run db:reset to start over."); return; }

  // ---------- Company & locations ----------
  await ins("company", { name: "Enversys", legal_name: "Enversys Engineering Pvt. Ltd.", gstin: "27AAACE1234F1Z5", pan: "AAACE1234F",
    address: "Office 501, Business Bay, Baner Road, Pune 411045, Maharashtra", phone: "+91 20 6700 1234", email: "info@enversys.com", website: "www.enversys.com",
    bank_details: { bank: "HDFC Bank", account: "50200012345678", ifsc: "HDFC0001234", branch: "Baner, Pune" } });
  const loc: Record<string, any> = {};
  for (const l of [
    { code: "HO", name: "Head Office, Pune", kind: "HO", lat: 18.5596, lng: 73.7799, geofence_m: 250 },
    { code: "MKL", name: "Markal Factory", kind: "FACTORY", lat: 18.6912, lng: 73.9985, geofence_m: 400, shift_start: "08:30", shift_end: "17:30" },
    { code: "SITE-RJN", name: "Site: Ranjangaon MIDC", kind: "SITE", lat: 18.755, lng: 74.242, geofence_m: 500 },
    { code: "SITE-AWB", name: "Site: Waluj, Aurangabad", kind: "SITE", lat: 19.84, lng: 75.24, geofence_m: 500 },
    { code: "SITE-SNR", name: "Site: Sinnar, Nashik", kind: "SITE", lat: 19.85, lng: 74.0, geofence_m: 500 },
  ]) loc[l.code] = await ins("location", l);

  const vert: Record<string, any> = {};
  for (const [i, [code, name]] of ([["PRJ", "Projects"], ["MFG", "Manufacturing"], ["IC", "Installation & Commissioning"], ["OM", "Operation & Maintenance"], ["MNT", "Maintenance Work Orders"], ["CON", "Consultancy"], ["TRD", "Trading Sales"]] as const).entries())
    vert[code] = await ins("vertical", { code, name, sort: i });
  const dept: Record<string, any> = {};
  for (const [code, name] of [["MGMT", "Management"], ["SALES", "Sales & BD"], ["EST", "Estimation"], ["PUR", "Purchase"], ["PROJ", "Projects"], ["FACT", "Factory - Markal"], ["QA", "QA/QC"], ["OM", "O&M"], ["ACC", "Accounts & Finance"], ["HR", "HR & Admin"], ["STORES", "Stores & Logistics"], ["IT", "IT"]])
    dept[code] = await ins("department", { code, name });
  const desig: Record<string, any> = {};
  for (const [name, level] of [["Managing Director", 1], ["Business Head", 2], ["Manager", 3], ["Senior Engineer", 4], ["Engineer", 5], ["Executive", 5], ["Supervisor", 5], ["Technician", 6], ["Fabricator", 6], ["Welder", 6]] as const)
    desig[name] = await ins("designation", { name, level });

  // ---------- Roles & permission matrix ----------
  const role: Record<string, any> = {};
  for (const [i, r] of ROLES.entries()) {
    role[r.code] = await ins("role", { code: r.code, name: r.name, is_system: ["SUPER_ADMIN", "MD"].includes(r.code), sort: i });
    for (const [k, scope] of Object.entries(expandMatrix(r.code))) {
      const [module, action] = k.split(":");
      await pool.query(`insert into permission(role_id, module, action, scope) values ($1,$2,$3,$4)`, [role[r.code].id, module, action, scope]);
    }
  }
  console.log(`Roles: ${ROLES.length}, modules: ${MODULES.length}`);
  for (const r of [
    ["QUOTE_DISCOUNT", 0, 5, "SALES_MANAGER", 1], ["QUOTE_DISCOUNT", 5, 10, "BUSINESS_HEAD", 2], ["QUOTE_DISCOUNT", 10, null, "MD", 3],
    ["PURCHASE_ORDER", 0, 500000, "PURCHASE_MANAGER", 1], ["PURCHASE_ORDER", 500000, 2500000, "BUSINESS_HEAD", 2], ["PURCHASE_ORDER", 2500000, null, "MD", 3],
    ["EXPENSE_CLAIM", 0, 25000, "ACCOUNTS_MANAGER", 1], ["EXPENSE_CLAIM", 25000, null, "BUSINESS_HEAD", 2],
  ] as const) await ins("approval_rule", { doc_type: r[0], min_value: r[1], max_value: r[2], approver_role: r[3], sequence: r[4] });
  await ins("app_setting", { key: "alerts", value: { cost_overrun_pct: 5, lead_stuck_days: 21, high_value_lead: 2500000, receivable_days: 90 } });
  await ins("app_setting", { key: "sla_hours", value: { lead_first_response: 24, proposal_approval: 24, po_approval: 48, inspection_call: 72 } });
  for (const [code, name, quota] of [["CL", "Casual Leave", 8], ["SL", "Sick Leave", 7], ["PL", "Privilege Leave", 15], ["CO", "Comp-off", 0], ["LWP", "Leave Without Pay", 0]] as const)
    await ins("leave_type", { code, name, annual_quota: quota });
  for (const [d, n] of [["2026-08-15", "Independence Day"], ["2026-08-27", "Ganesh Chaturthi"], ["2026-10-02", "Gandhi Jayanti"], ["2026-10-20", "Dussehra"], ["2026-11-09", "Diwali (Laxmi Pujan)"], ["2026-11-10", "Diwali (Padwa)"], ["2026-12-25", "Christmas"], ["2027-01-26", "Republic Day"]])
    await ins("holiday", { hdate: d, name: n });

  // ---------- Templates ----------
  for (const [code, name, file, kind] of [["QUOTE_DOCX", "Techno-commercial offer (Word)", "quote_offer.docx", "docx"], ["QUOTE_XLSX", "Price schedule / BOQ (Excel)", "price_schedule.xlsx", "xlsx"], ["WO_ACCEPTANCE_DOCX", "Internal order acceptance & kick-off", "wo_acceptance.docx", "docx"]] as const) {
    const key = await putFile(fs.readFileSync(path.resolve("templates", file)), file, "templates");
    await ins("template", { code, name, kind, storage_key: key });
  }
  await ins("template", { code: "EMAIL_QUOTE", name: "Email: offer submission", kind: "email",
    subject: "[{{lead.enquiry_no}}] Our offer {{proposal.no}} Rev {{proposal.rev}} — {{proposal.title}}",
    body: "<p>Dear {{contact.name}},</p><p>Thank you for your enquiry. Please find attached our techno-commercial offer <b>{{proposal.no}} Rev {{proposal.rev}}</b> for <b>{{proposal.title}}</b> along with the price schedule.</p><p>We would be happy to clarify any technical or commercial point.</p><p>Warm regards,<br/>{{user.name}}<br/>Enversys | {{user.mobile}}</p>" });
  await ins("template", { code: "EMAIL_FOLLOWUP", name: "Email: follow-up", kind: "email",
    subject: "[{{lead.enquiry_no}}] Follow-up: {{lead.title}}",
    body: "<p>Dear {{contact.name}},</p><p>We are following up on your requirement for <b>{{lead.title}}</b>. Please let us know a convenient time to discuss.</p><p>Regards,<br/>{{user.name}}<br/>Enversys</p>" });

  // ---------- Employees ----------
  const E: Record<string, any> = {};
  const emp = async (key: string, name: string, mobile: string, roleCode: string, d: string, des: string, l: string, mgr: string | null, opts: Record<string, any> = {}) => {
    E[key] = await ins("employee", {
      emp_code: `ENV${String(Object.keys(E).length + 1).padStart(3, "0")}`, name, mobile, email: `${name.split(" ")[0].toLowerCase()}@enversys.com`,
      role_id: role[roleCode].id, department_id: dept[d].id, designation_id: desig[des].id, location_id: loc[l].id,
      manager_id: mgr ? E[mgr].id : null, doj: iso(daysAgo(200 + Math.floor(rnd() * 2000))), monthly_ctc: opts.ctc ?? 60000,
      hourly_cost: opts.hourly ?? 400, vertical_id: opts.v ? vert[opts.v].id : null, skills: opts.skills ?? [],
    });
  };
  await emp("md", "Amol Gajare", "9800000001", "MD", "MGMT", "Managing Director", "HO", null, { ctc: 500000, hourly: 3000 });
  await emp("it", "Rahul Joshi", "9800000002", "SUPER_ADMIN", "IT", "Manager", "HO", "md", { ctc: 90000 });
  await emp("bhp", "Sanjay Kulkarni", "9800000003", "BUSINESS_HEAD", "MGMT", "Business Head", "HO", "md", { v: "PRJ", ctc: 250000, hourly: 1500 });
  await emp("bhm", "Meera Deshpande", "9800000004", "BUSINESS_HEAD", "MGMT", "Business Head", "MKL", "md", { v: "MFG", ctc: 230000, hourly: 1400 });
  await emp("bho", "Vikram Patil", "9800000005", "BUSINESS_HEAD", "MGMT", "Business Head", "HO", "md", { v: "OM", ctc: 200000, hourly: 1200 });
  await emp("sm", "Neha Kapoor", "9800000006", "SALES_MANAGER", "SALES", "Manager", "HO", "bhp", { v: "PRJ", ctc: 140000, hourly: 850 });
  await emp("se1", "Rohit Shinde", "9800000007", "SALES_ENGINEER", "SALES", "Engineer", "HO", "sm", { v: "PRJ", ctc: 65000 });
  await emp("se2", "Pooja Naik", "9800000008", "SALES_ENGINEER", "SALES", "Engineer", "HO", "sm", { v: "MFG", ctc: 62000 });
  await emp("est", "Aditya Rao", "9800000009", "ESTIMATION_ENGINEER", "EST", "Senior Engineer", "HO", "sm", { v: "PRJ", ctc: 85000 });
  await emp("pm_pur", "Ganesh Pawar", "9800000010", "PURCHASE_MANAGER", "PUR", "Manager", "HO", "md", { ctc: 120000 });
  await emp("pe", "Swati Jadhav", "9800000011", "PURCHASE_EXEC", "PUR", "Executive", "HO", "pm_pur", { ctc: 45000 });
  await emp("pm1", "Kiran Bhosale", "9800000012", "PROJECT_MANAGER", "PROJ", "Manager", "SITE-RJN", "bhp", { v: "PRJ", ctc: 150000, hourly: 900 });
  await emp("pm2", "Anjali Mehta", "9800000013", "PROJECT_MANAGER", "PROJ", "Manager", "HO", "bhm", { v: "MFG", ctc: 140000, hourly: 850 });
  await emp("site1", "Sachin More", "9800000014", "SITE_ENGINEER", "PROJ", "Engineer", "SITE-RJN", "pm1", { v: "PRJ", ctc: 55000, hourly: 350, skills: ["Electrical licence", "Safety induction"] });
  await emp("fm", "Prakash Gaikwad", "9800000015", "FACTORY_MANAGER", "FACT", "Manager", "MKL", "bhm", { v: "MFG", ctc: 130000, hourly: 800 });
  await emp("ps", "Dattatray Kale", "9800000016", "PRODUCTION_SUPERVISOR", "FACT", "Supervisor", "MKL", "fm", { v: "MFG", ctc: 45000, hourly: 300 });
  await emp("fw1", "Ramesh Yadav", "9800000017", "FACTORY_WORKER", "FACT", "Welder", "MKL", "ps", { v: "MFG", ctc: 28000, hourly: 180, skills: ["6G welding", "Safety induction"] });
  await emp("fw2", "Suresh Chavan", "9800000018", "FACTORY_WORKER", "FACT", "Fabricator", "MKL", "ps", { v: "MFG", ctc: 26000, hourly: 170, skills: ["Fitting", "Safety induction"] });
  await emp("qa", "Nitin Sawant", "9800000019", "QA_INSPECTOR", "QA", "Engineer", "MKL", "fm", { ctc: 60000 });
  await emp("om", "Farhan Shaikh", "9800000020", "OM_MANAGER", "OM", "Manager", "SITE-SNR", "bho", { v: "OM", ctc: 110000, hourly: 700 });
  await emp("omt", "Ajay Thorat", "9800000021", "OM_TECHNICIAN", "OM", "Technician", "SITE-SNR", "om", { v: "OM", ctc: 30000, hourly: 200 });
  await emp("acm", "Shweta Kulkarni", "9800000022", "ACCOUNTS_MANAGER", "ACC", "Manager", "HO", "md", { ctc: 130000 });
  await emp("acc", "Manoj Gupta", "9800000023", "ACCOUNTANT", "ACC", "Executive", "HO", "acm", { ctc: 45000 });
  await emp("hr", "Priya Wagh", "9800000024", "HR_MANAGER", "HR", "Manager", "HO", "md", { ctc: 110000 });
  await emp("to", "Balasaheb Ghule", "9800000025", "TIME_OFFICE", "HR", "Executive", "MKL", "hr", { ctc: 30000 });
  await emp("adm", "Kavita Salunkhe", "9800000026", "ADMIN_EXEC", "HR", "Executive", "HO", "hr", { ctc: 32000 });
  await emp("store", "Mahesh Lokhande", "9800000027", "STOREKEEPER", "STORES", "Executive", "MKL", "fm", { ctc: 30000 });
  console.log(`Employees: ${Object.keys(E).length}`);

  // ---------- Vendors & items ----------
  const V: Record<string, any> = {};
  for (const [code, name, email] of [["V001", "Jindal Stainless Traders", "sales@jst.example"], ["V002", "Kirloskar Pumps Dealer – Pune", "pumps@kpd.example"], ["V003", "Siemens Automation Partner", "auto@sap.example"], ["V004", "Shree Valves & Fittings", "sales@svf.example"], ["V005", "Asian Paints Industrial", "ind@apaints.example"], ["V006", "Bharat Electricals", "info@bharatelec.example"]] as const)
    V[code] = await ins("vendor", { code, name, email, gstin: `27AAB${code}1Z${code.slice(-1)}`, payment_terms: "30 days", rating: 3.5 + rnd() * 1.5, mobile: `98220${Math.floor(10000 + rnd() * 89999)}` });
  const items: [string, string, string, string, string, string, number, string, string][] = [
    ["RM-SS304-PL6", "SS304 plate 6 mm", "ASTM A240 SS304, 6 mm thk, 2B finish", "Jindal", "SS304", "KG", 285, "RAW_MATERIAL", "V001"],
    ["RM-SS304-PL10", "SS304 plate 10 mm", "ASTM A240 SS304, 10 mm thk", "Jindal", "SS304", "KG", 290, "RAW_MATERIAL", "V001"],
    ["RM-MS-PL8", "MS plate 8 mm", "IS 2062 E250 BR, 8 mm", "SAIL", "MS", "KG", 72, "RAW_MATERIAL", "V001"],
    ["BO-PUMP-CF10", "Centrifugal pump 10 m3/h", "10 m3/h @ 30 m head, 3 HP, CI casing, SS impeller", "Kirloskar", "CI/SS", "NOS", 68000, "BOUGHT_OUT", "V002"],
    ["BO-PUMP-DOS", "Dosing pump 0–10 LPH", "Diaphragm dosing pump, PVDF head", "Milton Roy", "PVDF", "NOS", 42000, "BOUGHT_OUT", "V002"],
    ["BO-PLC-S7", "PLC panel", "Siemens S7-1200 based control panel with HMI", "Siemens", "CRCA", "SET", 385000, "BOUGHT_OUT", "V003"],
    ["BO-VLV-BFV100", "Butterfly valve 100NB", "Wafer type, CI body, SS disc, PN10", "Shree", "CI/SS", "NOS", 6800, "BOUGHT_OUT", "V004"],
    ["BO-VLV-NRV80", "Non-return valve 80NB", "Dual plate, CI body", "Shree", "CI", "NOS", 5400, "BOUGHT_OUT", "V004"],
    ["BO-BLOWER-TL", "Twin-lobe air blower", "250 m3/h @ 0.4 kg/cm2 with 7.5 kW motor", "Everest", "CI", "NOS", 245000, "BOUGHT_OUT", "V002"],
    ["BO-DIFF-FB", "Fine bubble diffuser", "9\" disc membrane diffuser, EPDM", "SSI", "EPDM", "NOS", 1450, "BOUGHT_OUT", "V004"],
    ["CON-PAINT-EP", "Epoxy paint system", "Epoxy zinc phosphate primer + 2 coats PU", "Asian Paints", "-", "LTR", 640, "CONSUMABLE", "V005"],
    ["BO-CABLE-4C", "Power cable 4C x 16 sqmm", "Al armoured XLPE, 1.1 kV", "Polycab", "AL", "MTR", 285, "BOUGHT_OUT", "V006"],
    ["FB-TANK-SS10", "SS304 storage tank 10 KL", "Vertical cylindrical, 6/8 mm SS304, with nozzles & manhole", "Enversys-Markal", "SS304", "NOS", 0, "FABRICATED", ""],
    ["FB-PV-5KL", "Pressure vessel 5 KL", "ASME Sec VIII Div 1, 10 bar, MS + epoxy lined", "Enversys-Markal", "MS", "NOS", 0, "FABRICATED", ""],
    ["FB-SKID-01", "Dosing skid", "MS skid with SS tray, 2 pumps + tank", "Enversys-Markal", "MS/SS", "SET", 0, "FABRICATED", ""],
  ];
  for (const [code, d, s, make, moc, uom, rate, cat, v] of items)
    await ins("item", { code, description: d, specification: s, make, moc, uom, hsn: cat === "RAW_MATERIAL" ? "7219" : "8413", gst_pct: 18, category: cat, last_purchase_rate: rate || null, standard_rate: rate || null, preferred_vendor_id: v ? V[v].id : null });

  // ---------- Customers ----------
  const C: any[] = [];
  const custs: [string, string, string, string, string][] = [
    ["Bharat Forge Ltd", "Kalyani Group", "Auto & Forging", "27AAACB1234A1Z1", "A"], ["Tata Motors – Pune Plant", "Tata Group", "Automotive", "27AAACT2727Q1ZW", "A"],
    ["Mahindra Lifespaces", "Mahindra Group", "Real Estate", "27AAACM3025E1ZZ", "B"], ["Sudarshan Chemical Industries", "", "Chemicals", "27AAACS1234D1Z2", "A"],
    ["Praj Industries", "", "Process Engineering", "27AAACP2345H1Z3", "B"], ["Thermax Ltd", "", "Energy & Environment", "27AAACT3456J1Z4", "A"],
    ["Godrej Properties – Hinjewadi", "Godrej Group", "Real Estate", "27AAACG4567K1Z5", "B"], ["Alkyl Amines Chemicals", "", "Chemicals", "27AAACA5678L1Z6", "B"],
    ["MIDC Ranjangaon CETP", "MIDC", "Government / Utility", "27AAAGM6789M1Z7", "C"], ["Varroc Engineering", "", "Auto Components", "29AAACV7890N1Z8", "B"],
  ];
  const cities = ["Pune", "Pune", "Mumbai", "Roha", "Pune", "Pune", "Pune", "Kurkumbh", "Ranjangaon", "Bengaluru"];
  for (const [i, [name, grp, ind, gstin, rating]] of custs.entries()) {
    const c = await ins("customer", { code: `ENV/CU/${String(i + 1).padStart(4, "0")}`, name, group_name: grp || null, industry: ind, gstin, pan: gstin.slice(2, 12), rating,
      phone: `020-${Math.floor(20000000 + rnd() * 9999999)}`, email: `projects@${name.split(" ")[0].toLowerCase()}.example`, credit_limit: [5e6, 2.5e6, 1e6][["A", "B", "C"].indexOf(rating)],
      payment_terms: "30 days", owner_id: pick([E.se1.id, E.se2.id, E.sm.id]), source: pick(["REFERRAL", "EXISTING_CUSTOMER", "EXHIBITION", "WEBSITE"]), created_by: E.sm.id,
      created_at: daysAgo(400 - i * 20) });
    await ins("customer_address", { customer_id: c.id, kind: "BILLING", line1: `Plot ${10 + i}, Industrial Area`, city: cities[i], state: i === 9 ? "Karnataka" : "Maharashtra", pincode: i === 9 ? "560100" : "411019", is_default: true });
    const ct1 = await ins("contact", { customer_id: c.id, name: pick(["Rajesh Kumar", "Sunil Mane", "Arvind Iyer", "Deepak Shah", "Vandana Pillai", "Harish Rao"]), designation: "Head – Projects", email: `projects@${name.split(" ")[0].toLowerCase()}.example`, mobile: `98${Math.floor(10000000 + rnd() * 89999999)}`, is_decision_maker: true });
    await ins("contact", { customer_id: c.id, name: pick(["Amit Desai", "Snehal Kale", "Ravi Verma", "Manisha Joshi"]), designation: "Purchase Manager", email: `purchase@${name.split(" ")[0].toLowerCase()}.example`, mobile: `97${Math.floor(10000000 + rnd() * 89999999)}` });
    C.push({ ...c, contactId: ct1.id });
  }

  // ---------- Leads (25 across all stages, 3 verticals) ----------
  const scopes: [string, string, string, number][] = [
    ["PRJ", "Effluent Treatment", "50 KLD ETP – design, supply, erection & commissioning", 8500000], ["PRJ", "Sewage Treatment", "20 KLD STP for residential tower", 3200000],
    ["MFG", "Storage Tanks", "SS304 storage tanks 10 KL x 4 nos", 2600000], ["MFG", "Pressure Vessels", "Air receivers 5 KL ASME VIII x 2", 1850000],
    ["OM", "O&M Contract", "Annual O&M of 200 KLD ETP", 2400000], ["PRJ", "Air Pollution Control", "Wet scrubber system 5000 m3/h", 4600000],
    ["MFG", "Skids", "Chemical dosing skids x 6", 1500000], ["PRJ", "Water Treatment", "RO plant 10 m3/h with pre-treatment", 5400000],
    ["OM", "O&M Contract", "Operation of CETP – 3 years", 9600000], ["MFG", "Ducting & Structures", "MS ducting and support structures", 2100000],
  ];
  const stagesPlan = ["NEW", "NEW", "NEW", "QUALIFIED", "QUALIFIED", "SITE_VISIT", "SITE_VISIT", "ESTIMATION", "ESTIMATION", "ESTIMATION",
    "PROPOSAL_SUBMITTED", "PROPOSAL_SUBMITTED", "IN_DISCUSSION", "IN_DISCUSSION", "IN_NEGOTIATION", "WON", "WON", "WON", "LOST", "LOST",
    "ON_HOLD", "DROPPED", "REGRETTED", "QUALIFIED", "IN_NEGOTIATION"];
  const leads: any[] = [];
  for (let i = 0; i < 25; i++) {
    const [v, cat, title, val] = scopes[i === 15 ? 0 : i === 16 ? 2 : i === 17 ? 4 : i % scopes.length];
    const cust = C[i % C.length];
    const owner = v === "MFG" ? E.se2 : i % 3 === 0 ? E.sm : E.se1;
    const age = 200 - i * 7 + Math.floor(rnd() * 5);
    const enquiryNo = await nextNo(pool, "LEAD");
    const l = await ins("lead", {
      enquiry_no: enquiryNo, enquiry_date: iso(daysAgo(age)), customer_id: cust.id, contact_id: cust.contactId, vertical_id: vert[v].id, category: cat,
      title: `${title} – ${cust.name.split(" ")[0]}`, scope: `${title}. Customer RFQ and P&ID received. Scope includes design, supply${v === "PRJ" ? ", erection and commissioning" : ""}.`,
      site_location: cities[i % 10], est_value: Math.round(val * (0.7 + rnd() * 0.6) / 1000) * 1000, expected_closure: iso(daysAgo(age - 75)),
      priority: pick(["MEDIUM", "HIGH", "MEDIUM", "LOW", "CRITICAL"]), source: pick(["WEBSITE", "EMAIL", "REFERRAL", "EXHIBITION", "INDIAMART", "EXISTING_CUSTOMER", "TENDER"]),
      assigned_to: owner.id, created_by: owner.id, created_at: daysAgo(age), next_followup_at: daysAgo(-(i % 6) + 2),
      tender_no: i % 7 === 0 ? `MIDC/CETP/2026/${100 + i}` : null, emd_amount: i % 7 === 0 ? 50000 : null, bid_due_date: i % 7 === 0 ? iso(daysAgo(age - 20)) : null,
    });
    await ins("activity", { entity: "lead", entity_id: l.id, kind: "SYSTEM", subject: "Enquiry registered", body: `Source: ${l.source}`, created_by: owner.id, created_at: daysAgo(age) });
    await ins("activity", { entity: "lead", entity_id: l.id, kind: "CALL", subject: "Discussed requirement with customer", body: "Clarified scope, battery limits and expected delivery.", created_by: owner.id, created_at: daysAgo(age - 2) });
    leads.push({ ...l, planned: stagesPlan[i], v, owner, age });
  }

  // ---------- Proposals via the real workflow (8) ----------
  const specFor = (v: string, i: number) => {
    if (v === "MFG") return {
      spec: [
        { sl: 1, item_code: "FB-TANK-SS10", description: "SS304 storage tank 10 KL", specification: "Vertical cylindrical, shell 6 mm, bottom 8 mm, with nozzles, manhole, ladder", make: "Enversys-Markal", moc: "SS304", standard: "API 650 (guidance)", qty: 4, uom: "NOS", gst_pct: 18, is_fabricated: true, drawing_ref: "ENV-MKL-GA-101" },
        { sl: 2, item_code: "BO-VLV-BFV100", description: "Butterfly valve 100NB", specification: "Wafer, CI body, SS disc", make: "Shree", moc: "CI/SS", qty: 8, uom: "NOS", gst_pct: 18 },
      ],
      cost: [
        { spec_sl: 1, category: "RAW_MATERIAL", description: "SS304 plates 6/8 mm", qty: 4 * 1650, uom: "KG", rate: 285, rate_source: "LAST_PO" },
        { spec_sl: 1, category: "FABRICATION", description: "Markal: 4 x 180 h @ ₹450/h + consumables", qty: 720, uom: "HR", rate: 450, rate_source: "STANDARD" },
        { spec_sl: 2, category: "BOUGHT_OUT", description: "Butterfly valves", qty: 8, uom: "NOS", rate: 6800, rate_source: "LAST_PO" },
        { spec_sl: null, category: "PAINTING", description: "Pickling & passivation", qty: 4, uom: "NOS", rate: 12000 },
        { spec_sl: null, category: "TESTING", description: "Hydro test & third-party inspection", qty: 1, uom: "LOT", rate: 45000 },
        { spec_sl: null, category: "FREIGHT", description: "Transport to site", qty: 2, uom: "TRIP", rate: 28000 },
      ],
    };
    if (v === "OM") return {
      spec: [{ sl: 1, description: "Operation & maintenance of ETP – 12 months", specification: "3 operators per shift x 3 shifts, chemist, preventive maintenance", qty: 12, uom: "MONTH", gst_pct: 18 }],
      cost: [
        { spec_sl: 1, category: "OTHER", description: "Manpower – operators & chemist", qty: 12, uom: "MONTH", rate: 118000 },
        { spec_sl: 1, category: "MATERIAL", description: "Consumables & chemicals (excl. customer supplied)", qty: 12, uom: "MONTH", rate: 22000 },
        { spec_sl: null, category: "SITE_EXP", description: "Supervision & travel", qty: 12, uom: "MONTH", rate: 15000 },
      ],
    };
    return {
      spec: [
        { sl: 1, item_code: "BO-BLOWER-TL", description: "Twin-lobe air blower", specification: "250 m3/h @ 0.4 kg/cm2, 7.5 kW", make: "Everest", moc: "CI", qty: 2, uom: "NOS", gst_pct: 18 },
        { sl: 2, item_code: "BO-PUMP-CF10", description: "Raw effluent transfer pump", specification: "10 m3/h @ 30 m", make: "Kirloskar", moc: "CI/SS", qty: 4, uom: "NOS", gst_pct: 18 },
        { sl: 3, item_code: "BO-DIFF-FB", description: "Fine bubble diffusers", specification: "9\" EPDM disc", make: "SSI", qty: 120, uom: "NOS", gst_pct: 18 },
        { sl: 4, item_code: "BO-PLC-S7", description: "PLC control panel", specification: "S7-1200 + 7\" HMI", make: "Siemens", qty: 1, uom: "SET", gst_pct: 18 },
        { sl: 5, item_code: "FB-SKID-01", description: "Chemical dosing skid", specification: "MS skid, SS tray, 2 dosing pumps + 500 L tank", make: "Enversys-Markal", moc: "MS/SS", qty: i % 2 ? 2 : 1, uom: "SET", gst_pct: 18, is_fabricated: true, drawing_ref: "ENV-MKL-GA-205" },
      ],
      cost: [
        { spec_sl: 1, category: "BOUGHT_OUT", description: "Blowers", qty: 2, uom: "NOS", rate: 245000, rate_source: "LAST_PO" },
        { spec_sl: 2, category: "BOUGHT_OUT", description: "Pumps", qty: 4, uom: "NOS", rate: 68000, rate_source: "LAST_PO" },
        { spec_sl: 3, category: "BOUGHT_OUT", description: "Diffusers", qty: 120, uom: "NOS", rate: 1450, rate_source: "VENDOR_QUOTE" },
        { spec_sl: 4, category: "BOUGHT_OUT", description: "PLC panel", qty: 1, uom: "SET", rate: 385000, rate_source: "VENDOR_QUOTE" },
        { spec_sl: 5, category: "FABRICATION", description: "Markal: skid fabrication incl. material", qty: i % 2 ? 2 : 1, uom: "SET", rate: 165000, rate_source: "STANDARD" },
        { spec_sl: null, category: "ENGINEERING", description: "Process design & drawings", qty: 1, uom: "LOT", rate: 180000 },
        { spec_sl: null, category: "IC", description: "Erection & commissioning", qty: 1, uom: "LOT", rate: 420000 },
        { spec_sl: null, category: "SITE_EXP", description: "Site expenses – travel, lodging, DA", qty: 1, uom: "LOT", rate: 95000 },
        { spec_sl: null, category: "FREIGHT", description: "Freight", qty: 1, uom: "LOT", rate: 60000 },
      ],
    };
  };
  const proposalLeads = leads.filter((l) => ["WON", "LOST", "IN_DISCUSSION", "IN_NEGOTIATION"].includes(l.planned)).slice(0, 8);
  // ensure won leads are one per vertical-ish: lead order gives WON at idx 15,16,17 (PRJ/MFG/OM mix)
  const wos: any[] = [];
  for (const [i, l] of proposalLeads.entries()) {
    const p = await createProposal(l.id, l.owner.id);
    const rev = await one(`select id from proposal_revision where proposal_id=$1 and rev_no=0`, [p.id]);
    const { spec, cost: baseCost } = specFor(l.v, i);
    const f = Math.min(3, Math.max(0.5, l.est_value / (l.v === "OM" ? 1.86e6 : l.v === "MFG" ? 2.3e6 : 2.6e6)));
    const cost = baseCost.map((c) => ({ ...c, rate: Math.round(c.rate * f) }));
    const discount = [0, 3, 6, 2, 12, 4, 0, 8][i];
    const params = { ...DEFAULT_PARAMS, margin_pct: l.v === "OM" ? 15 : l.v === "MFG" ? 20 : 18, discount_pct: discount, gst_mode: (i === 7 ? "INTER" : "INTRA") as "INTRA" | "INTER" };
    await one(`update proposal_revision set params=$2 where id=$1`, [rev.id, JSON.stringify(params)]);
    await saveRevision(rev.id, { spec, cost, params, terms: (await one(`select terms from proposal_revision where id=$1`, [rev.id])).terms }, l.owner.id, { canOverrideMargin: true });
    const appr = await submitForApproval(p.id, l.owner.id);
    const approver = appr.approver_role === "MD" ? E.md : appr.approver_role === "BUSINESS_HEAD" ? (l.v === "MFG" ? E.bhm : l.v === "OM" ? E.bho : E.bhp) : E.sm;
    await decideApproval(appr.id, true, "Approved – margins acceptable", { id: approver.id, roleCode: appr.approver_role });
    await setProposalStatus(p.id, "SUBMITTED", "Offer emailed to customer", l.owner.id);
    if (["IN_DISCUSSION", "IN_NEGOTIATION", "WON", "LOST"].includes(l.planned)) await setProposalStatus(p.id, "IN_DISCUSSION", "Technical clarification meeting held", l.owner.id);
    if (["IN_NEGOTIATION", "WON"].includes(l.planned)) await setProposalStatus(p.id, "IN_NEGOTIATION", "Commercial negotiation with purchase", l.owner.id);
    if (l.planned === "LOST") await setProposalStatus(p.id, "LOST", "Customer placed order elsewhere", l.owner.id, { reason: pick(["Price", "Delivery", "Competitor"]), competitor: pick(["Ion Exchange", "Voltas Water", "Local fabricator"]), competitorPrice: Math.round(l.est_value * 0.9) });
    if (l.planned === "WON") {
      const pr = await one(`select quoted_value from proposal where id=$1`, [p.id]);
      const woType = l.v === "MFG" ? "MANUFACTURING" : l.v === "OM" ? "OM" : "PROJECT";
      const pm = l.v === "MFG" ? E.pm2 : l.v === "OM" ? E.om : E.pm1;
      const wo = await markWon(p.id, { poNo: `${l.v === "OM" ? "OM" : "4500"}${Math.floor(100000 + rnd() * 899999)}`, poDate: iso(daysAgo(l.age - 60)), poValue: Math.round(pr.quoted_value * 0.98), woType,
        pmId: pm.id, executorIds: l.v === "MFG" ? [E.ps.id, E.fw1.id, E.fw2.id] : l.v === "OM" ? [E.omt.id] : [E.site1.id], startDate: iso(daysAgo(l.age - 62)), endDate: iso(daysAgo(l.age - 62 - 150)) }, E.sm.id);
      wos.push({ ...wo, v: l.v, age: l.age - 60 });
    }
    // backdate proposal & approvals for realistic time-series
    await pool.query(`update proposal set created_at=$2, submitted_at=$3, decided_at = case when decided_at is not null then $4::timestamptz else null end where id=$1`,
      [p.id, daysAgo(l.age - 10), daysAgo(l.age - 15), daysAgo(l.age - 60)]);
  }
  // other leads: drive stage history through workflow for a realistic timeline
  for (const l of leads.filter((x) => !proposalLeads.includes(x) && x.planned !== "NEW")) {
    const path_: Record<string, string[]> = {
      QUALIFIED: ["QUALIFIED"], SITE_VISIT: ["QUALIFIED", "SITE_VISIT"], ESTIMATION: ["QUALIFIED", "ESTIMATION"],
      PROPOSAL_SUBMITTED: ["QUALIFIED", "ESTIMATION", "PROPOSAL_SUBMITTED"], ON_HOLD: ["QUALIFIED", "ON_HOLD"], DROPPED: ["QUALIFIED", "DROPPED"],
      REGRETTED: ["REGRETTED"], IN_NEGOTIATION: ["QUALIFIED", "ESTIMATION", "PROPOSAL_SUBMITTED", "IN_NEGOTIATION"], IN_DISCUSSION: ["QUALIFIED", "IN_DISCUSSION"],
      WON: ["QUALIFIED"], LOST: ["QUALIFIED", "LOST"],
    };
    for (const s of path_[l.planned] ?? []) await changeLeadStage(l.id, s, `Moved to ${s.toLowerCase().replace(/_/g, " ")}`, l.owner.id, s === "LOST" ? { reason: "Budget dropped" } : undefined);
  }
  await pool.query(`update activity a set created_at = l.created_at + (random() * (now() - l.created_at)) from lead l where a.entity='lead' and a.entity_id=l.id and a.kind in ('STAGE','DOC','STATUS')`);
  await pool.query(`update lead set stage_changed_at = created_at + interval '10 days', updated_at = created_at + interval '12 days' where stage not in ('NEW')`);
  console.log(`Leads: ${leads.length}, proposals: ${proposalLeads.length}, WOs: ${wos.length}`);

  // ---------- WO execution data: POs, costs, invoices ----------
  for (const [i, wo] of wos.entries()) {
    const created = daysAgo(Math.max(wo.age, 20));
    await pool.query(`update work_order set created_at=$2, status='IN_PROGRESS', pct_complete=$3 where id=$1`, [wo.id, created, [55, 70, 40][i] ?? 35]);
    await pool.query(`update customer_po set created_at=$2 where id=$1`, [wo.customer_po_id, created]);
    // assign vendors to unassigned draft POs, submit & approve the first PO (commits cost), others remain draft
    const pos = await q(`select * from purchase_order where wo_id=$1 order by po_no`, [wo.id]);
    for (const [j, po] of pos.entries()) {
      if (!po.vendor_id) await pool.query(`update purchase_order set vendor_id=$2 where id=$1`, [po.id, V.V004.id]);
      if (j === 0) {
        await submitPoForApproval(po.id, E.pe.id);
        const a = await one(`select * from approval where entity_id=$1 and status='PENDING'`, [po.id]);
        const approver = a.approver_role === "MD" ? E.md : a.approver_role === "BUSINESS_HEAD" ? (wo.v === "MFG" ? E.bhm : wo.v === "OM" ? E.bho : E.bhp) : E.pm_pur;
        await decideApproval(a.id, true, "OK", { id: approver.id, roleCode: a.approver_role });
        await pool.query(`update purchase_order set status='RECEIVED' where id=$1`, [po.id]);
        // vendor bill booked -> committed becomes posted
        await pool.query(`update cost_entry set status='POSTED', entry_date=$2 where source_id=$1`, [po.id, iso(daysAgo(Math.max(wo.age - 20, 5)))]);
      } else if (j === 1) await submitPoForApproval(po.id, E.pe.id);
    }
    // direct site/factory costs
    const extra: [string, string, number][] = wo.v === "MFG"
      ? [["FABRICATION", "Markal: SS plates issued from stores", 1650000], ["SUBCONTRACT", "Pickling & passivation – subcontract", 52000], ["FREIGHT", "Inward freight – plates", 18000]]
      : wo.v === "OM" ? [["LABOUR", "Operator wages (contract) – Aug–Oct", 354000], ["MATERIAL", "Consumables & chemicals", 61000], ["TRAVEL", "Supervisor travel", 22000]]
      : [["SITE_EXP", "Site lodging & DA – erection team", 64000], ["FREIGHT", "Freight – blowers & pumps", 38000], ["SUBCONTRACT", "Civil touch-up & grouting", 85000], ["TRAVEL", "PM site visits", 21000]];
    for (const [k, [cat, desc, amt]] of extra.entries())
      await ins("cost_entry", { cost_centre: "WO", wo_id: wo.id, category: cat, description: desc, amount: amt, entry_date: iso(daysAgo(Math.max(wo.age - 25 - k * 10, 2))), source_type: "MANUAL", created_by: E.acc.id });
    // invoices & receipts
    const ms = await q(`select * from milestone where wo_id=$1 order by due_date, amount desc`, [wo.id]);
    const adv = ms.find((m) => m.name.startsWith("Advance")) ?? ms[0];
    if (wo.v === "OM") for (const m2 of ms.slice(1, 3)) {
      const no2 = await nextNo(pool, "INVOICE");
      const i2 = await ins("invoice", { invoice_no: no2, wo_id: wo.id, customer_id: wo.customer_id, invoice_date: m2.due_date, due_date: m2.due_date, taxable: m2.amount, gst: Math.round(m2.amount * 0.18), total: Math.round(m2.amount * 1.18) });
      await pool.query(`update milestone set status='INVOICED', done_at=$2 where id=$1`, [m2.id, m2.due_date]);
      await ins("receipt", { invoice_id: i2.id, receipt_date: m2.due_date, amount: i2.total, mode: "NEFT" });
    }
    const invNo = await nextNo(pool, "INVOICE");
    const inv = await ins("invoice", { invoice_no: invNo, wo_id: wo.id, customer_id: wo.customer_id, invoice_date: iso(daysAgo(Math.max(wo.age - 5, 3))), due_date: iso(daysAgo(Math.max(wo.age - 35, -27))), taxable: adv.amount, gst: Math.round(adv.amount * 0.18), total: Math.round(adv.amount * 1.18) });
    await pool.query(`update milestone set status='INVOICED', done_at=$2 where id=$1`, [adv.id, inv.invoice_date]);
    if (i !== 2) await ins("receipt", { invoice_id: inv.id, receipt_date: iso(daysAgo(Math.max(wo.age - 20, 1))), amount: inv.total, mode: "NEFT" });
    else await ins("receipt", { invoice_id: inv.id, receipt_date: iso(daysAgo(10)), amount: Math.round(inv.total * 0.5), mode: "RTGS" });
  }
  // an older outstanding invoice (>90 days) on WO1 for receivable ageing/alerts
  if (wos[0]) {
    const invNo = await nextNo(pool, "INVOICE");
    await ins("invoice", { invoice_no: invNo, wo_id: wos[0].id, customer_id: wos[0].customer_id, invoice_date: iso(daysAgo(118)), due_date: iso(daysAgo(98)), taxable: 650000, gst: 117000, total: 767000 });
  }

  // ---------- Office & factory admin expenses + budgets (Apr..current month) ----------
  const officeHeads: [string, number][] = [["RENT", 275000], ["ELECTRICITY", 38000], ["INTERNET_PHONE", 22000], ["STATIONERY", 9000], ["HOUSEKEEPING", 18000], ["TRAVEL", 45000], ["VEHICLE", 32000], ["REPAIRS", 12000], ["PROFESSIONAL_FEES", 60000], ["INSURANCE", 15000], ["SOFTWARE", 28000], ["MISC", 10000]];
  const factoryHeads: [string, number][] = [["FACTORY_RENT", 180000], ["POWER", 145000], ["MACHINE_MAINTENANCE", 42000], ["SECURITY", 55000], ["HOUSEKEEPING", 16000], ["CANTEEN", 48000], ["TRANSPORT", 36000], ["STAFF_WELFARE", 14000]];
  const now = new Date();
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  for (let m = 0; m < 12; m++) {
    const d = new Date(fyStart, 3 + m, 1);
    const month = d.getMonth() + 1;
    for (const [centre, heads] of [["OFFICE_ADMIN", officeHeads], ["FACTORY_ADMIN", factoryHeads]] as const) {
      for (const [h, base] of heads) {
        await ins("budget", { cost_centre: centre, expense_head: h, fy: `${String(fyStart).slice(2)}-${String(fyStart + 1).slice(2)}`, month, amount: base });
        if (d <= now) {
          const amt = Math.round(base * (0.8 + rnd() * 0.4) * (d.getMonth() === now.getMonth() ? 0.3 : 1));
          await ins("cost_entry", { cost_centre: centre, category: "ADMIN", expense_head: h, description: `${h.replace(/_/g, " ").toLowerCase()} – ${d.toLocaleString("en-IN", { month: "short" })}`, amount: amt, gst_amount: Math.round(amt * 0.18), entry_date: iso(new Date(d.getFullYear(), d.getMonth(), 5 + Math.floor(rnd() * 20))), source_type: "MANUAL", created_by: centre === "OFFICE_ADMIN" ? E.adm.id : E.fm.id });
        }
      }
    }
  }
  // previous FY office/factory for YoY
  for (let m = 0; m < 12; m++) {
    const d = new Date(fyStart - 1, 3 + m, 10);
    await ins("cost_entry", { cost_centre: "OFFICE_ADMIN", category: "ADMIN", expense_head: "RENT", description: "Rent (last FY)", amount: 260000, entry_date: iso(d), created_by: E.adm.id });
    await ins("cost_entry", { cost_centre: "FACTORY_ADMIN", category: "ADMIN", expense_head: "POWER", description: "Power (last FY)", amount: 132000, entry_date: iso(d), created_by: E.fm.id });
  }

  // ---------- Attendance: last 45 days for all employees ----------
  const emps = await q(`select e.id, e.location_id, l.code loc from employee e join location l on l.id=e.location_id`);
  const holidays = new Set((await q(`select hdate from holiday`)).map((h) => h.hdate));
  for (let back = 45; back >= 1; back--) {
    const d = daysAgo(back), ds = iso(d);
    for (const e of emps) {
      if (d.getDay() === 0) { await ins("attendance", { employee_id: e.id, att_date: ds, status: "WO", source: "MANUAL" }); continue; }
      if (holidays.has(ds)) { await ins("attendance", { employee_id: e.id, att_date: ds, status: "H", source: "MANUAL" }); continue; }
      const r = rnd();
      if (r < 0.05) { await ins("attendance", { employee_id: e.id, att_date: ds, status: "A", source: "MANUAL" }); continue; }
      if (r < 0.08) { await ins("attendance", { employee_id: e.id, att_date: ds, status: "L", source: "MANUAL", remarks: "Leave CL" }); continue; }
      const factory = e.loc === "MKL";
      const late = rnd() < 0.1;
      const inMin = (factory ? 8 * 60 + 20 : 9 * 60 + 20) + (late ? 25 + Math.floor(rnd() * 30) : Math.floor(rnd() * 20));
      const ot = factory && rnd() < 0.3 ? [1, 1.5, 2, 3][Math.floor(rnd() * 4)] : 0;
      const outMin = inMin + 9 * 60 + ot * 60 + Math.floor(rnd() * 20);
      const at = (min: number) => new Date(`${ds}T${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00+05:30`);
      await ins("attendance", { employee_id: e.id, att_date: ds, location_id: e.location_id, check_in: at(inMin), check_out: at(outMin), status: "P", is_late: late, ot_hours: ot, source: factory ? "BIOMETRIC" : "GEO" });
    }
  }

  // ---------- DWRs with WO hours (labour costing) ----------
  const { submitDwr } = await import("../src/lib/hr");
  const woByV = Object.fromEntries(wos.map((w) => [w.v, w]));
  const workers: [string, string, string][] = [["fw1", "MFG", "Shell welding & nozzle fit-up"], ["fw2", "MFG", "Plate cutting & rolling"], ["ps", "MFG", "Supervision & job card updates"], ["site1", "PRJ", "Erection of blowers & piping"], ["pm1", "PRJ", "Site coordination"], ["omt", "OM", "Shift operation & log sheets"]];
  for (let back = 20; back >= 1; back--) {
    const d = daysAgo(back);
    if (d.getDay() === 0) continue;
    for (const [k, v, desc] of workers) {
      const wo = woByV[v];
      if (!wo) continue;
      await submitDwr(E[k].id, iso(d), `${desc} for ${wo.wo_no}`, back % 6 === 0 ? "Awaiting drawing approval for nozzle orientation" : "", [{ woId: wo.id, hours: 7 + Math.floor(rnd() * 3), description: desc }]);
    }
  }
  await pool.query(`update cost_entry ce set entry_date = d.report_date, created_at = d.report_date from dwr_line dl join dwr d on d.id=dl.dwr_id where ce.source_type='DWR' and ce.source_id=dl.id`);

  // ---------- Tasks, follow-ups, leave, notifications ----------
  for (const l of leads.filter((x) => ["NEW", "QUALIFIED", "SITE_VISIT", "PROPOSAL_SUBMITTED", "IN_DISCUSSION", "IN_NEGOTIATION"].includes(x.planned)).slice(0, 10))
    await ins("task", { title: `Follow up: ${l.enquiry_no}`, description: l.title, entity: "lead", entity_id: l.id, link: `/leads/${l.id}`, assigned_to: l.owner.id, created_by: l.owner.id, due_at: daysAgo(Math.floor(rnd() * 6) - 2), priority: l.priority });
  await ins("task", { title: "Prepare monthly MIS for MD", assigned_to: E.acm.id, created_by: E.md.id, due_at: daysAgo(-2), priority: "HIGH" });
  await ins("task", { title: "Safety induction for new contract welders", assigned_to: E.fm.id, created_by: E.hr.id, due_at: daysAgo(1), priority: "HIGH" });
  await ins("task", { title: "Review overdue receivables > 90 days", assigned_to: E.acm.id, created_by: E.md.id, due_at: daysAgo(3), priority: "CRITICAL", escalation_level: 1 });
  await ins("leave_request", { employee_id: E.se1.id, leave_type: "CL", from_date: iso(daysAgo(-5)), to_date: iso(daysAgo(-6)), days: 2, reason: "Family function", approver_id: E.sm.id });
  await ins("leave_request", { employee_id: E.fw1.id, leave_type: "SL", from_date: iso(daysAgo(-1)), to_date: iso(daysAgo(-1)), days: 1, reason: "Medical", approver_id: E.ps.id });

  await pool.query(`update audit_log set at = now() - (random() * interval '120 days') where action <> 'LOGIN_OTP'`);
  console.log("Seed complete. Login as MD with mobile 9800000001 (OTP shown on screen in dev).");
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
