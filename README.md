# Enversys Business Suite

Covers Enversys's whole job lifecycle in one system: **Customer → Enquiry → Proposal (material spec + cost sheet) → Won PO → Work Order → Purchase → Execution → … → Invoicing**, plus HR, time office and admin expenses. Every cost is booked against a WO number. The MD gets a company-wide command dashboard.

> **Status: Phase 1 complete** (per spec §13), with the Phase-2 purchase slice (auto PR → editable draft POs → approval → committed cost) and admin expenses pulled forward. See the [roadmap](#phase-status) below.

## Quick start (demo)
```bash
cp .env.example .env          # set DATABASE_URL, SESSION_SECRET
npm install
npm run db:migrate && npm run db:seed
npm run dev                   # http://localhost:3000
```
In dev the OTP is shown on the login screen. Demo users (all seeded):

| Mobile | Person | Role |
|---|---|---|
| 9800000001 | Amol Gajare | Managing Director |
| 9800000002 | Rahul Joshi | Super Admin (IT) |
| 9800000003 | Sanjay Kulkarni | Business Head — Projects |
| 9800000006 | Neha Kapoor | Sales Manager |
| 9800000007 | Rohit Shinde | Sales Engineer |
| 9800000010 | Ganesh Pawar | Purchase Manager |
| 9800000012 | Kiran Bhosale | Project Manager |
| 9800000015 | Prakash Gaikwad | Factory Manager (Markal) |
| 9800000017 | Ramesh Yadav | Factory Worker |
| 9800000022 | Shweta Kulkarni | Accounts Manager |
| 9800000024 | Priya Wagh | HR Manager |
| 9800000025 | Balasaheb Ghule | Time Office Keeper |

Seed data: 7 verticals (demo activity in Projects, Manufacturing and O&M), 27 employees across HO / Markal / 3 sites with 45 days of attendance, 10 customers, 25 leads across every stage, 8 proposals (3 won, 2 lost, 2 in discussion, 1 in negotiation), 3 live WOs (one manufacturing WO with Markal fabrication, one EPC project, one O&M), auto-drafted and approved POs, DWR labour costs, invoices/receipts, and 12 months of office + factory admin expenses with budgets. Proposals and WOs are created through the real workflow engine, not inserted directly.

## Documentation
- [Architecture](docs/ARCHITECTURE.md): stack, design decisions, list of what is not implemented yet
- [ERD / data model](docs/ERD.md)
- [Role–permission matrix](docs/PERMISSIONS.md) (generated from code; editable in Admin)
- [Screen list](docs/SCREENS.md)
- [API & webhooks](docs/API.md)
- [Deployment](docs/DEPLOYMENT.md)
- [User guide by role](docs/USER_GUIDE.md)

## Tests
`npm test` runs 25 tests: cost-sheet engine, RBAC defaults, FY/quarter ranges, Word/Excel template rendering, Indian amount-in-words, and an end-to-end DB flow (lead → proposal → discount-based approval → submitted → won → WO with cost-sheet budget → PR split Markal/vendor → draft PO → PO approval → committed cost → DWR labour cost → WO P&L), including the guards and the audit trail.

## Acceptance criteria (spec §12)
| Criterion | Status |
|---|---|
| Mobile + OTP login, role-scoped visibility | ✅ |
| Lead created, emailed with Word + Excel attachments, tracked through all stages, email/status timeline | ✅ (inbound replies thread via webhook) |
| Proposal with spec + cost sheet, revisions, approvals, Word & Excel quote sent from app | ✅ |
| Proposal stats Won/Lost/In Discussion/In Negotiation, counts, values, win ratio, any date range | ✅ |
| Won → WO with cost-sheet budget → specs to Purchase → draft POs auto-generated & editable | ✅ |
| WO assigned to PM + executors; fabrication scope → Markal **job order with drawings** | ◐ PR lines are routed to Markal and the Factory Manager gets a kick-off task; the job-order module is Phase 2 |
| Markal completion → inspection request → auto dispatch docs | 🔜 Phase 2 |
| All costs roll up under the WO with live budget vs actual & margin | ✅ for PO, DWR labour, site/freight/subcontract and expense claims (factory production costing comes with Phase 2) |
| Office & factory admin expenses recorded/reported separately | ✅ |
| Attendance geo/biometric/manual, OT, leave for HO/factory/sites | ✅ (payroll push Phase 3) |
| MD dashboard with all sections, Monthly/Quarterly/Annual/Custom, drill-down | ✅ Sales, Projects, Purchase, HR & Admin, Financials and Manufacturing have live data. O&M / Consultancy / Trading / Maintenance tabs show their WOs; their dedicated modules are Phase 3 |
| One-click WO dossier | ✅ ZIP |
| Every action audit-logged | ✅ |

## Phase status
- **Phase 1 (done):** auth & RBAC, masters, customers, leads with email, proposals with spec/cost sheet and quote generation, proposal statistics, WO creation, employee dashboard & DWR, attendance & time office, MD dashboard. Also included: auto PR/draft PO/PO approval, admin expenses & claims, job dossier ZIP.
- **Phase 2 (next):** RFQ/comparative statement, GRN & 3-way match, stores; Markal job orders, routing, job cards, production costing, factory KPIs, machine maintenance; inspection & NCR; dispatch documents; projects WBS/Gantt/DPR/drawing register; background job queue for SLA escalation.
- **Phase 3:** I&C, O&M contracts/assets/PM schedules, maintenance service calls, consultancy, trading, full finance (AR/AP, BG/EMD, cash flow, Tally), payroll, WhatsApp/SMS notifications, scheduled MIS emails.
