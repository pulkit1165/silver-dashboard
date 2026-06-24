# Database backups (Neon)

The production database is **Neon Postgres**. There are two independent layers:

## 1. Neon built-in — automatic, no setup
- **Point-in-time restore (PITR):** Neon continuously retains history, so you can
  restore the DB to any moment within the retention window (~7 days on the Launch plan).
- **Branching:** create a branch at any past timestamp to inspect/recover data.
- Do it in the Neon console → your project → **Branches / Restore**.

## 2. Off-site daily backup — GitHub Actions (`.github/workflows/neon-backup.yml`)
A second copy **outside Neon**, in case the Neon account/project itself is ever lost.
Runs nightly (01:00 IST), dumps the whole DB, encrypts it (AES-256), and stores it as a
downloadable GitHub **artifact** (90-day retention).

### One-time setup (required)
Add two repository secrets — GitHub → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `DATABASE_URL` | the Neon connection string (the same one in Vercel; pooled is fine) |
| `BACKUP_PASSPHRASE` | a strong passphrase to encrypt the backups — **store it somewhere safe; without it the backups can't be decrypted** |

Or via CLI:
```bash
gh secret set DATABASE_URL --repo pulkit1165/silver-dashboard
gh secret set BACKUP_PASSPHRASE --repo pulkit1165/silver-dashboard
```

Then run it once manually to confirm: GitHub → **Actions → Neon daily backup → Run workflow**.

### How to restore from an off-site backup
1. Download the artifact: GitHub → **Actions** → open a "Neon daily backup" run → download `neon-backup-*` → you get `neon-backup-YYYY-MM-DD_HHMM.sql.gz.gpg`.
2. Decrypt and unzip (you'll be prompted for `BACKUP_PASSPHRASE`):
   ```bash
   gpg --decrypt neon-backup-*.sql.gz.gpg | gunzip > restore.sql
   ```
3. Restore into a target database (a fresh Neon branch/project, or local):
   ```bash
   psql "<TARGET_DATABASE_URL>" < restore.sql
   ```

> The dump uses `--no-owner --no-privileges` so it restores cleanly into any Postgres,
> including a brand-new Neon project on a different account/provider.
