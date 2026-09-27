import { sellbaseError, toErrorResponse } from '@sellbase/core';
import { Hono } from 'hono';
import type { Deps } from './deps.js';
import { fromDbError } from './errors.js';
import { kickJobs } from './jobs.js';

/**
 * Payment provider webhooks (SPEC §8 step 3). Signature first, then the event id is
 * recorded in `processed_webhooks` in the same transaction as its effect, so duplicates
 * and retries are no-ops and a crash never leaves half an order.
 */
export function createWebhooksApp(deps: Deps, basePath = '/sellbase-webhooks') {
  const app = new Hono().basePath(basePath);

  app.post('/:provider', async (c) => {
    const provider = c.req.param('provider');
    try {
      const storeId = await deps.storeId();
      const adapter = await deps.payments(storeId);
      const secrets = await deps.secrets(storeId, provider);
      if (!adapter || adapter.id !== provider || !secrets?.webhook_secret) {
        throw sellbaseError(
          'VALIDATION_ERROR',
          `Webhooks for "${provider}" are not configured.`,
          `Connect ${provider} with a webhook_secret: POST /integrations/${provider}/connect.`,
        );
      }
      const event = await adapter.verifyWebhook(c.req.raw, secrets.webhook_secret).catch(() => {
        throw sellbaseError(
          'UNAUTHORIZED',
          'Invalid webhook signature.',
          'Check that the webhook_secret matches the one in the provider dashboard.',
        );
      });
      const normalized = adapter.mapEvent(event);

      const outcome = await deps.sql.begin(async (tx) => {
        const fresh = await tx`
          insert into sellbase.processed_webhooks (provider, event_id) values (${provider}, ${event.id})
          on conflict do nothing returning event_id`;
        if (fresh.length === 0) return 'duplicate';
        if (!normalized) return 'ignored';
        switch (normalized.type) {
          case 'checkout.paid':
            await tx`select sellbase.place_order_from_checkout(${normalized.checkout_session_id}, ${tx.json(
              {
                provider,
                provider_payment_id: normalized.provider_payment_id,
                method: normalized.method,
                amount: normalized.amount,
                currency: normalized.currency,
                raw: normalized.raw,
              } as never,
            )})`;
            return 'order_placed';
          case 'order.balance_paid':
            await tx`select sellbase.record_order_payment(${normalized.order_id}, ${tx.json({
              provider,
              provider_payment_id: normalized.provider_payment_id,
              method: normalized.method,
              amount: normalized.amount,
              currency: normalized.currency,
              raw: normalized.raw,
            } as never)})`;
            return 'balance_recorded';
          case 'checkout.expired':
            await tx`select sellbase.release_checkout_session(${normalized.checkout_session_id})`;
            return 'released';
          case 'checkout.pending':
          case 'payment.failed':
            return 'noted'; // deferred payments (OXXO/SPEI) arrive in Phase 2
        }
      });
      // Deliver files and send the confirmation right away; pg_cron retries if this fails.
      if (outcome === 'order_placed' || outcome === 'balance_recorded') kickJobs(deps);
      return c.json({ received: true, outcome });
    } catch (error) {
      const known = fromDbError(error);
      if (!known) console.error('[sellbase-webhooks] unexpected error', error);
      const body = toErrorResponse(known ?? error);
      // 4xx tells the provider not to retry a bad request; 5xx makes it retry later.
      const status =
        body.error.code === 'INTERNAL_ERROR' ? 500 : body.error.code === 'UNAUTHORIZED' ? 401 : 400;
      return c.json(body, status);
    }
  });

  return app;
}
