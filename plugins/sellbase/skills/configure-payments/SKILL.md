---
name: sellbase-configure-payments
description: Connect Stripe (payments) and Resend (email) to a Sellbase store. Use when store_status reports payments, webhooks or email as pending.
---

# Configure payments and email

## Stripe (test mode first)

1. Ask the owner for their Stripe **test** secret key (`sk_test_…`, at dashboard.stripe.com/test/apikeys). Prefer that they paste it into `.env.sellbase` themselves (`STRIPE_SECRET_KEY=`) instead of the chat, then read it from there.
2. Webhooks:
   - **Deployed** (public https Supabase URL): call `integration_connect` without `webhook_secret`. Sellbase creates the Stripe webhook endpoint and stores its secret.
   - **Local**: run `stripe listen --forward-to <SUPABASE_URL>/functions/v1/sellbase-webhooks/stripe` and keep it running. Pass the `whsec_…` it prints as `webhook_secret`.
3. `integration_connect` with `provider: "stripe"`. Follow `next_steps` in the response.
4. Run `test_purchase`. Then check `store_status`: `payments` warns "test mode" until you go live, which is expected.

## Going live (real money)

Only when the owner explicitly says the store is ready to sell. Full guide: `docs/guides/stripe-live.md`.

1. The Stripe account must be activated (business details and bank account). `store_status` fails `payments` while live charges are disabled.
2. **The owner connects the live key themselves** in the admin (Settings → Payments), so it goes straight to Supabase Vault. Never ask for it in chat or put it in a file. Use a restricted `rk_live_…` key if they prefer, with write access to Checkout Sessions, Payment Intents, Refunds and Webhook Endpoints.
3. After they connect it, check `store_status`: `payments` shows the live account, and deployed projects get the Stripe webhook automatically. (`integration_connect` with `confirm: true` also accepts live keys, but prefer the admin.)
4. `payments_live_check` with `confirm: true`: give the owner the URL. They pay the minimum (10 MXN or 0.50 USD) with a real card, and it is refunded automatically. `store_status` then shows "Live payment check" ok. Stripe keeps its small fee.
5. `test_purchase` never runs with live keys; it tells you to use the live check.

Never echo keys back. Never switch back to test keys on a live store without asking: pending checkouts would fail.

## Resend (email)

Without Resend, order emails are only printed to the function logs. Ask for an API key (`re_…`, resend.com/api-keys), call `integration_connect` with `provider: "resend"`, then `integration_test`. Until a domain is verified in Resend, emails only reach the account owner's address.
