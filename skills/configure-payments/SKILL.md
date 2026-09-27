---
name: sellbase-configure-payments
description: Connect Stripe (payments) and Resend (email) to a Sellbase store. Use when store_status reports payments, webhooks or email as pending.
---

# Configure payments and email

## Stripe

1. Ask the owner for their Stripe **test** secret key (`sk_test_…`, at dashboard.stripe.com/test/apikeys). Prefer that they paste it into `.env.sellbase` themselves (`STRIPE_SECRET_KEY=`) instead of the chat, then read it from there.
2. Webhook secret:
   - Local development: `stripe listen --api-key $STRIPE_SECRET_KEY --print-secret` prints a `whsec_…`; keep `stripe listen --forward-to <SUPABASE_URL>/functions/v1/sellbase-webhooks/stripe` running while testing.
   - Production: create an endpoint in the Stripe dashboard pointing to `<SUPABASE_URL>/functions/v1/sellbase-webhooks/stripe` with events `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and use its signing secret.
3. Call `integration_connect` with `provider: "stripe"`, `secret_key` and `webhook_secret`, then `integration_test`.
4. Run `test_purchase`.

Never switch to live keys (`sk_live_…`) unless the owner explicitly asks. Never echo keys back.

## Resend (email)

Without Resend, order emails are only printed to the function logs. Ask for an API key (`re_…`, resend.com/api-keys), call `integration_connect` with `provider: "resend"`, then `integration_test`. Until a domain is verified in Resend, emails only reach the account owner's address.
