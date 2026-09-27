---
name: sellbase-upgrade
description: Update Sellbase in this project (database migrations, Edge Functions, components, skills) safely. Use when store_status reports a schema mismatch, when the owner asks to update Sellbase, or after installing a newer `sellbase` package.
---

# Upgrade Sellbase

1. **Read what changed.** Check the changelog of the new `sellbase` package (`node_modules/sellbase/assets/CHANGELOG.md`), especially **"What your agent should review"**.
2. **Dry run first.** Run `npx sellbase upgrade --dry-run`. It lists pending migrations, applies them inside a transaction that is rolled back, and reports errors without touching data. It also lists which files would change.
3. **Apply.** Run `npx sellbase upgrade`. It:
   - saves a backup of the `sellbase` schema in `.sellbase/backups/` (with `pg_dump` when available);
   - applies the migrations;
   - redeploys the Sellbase functions (hosted projects);
   - refreshes skills, rules and the `CLAUDE.md` section;
   - runs the doctor.
4. **Components the owner edited are never overwritten.** For each one, `upgrade` writes `.sellbase/updates/<file>.diff` with the upstream change. Merge those diffs by hand, keeping the site's design, then delete them.
5. **Verify.** Run `store_status` and `test_purchase` (test mode). If something fails, follow the hints. To roll back, restore the backup: `psql "$DB_URL" -f .sellbase/backups/<file>.sql`. Then tell the owner.

Never edit the Sellbase migrations (listed in `.sellbase/manifest.json`) or `supabase/functions/sellbase-*` by hand: upgrades replace them.
