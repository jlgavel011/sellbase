# Deploy to production

Sellbase has no servers of its own. In production it runs in **your** Supabase project (database, Auth, Storage, Edge Functions, cron) and your site runs wherever it runs today (Vercel, Netlify, Cloudflare Pages, a VPS, WordPress hosting…).

## 1. Create the Supabase project

1. Create a project at [supabase.com](https://supabase.com/dashboard).
2. From **Project Settings → API**, copy the project URL, the anon key and the service role key. From **Database → Connect**, copy the connection string (session pooler).
3. Link your repo to it:

   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   ```

## 2. Install Sellbase against it

```bash
npx sellbase init --yes \
  --store-name "My store" --currency MXN --country MX \
  --owner-email you@yourstore.com \
  --supabase-url https://<ref>.supabase.co \
  --anon-key <anon key> \
  --service-role-key <service role key> \
  --db-url "postgresql://…"
```

What `init` does:

- **Migrations:** applies them with `supabase db push`.
- **Edge Functions:** deploys `sellbase-api`, `sellbase-webhooks` and `sellbase-jobs`.
- **Store and jobs:** creates the store and schedules the jobs (pg_cron, every minute).
- **Owner:** emails the owner an invitation to set their password.
- **Project files:** writes the public config (`.env.local`, or `sellbase/config.js` for sites without React) and the agent files.

The service role key is used only during `init`. It is not written to any file.

## 3. Deploy your site

- **Next.js / Vite:** set the public variables from `.env.local` in your hosting (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SELLBASE_URL`, or the `VITE_` versions) and deploy as usual. The admin lives at `/admin`.
- **Plain HTML, WordPress or any other site:** upload the `sellbase/` and `admin/` folders with the rest of the site. The admin works at `/admin/` with no server rewrites (it uses `#/` routes).

## 4. Finish setup in the admin

Sign in at `/admin` and follow the **setup guide** on Home. Every step can also be done by your AI agent over MCP.

1. **Settings → General:** logo, brand color, contact email.
2. **Settings → Payments:** paste your Stripe secret key. It is stored in Supabase Vault. On a deployed project the Stripe webhook is created for you. Start with `sk_test_…`; switch to live keys when you are ready ([live payments guide](stripe-live.md)).
3. **Settings → Notifications:** connect Resend with a verified domain so customers get order, shipping and download emails. Send yourself a test email.
4. **Settings → Checkout:**
   - your store URL (used by abandoned checkout emails and payment links);
   - a required checkbox if you sell age-restricted products;
   - automatic recovery emails.
5. **Settings → Shipping and Taxes.**
6. Make a test purchase and check that the order appears in **Orders**.

## 5. Check and keep it healthy

```bash
npx sellbase doctor     # every check with the next step when something is missing
npx sellbase upgrade    # new versions: dry run, backup, migrations, functions, components
```

The doctor fails if `SELLBASE_WEBHOOKS_ALLOW_PRIVATE` is on in a deployed project (it is only for the local stack).

**Backups:** Supabase takes daily backups on paid plans. `sellbase upgrade` also dumps the `sellbase` schema before applying migrations.

## Checklist before selling

- [ ] Stripe live keys connected and the live check passed (Settings → Payments)
- [ ] Resend connected with your domain; test email received
- [ ] Store URL, contact email, shipping and taxes set
- [ ] A real purchase with your own card, then refunded from the order page
- [ ] Team members invited with the right role (Settings → Team)
- [ ] AI agent tokens only have the scopes they need (Settings → AI agents)
