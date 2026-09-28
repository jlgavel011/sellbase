---
name: sellbase-report-to-sellbase
description: Draft a bug report, idea or extension for the Sellbase maintainers so Sellbase keeps improving. Use when a Sellbase tool or component fails unexpectedly, the docs are wrong, you had to write a workaround, or you built something on top of Sellbase (new field, integration, report, admin page) that other stores would need.
---

# Report to Sellbase

Sellbase is open source and improves through what agents run into. Every report helps the next store.

## When to report

- **Bug:**
  - an error that does not match the docs;
  - a `hint` that does not work;
  - `sellbase doctor` or `upgrade` failing;
  - a component that breaks;
  - a migration error;
  - something you had to patch or work around.
- **Idea:** something the owner asked for that Sellbase could do natively.
- **Extension:** you built something on top of Sellbase for this store, such as a custom field in `metadata`, an integration (shipping, invoicing, WhatsApp), a report, or an admin page with `config.pages`. Describe it so the maintainers can consider shipping it for everyone.

Do not report problems in the owner's own code, or questions that the docs answer (`docs_search`).

## How

1. **Collect the facts:**
   - what you did (tool or command);
   - what you expected;
   - what happened (error `code`, `message` and `hint`);
   - the Sellbase version (`npx sellbase --version`);
   - the project type.
     For extensions: what the owner needed and a short outline of what you built.
2. **Draft it** with the MCP tool `feedback_draft` or the CLI:

   ```bash
   npx sellbase feedback --kind bug \
     --title "product_upsert rejects …" \
     --summary "…" --steps "1. … 2. …" --expected "…" \
     --details-file ./error.txt --area api --agent "Claude Code"
   ```

   Secrets (API keys, tokens, connection strings) and personal data (emails, phones) are redacted automatically.

3. **Ask the owner:** show the draft and ask _"¿Quieres compartir este reporte con el equipo de Sellbase para que lo mejoren?"_ / _"Do you want to share this report with the Sellbase team?"_
4. **If they agree,** give them the link (`submit_url`). They review and submit the issue on GitHub. **Never submit it yourself and never send anything without their yes.**

## Never include

- customer names, emails, phones or addresses;
- order contents or amounts from real sales;
- API keys, tokens, webhook secrets or database URLs;
- the owner's private code beyond the few lines needed to reproduce the problem.

When in doubt, leave it out and describe it in words.
