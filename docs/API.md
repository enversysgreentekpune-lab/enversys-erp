# API reference

All UI mutations are **server actions** (`src/app/actions/*`), protected by the session cookie and RBAC. The REST endpoints below exist for downloads and integrations.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | none | Liveness + DB check |
| GET | `/api/files/{attachmentId}` | session; parent record must be in scope | Download/preview a document (audited) |
| GET | `/api/dossier/{woId}` | session; WO in scope | ZIP of the full job dossier (enquiry → proposal revisions → PO → uploads) with `00 INDEX.txt` |
| GET | `/api/export/{kind}` | session + `export` permission | Excel export. `kind` = `customers`, `leads`, `proposals`, `work-orders`, `attendance?month=YYYY-MM`, `spec?proposal=id`, `md` (KPIs + WOs for the selected frame). Accepts the same filters as the screen |
| GET | `/api/templates/{id}` | session + `settings.view` | Download a template version |
| POST | `/api/webhooks/website-lead` | header `x-webhook-secret: $WEBSITE_LEAD_SECRET` | Website enquiry → customer/contact (deduped) + lead + task for the Sales Manager |
| POST | `/api/email/inbound` | header `x-webhook-secret: $INBOUND_WEBHOOK_SECRET` | Inbound email → threaded on the lead (In-Reply-To, else `[ENV/ENQ/..]` in subject, else sender = contact on an open lead) + notification to the owner |
| GET | `/api/email/open/{emailId}` | none (tracking pixel) | Marks an outbound email OPENED |

### Website lead
```bash
curl -X POST https://app.enversys.com/api/webhooks/website-lead \
  -H "Content-Type: application/json" -H "x-webhook-secret: $WEBSITE_LEAD_SECRET" \
  -d '{"name":"R. Kumar","company":"ACME Pharma","email":"rk@acme.example","mobile":"9822000000","message":"Need 30 KLD ETP","vertical":"PRJ","category":"Effluent Treatment"}'
```
Response `201 {"ok":true,"id":"…","enquiry_no":"ENV/ENQ/26-27/0027"}`. `vertical` codes: PRJ, MFG, IC, OM, MNT, CON, TRD.

### Inbound email
Point your provider's inbound-parse webhook (SendGrid / Mailgun / Postmark) or an IMAP/Microsoft Graph poller at `/api/email/inbound` with the JSON body:
```json
{ "from": "Rajesh <projects@customer.com>", "to": "sales@enversys.com", "subject": "Re: [ENV/ENQ/26-27/0012] Our offer…", "text": "…", "html": "…", "messageId": "<abc@mail>", "inReplyTo": "<uuid@enversys.com>" }
```
Duplicate `messageId`s are ignored.

### Outbound email
Configured with `SMTP_*`. Every message carries `[ENQUIRY NO]` in the subject and a `Message-ID` so replies thread back. With `SMTP_HOST` empty (dev), messages are written to `storage/outbox/*.eml` instead of being sent.
