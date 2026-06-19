# Deploying the Silver ERP (Vercel + Neon PostgreSQL)

Production stack: **Next.js on Vercel** (app + APIs, HTTPS) + **Neon** (managed,
serverless PostgreSQL — backups, branching, recovery). The QR camera needs HTTPS,
which Vercel provides automatically, so phone scanning works on the live URL.

## 1. Create the database (Neon — free tier to start)
1. Sign up at https://neon.tech and create a project (region near your users).
2. Copy the **pooled** connection string (looks like
   `postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require`).

## 2. Create the schema + seed (run once, locally, pointed at Neon)
```bash
# from the project folder
echo 'DATABASE_URL=<your-neon-pooled-url>' > .env.production.local   # or export it
DATABASE_URL='<your-neon-pooled-url>' npm run db:push     # create tables
DATABASE_URL='<your-neon-pooled-url>' npm run db:seed     # seed sample data (idempotent)
```
(You can skip the seed in real production and load real master data instead.)

## 3. Deploy on Vercel
1. Push this repo to GitHub (already at `pulkit1165/silver-dashboard`).
2. On https://vercel.com → **Add New → Project → Import** the repo.
3. Framework preset: **Next.js** (auto-detected). Build command stays `next build`.
4. **Environment Variables** → add:
   - `DATABASE_URL` = your Neon **pooled** connection string.
   - (optional, for the read-only Oracle dashboard later) the `ORACLE_*` vars.
5. Deploy. You get an HTTPS URL — open `/erp` and `/erp/scan` on a phone.

### CLI alternative
```bash
npm i -g vercel    # already installed here
vercel login
vercel link
vercel env add DATABASE_URL production   # paste the Neon URL
vercel --prod
```

## Notes for scale / reliability
- **Connection pooling:** we use `postgres.js` with `prepare:false` against Neon's
  pooler — safe for serverless. For very high throughput, switch to the Neon HTTP
  driver (`@neondatabase/serverless`) later; the query layer is isolated in
  `lib/erp/queries.ts` + `lib/erp/scan.ts`.
- **Backups:** Neon does automated backups + point-in-time restore. Enable the
  retention you need in the Neon console.
- **Migrations:** schema lives in `lib/erp/schema.ts`; use `npm run db:push` (dev)
  or generate versioned migrations with `drizzle-kit generate` for production change
  control.
- **Next hardening layers (recommended before go-live):** real auth + 2FA
  (Auth.js/Clerk), Sentry error monitoring, a staging Neon branch, CI tests, and
  data migration from the existing Oracle system.
- The read-only Oracle reporting link is independent and unaffected.
