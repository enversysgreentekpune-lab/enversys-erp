# Enversys Business Suite

One system for Enversys (STP, ETP, WTP, ZLD, OWC): **client → lead enquiry → proposal (cost sheet, site visit, revisions) → PO / SO won → project code → purchase → store → Markal manufacturing → dispatch → accounts**, plus employee attendance, location, tasks, expenses, performance and the Directors dashboard. Every cost is booked to a project code. The look follows www.enversys.com: white screens, brand green for actions, Montserrat and Inter type, and the Enversys logo.

## Quick start (demo)
```bash
cp .env.example .env          # set DATABASE_URL, SESSION_SECRET
npm install
npm run db:migrate && npm run db:seed
npm run dev                   # http://localhost:3000 — the OTP is shown on the login screen in demo mode
```

| Mobile | Person | What to look at |
|---|---|---|
| 9800000001 | Amol Gajare, Director | Directors dashboard, everything |
| 9800000007 | Rohit Shinde, Sales Engineer | Only his own leads and proposals |
| 9800000012 | Kiran Bhosale, Project Manager | Projects, team tasks, approving a field service report |
| 9800000015 | Prakash Gaikwad, Factory Manager | Manufacturing, manpower, store |
| 9800000027 | Mahesh Lokhande, Storekeeper | Store, material receipts, issues to jobs |
| 9800000022 | Shweta Kulkarni, Accounts | Accounts, SO billing, expense approvals |
| 9800000024 | Priya Wagh, HR | Employees, live map, performance |
| 9800000014 | Sachin More, Site Engineer (field) | Field view: attendance and tasks only |
| 9800000021 | Ajay Thorat, O&M Technician (field) | Field service with client OTP |

## Features

| # | Requirement | Where |
|---|---|---|
| 1 | Client dashboard: total, new this month / year, active clients, proposals submitted recently | Clients |
| 2 | Lead received → customer register → lead details. Only the MD sees all leads; others see leads assigned to them | Lead Enquiries |
| 3 | Proposal flow: cost sheet → submission → site visit report with photos (if required) → revision → PO/WO win → PO/SO copy upload → project code. Only the MD sees all proposals; others see the ones they created or are assigned | Proposals |
| 4 | Purchase dashboard: project code → cost-sheet budget → purchase orders → material receipt register and bill receipts (paid / unpaid) | Purchase |
| 5 | Manufacturing: every job has a project code and project item code; daily manpower and who works on which project; material cost by type (MS/SS sheets, welding rods, grinding wheels, PPE, paint…), electricity, site admin; cost per item and per tonne; Tanks / Skid & Assembly / Other / OWC Skid & Assembly / Control Panels completed, in progress, new pending | Manufacturing |
| 6 | Store: material register, stock by location, low stock, delayed material, bills, receipt dates and challans with evidence | Store |
| 7 | Dispatch: material by project code, projects dispatched / pending, project item register (received / not received), challans with photos, bill, e-way bill, delivery challan, client received copy | Dispatch |
| 8 | Accounts: billed, unbilled as per PO, GST received and not received | Accounts |
| 9 | SO dashboard: won SOs, completed / in progress, due list: milestones → achieved → billed → unbilled → GST | Service Orders |
| 10 | Employee management: daily and monthly attendance, current location map (Google Maps links), time office, leave approval by manager | Employees, Time Office |
| 11 | Task management: assigned, completed, pending, lapsed | Tasks |
| 12 | Expenses with proof, approved by reporting manager and then accounts head | Expenses, Approvals |
| 13 | Performance matrix from daily and assigned tasks with evidence, DWRs and attendance; downloadable per employee | Performance |
| 14 | Field employees see only attendance and tasks; upload service report; transfer task; email updates; report sent to client after manager approval; client confirms completion with OTP on mobile and email | My Attendance, My Tasks |
| 15 | Directors dashboard: six KPI lines (sales, orders, procurement, people & admin, manufacturing cost, jobs) for any period | Directors Dashboard |

Also included from the first release: OTP login with PIN and device control, role & permission matrix editor, approval matrix, Word/Excel quote generation and email, revision compare, auto purchase requisition and draft POs, WO budget vs actual, job dossier ZIP, audit log, Excel exports, PWA install.

## Tests
`npm test` runs 37 tests against a separate test database. They cover the cost engine, role rules (MD-only lead visibility, field-staff restrictions), FY periods, document templates, the sales-to-project flow, purchase → GRN → bill → payment, stock checks on issue, dispatch and invoice limits, the field-service OTP flow, two-step expenses, daily tasks and the performance score.

## Launch
- **Hosting:** `render.yaml` deploys the app and a PostgreSQL database on Render in one step. Any Node 20+ server with PostgreSQL 14+ also works. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- **Before real users:**
  - Set `DEMO_MODE=false`.
  - Connect MSG91 for OTP SMS. Client OTPs use the same gateway; DLT template registration takes 1–2 weeks.
  - Connect SMTP (Microsoft 365 / Google) so task updates and service reports reach clients.
  - Add persistent file storage.
  - Load real employees, clients and items.
- **Maps:** the live map uses OpenStreetMap tiles and links each person to Google Maps. A Google Maps API key is not required.

## Documentation
[Architecture](docs/ARCHITECTURE.md) · [Data model](docs/ERD.md) · [Permissions](docs/PERMISSIONS.md) · [Screens](docs/SCREENS.md) · [API](docs/API.md) · [Deployment](docs/DEPLOYMENT.md) · [User guide](docs/USER_GUIDE.md)
