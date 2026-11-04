# Screen list

✅ = built in Phase 1 · 🔜 = phase noted

| # | Screen | Route | Who | Status |
|---|---|---|---|---|
| 1 | Login — mobile OTP / quick PIN | `/login` | all | ✅ |
| 2 | Employee dashboard — tasks (board/list), DWR with WO hours, geo check-in/out, attendance calendar, leave apply + balances, team today, leave approvals, notifications, personal KPIs | `/me` | all | ✅ |
| 3 | MD Command Centre — time frame (Today…Custom, Q1–Q4, FY, YTD), compare (prev / YoY), vertical filter, ₹ L/Cr, 12-KPI strip, alerts, tabs: Overview, Sales & Proposals, Ongoing Projects, O&M, Consultancy, Trading, Maintenance, Manufacturing, Purchase, HR & Admin, Financials; Excel export, print/PDF | `/md` | MD (company), Business Head (own vertical), Accounts Mgr | ✅ |
| 4 | Customers register (search, rating, export, Excel import with duplicate check) | `/customers` | sales, mgmt | ✅ |
| 5 | New customer (duplicate check on GSTIN/phone/email/name) | `/customers/new` | sales | ✅ |
| 6 | Customer 360° — overview/edit, contacts, addresses, leads, proposals, orders, invoices & receivable, documents, timeline | `/customers/[id]` | sales, mgmt | ✅ |
| 7 | Lead / enquiry register — filters, list + pipeline board, export | `/leads` | sales | ✅ |
| 8 | Register enquiry (quick-create customer/contact, tender fields, RFQ uploads) | `/leads/new` | sales | ✅ |
| 9 | Lead detail — stage change w/ mandatory remark & lost reason, call/meeting/note with geo-tag & follow-up, email compose (templates + attachments) & thread, documents, details | `/leads/[id]` | sales | ✅ |
| 10 | Sales analytics — funnel, inflow, forecast, loss reasons, ageing, by source/vertical/engineer/customer/industry, margins & discount leakage, leaderboard | `/leads/stats` | sales, mgmt | ✅ |
| 11 | Proposal register & statistics — Won/Lost/In Discussion/In Negotiation counts & values, win ratios, margins | `/proposals` | sales, mgmt | ✅ |
| 12 | Proposal workspace — material spec (item lookup, Excel import/export), cost sheet (live build-up), terms, documents (Word/Excel generation), send to customer, revisions + compare, approvals, Mark Won | `/proposals/[id]` | sales, estimation, approvers | ✅ |
| 13 | Print / PDF offer | `/proposals/[id]/print` | sales | ✅ |
| 14 | Approvals inbox (quotes, POs, expense claims, leave) | `/approvals` | approvers | ✅ |
| 15 | Work order register with RAG | `/work-orders` | PM, mgmt | ✅ |
| 16 | WO workspace — P&L, budget vs actual, milestones, invoices, labour hours, team assignment, frozen BOM, PR & POs, cost ledger + booking, dossier folders, history, ZIP download | `/work-orders/[id]` | PM, team, mgmt | ✅ |
| 17 | Purchase orders & editable draft PO (budget check, submit for approval) | `/purchase`, `/purchase/[id]` | purchase | ✅ (RFQ/GRN 🔜 P2) |
| 18 | Time office — muster roll per location, manual entry, biometric CSV import, late/OT/monthly/man-hours reports, month lock, export | `/attendance` | time office, HR, managers | ✅ |
| 19 | Admin expenses — office vs factory, budget vs actual, register, entry with bill; my expense claims | `/expenses` | admin, accounts, all (claims) | ✅ |
| 20 | Admin home — company, numbering series, alert thresholds & SLA settings | `/admin` | MD, IT | ✅ |
| 21 | Roles & permissions matrix editor | `/admin/roles` | MD, IT | ✅ |
| 22 | Approval matrix editor | `/admin/approvals` | MD, IT | ✅ |
| 23 | Employees & logins | `/admin/employees` | HR, IT | ✅ |
| 24 | Masters — verticals, departments, designations, locations/geofences, items, vendors | `/admin/masters` | IT, purchase | ✅ |
| 25 | Template manager (Word/Excel versions, email templates) | `/admin/templates` | MD, IT | ✅ |
| 26 | Audit log | `/admin/audit` | MD, IT | ✅ |
| 27 | Global search | `/search` | all (scoped) | ✅ |
| 28 | Notifications | `/notifications` | all | ✅ |
| 29 | Profile — devices/sessions, remote logout, PIN | `/profile` | all | ✅ |
| — | Markal job orders, production board, job cards, inspection, NCR, dispatch documents | | | 🔜 Phase 2 |
| — | I&C, O&M contracts & assets, maintenance service calls, consultancy, trading | | | 🔜 Phase 3 |
| — | Payroll, payslips, full finance (AR/AP, BG/EMD, cash flow), Tally, WhatsApp, scheduled MIS | | | 🔜 Phase 3 |
