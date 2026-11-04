# User guide

## Everyone
- **Login**: enter your registered mobile → OTP → you land on your dashboard. Set a 4-digit PIN in *Profile* to log in faster on the same phone. *Profile → Active devices* lets you log out a lost phone.
- **Install as an app**: open the site on your phone → browser menu → *Add to Home screen*.
- **Check in/out** (`My Dashboard → Attendance`): allow location access. Check-in works only inside a geofence (HO, Markal Factory, project sites). Arriving more than 15 minutes after the shift start gives a late mark, and time beyond 9 hours counts as OT.
- **Daily Work Report**: submit what you did and the hours for each WO by the end of the day. Hours are costed to the WO automatically. You can resubmit to correct the day's report.
- **Leave**: apply from the dashboard. Your reporting manager approves it.
- **Expense claims**: *Admin Expenses → My expense claims*. Charge the claim to a WO or to office admin, and attach a photo of the bill.
- **Tasks**: the board shows To do / In progress / Done. Overdue tasks are shown in red.

## Sales engineer / sales manager
1. **Register the enquiry** (`Leads → New enquiry`). Pick an existing customer or type a new name to create one. Attach the RFQ, drawings and BOQ.
2. **Work the lead**: log calls and meetings (meetings are geo-tagged) and set the next follow-up. Every stage change needs a remark, and *Lost* needs a reason.
3. **Proposal** (`+ New proposal` on the lead):
   - *Material spec*: type or choose an item code to auto-fill specs, or import from Excel.
   - *Cost sheet*: use **Create cost lines from item master rates**, then add fabrication, engineering, I&C, freight and similar lines. Adjust contingency, overheads, discount and GST mode. Only users with margin-override rights can change the margin %.
   - *Commercial terms*.
   - **Submit for internal approval**. The approver depends on the discount (≤5% Sales Manager, 5–10% Business Head, >10% MD).
4. After approval: **Documents → Generate Word + Excel**, then **Send to customer**. The generated files are pre-attached, and sending marks the proposal *Submitted*.
5. If the customer asks for changes: **Create R1** (give a reason), edit it, and send it for re-approval. The *Revisions* tab compares any two revisions.
6. **Won**: open the *Mark as Won* tab and enter the customer PO no., date and value, the order type, the PM and the executors, and upload the PO. This creates the WO automatically.

## Project manager
- Open your WO in **Work orders**. The *Overview & P&L* tab shows budget (from the cost sheet) vs actual + committed cost, margin quoted vs estimated, milestones and invoices.
- **Team** tab: assign executors and support members. **Costs** tab: book site expenses, freight and subcontracts with the bill. **Dossier** tab: upload drawings and reports into the standard folders, and download the full ZIP.
- Update % complete and status regularly. These drive the RAG flags on the MD dashboard.

## Purchase
- Each won order creates a **PR** (vendor lines vs Markal lines) and **auto-drafted POs** grouped by preferred vendor, at the last purchase rate.
- Open a draft PO, edit the vendor, qty, rate, GST and terms, and submit. If the PO exceeds the cost-sheet budget you must tick the acknowledgement box. Approval follows the PO value matrix. Once approved, the value shows as *committed cost* on the WO.

## Time office / HR
- **Time Office**: muster roll per location, manual corrections, biometric CSV import (`emp_code,date,in,out`), late/OT/monthly/man-hours reports, and **Lock month** before payroll.
- **Admin → Employees**: register a mobile number to give someone access. Set the role, reporting manager, location and labour cost rate. Deactivating someone logs them out everywhere.

## Accounts / Admin
- **Admin Expenses**: office (HO) and factory (Markal) expenses are kept separate, with monthly budget vs actual by expense head. Expense claims come to you in **Approvals**.

## MD / Business Head
- **MD Command Centre**: pick the time frame (month, quarter, FY, YTD, custom), the comparison, the vertical and the unit (₹ L/Cr). Click any KPI, alert or row to drill down. Use *Export Excel* or *PDF/Print*. Business Heads see their own vertical only.
- **Approvals**: quotes, POs and expense claims that need your decision, with margin and value.

## Super Admin / MD — administration
- **Roles & permissions**: per role, set the scope (Own / Team / Vertical / Company) for each module × action. Changes take effect on the user's next page load.
- **Approval matrix**, **Masters** (including location geofences and shifts), **Templates** (upload new Word/Excel versions; a template that fails a test render is rejected), **Settings** (alert thresholds), **Audit log**.
