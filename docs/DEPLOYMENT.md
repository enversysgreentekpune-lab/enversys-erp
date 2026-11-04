# Deployment guide

## Requirements
Node 20+ (tested on 22), PostgreSQL 14+ (tested on 16), persistent disk or S3-compatible bucket for documents, SMTP account, SMS/OTP gateway.

## Local / demo
```bash
cp .env.example .env            # set DATABASE_URL and a long random SESSION_SECRET
npm install
npm run db:migrate && npm run db:seed   # or: npm run db:reset (drops everything!)
npm run dev                      # http://localhost:3000 — OTP shows on the login screen in dev
```
Production-mode locally: `npm run build && npm start` (the OTP is then only printed to the server log when `OTP_PROVIDER=console`).

## Production checklist
1. **Database**: managed Postgres (AWS RDS / Azure Flexible Server / Supabase) with daily backups + point-in-time recovery. Run `npm run db:migrate` on each release. **Do not run the seed in production**; create the MD/IT users with SQL or a one-off script, then use Admin → Employees.
2. **Secrets**: `SESSION_SECRET` (≥32 random chars), `INBOUND_WEBHOOK_SECRET`, `WEBSITE_LEAD_SECRET`.
3. **OTP**: `OTP_PROVIDER=msg91` (`MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` — DLT-approved template) or `twilio`.
4. **Email**: `SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM`; `APP_URL` enables open-tracking pixels.
5. **Storage**: `STORAGE_DIR` on a persistent volume and include it in backups. For S3, implement the S3 driver behind `putFile/getFile` in `src/lib/storage.ts` (not yet done).
6. **HTTPS** is mandatory (cookies are `Secure` in production). Put the app behind a load balancer / Vercel / Azure App Service.
7. **Website form & inbound mail**: configure both webhooks (see API.md).
8. **Templates**: replace the default Word/Excel templates with letterhead versions in Admin → Templates.

## Hosting options
- **Vercel + Supabase**: works for the app, but local-disk storage is not persistent on Vercel. Use the S3/Supabase Storage driver first.
- **Single VM / container (simplest)**: `npm ci && npm run build && npm start` behind nginx, with Postgres managed separately and a mounted volume for `storage/`.

## Tests
```bash
createdb enversys_test   # once
npm test                 # resets the test DB, seeds it, runs unit + end-to-end flow tests
```
