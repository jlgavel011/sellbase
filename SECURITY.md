# Security policy

Sellbase handles payments and customer data, so security reports get priority.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through [GitHub security advisories](https://github.com/jlgavel011/sellbase/security/advisories/new) with:

- what is affected (package, endpoint, migration) and the version or commit;
- steps to reproduce, or a proof of concept that does not touch real customer data;
- the impact you expect.

We acknowledge reports within 3 business days and keep you updated until a fix ships. Please give us a reasonable time to release a fix before disclosing.

## Scope and design

Things we consider vulnerabilities:

- RLS bypasses;
- reading or changing another store's data;
- creating orders without a verified payment;
- leaking the service role key or Vault secrets to a browser;
- webhook signature bypasses;
- SSRF through outbound webhooks;
- agents getting money scopes (`refunds:write`) or data export scopes (`webhooks:write`) without the owner granting them.

The security model is described in [`SPEC.md`](SPEC.md) and the ADRs in [`docs/decisions/`](docs/decisions/), especially:

- 0004: RLS read-only, writes through the API;
- 0006: Stripe Checkout;
- 0010: tokens, webhooks and the network guard;
- 0011: live Stripe.
