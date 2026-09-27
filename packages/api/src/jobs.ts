import { renderOrderConfirmation } from '@sellbase/emails';
import type { TransactionSql } from 'postgres';
import type { Deps } from './deps.js';
import { fulfillDigital, loadOrderEmailProps, refreshOrderStatus } from './fulfillment.js';

/** Event types the job runner acts on; everything else is marked processed untouched. */
const HANDLED = new Set(['order.paid']);
const MAX_ATTEMPTS = 8;

/**
 * Processes the outbox (SPEC §5.7). Each event runs in its own transaction; failures are
 * retried on the next run up to MAX_ATTEMPTS, with the error kept in `last_error`.
 */
export async function runJobs(deps: Deps, options: { limit?: number } = {}) {
  const { sql } = deps;
  await sql`select sellbase.release_expired_checkouts()`;

  const summary = { processed: 0, failed: 0 };
  const events = await sql<
    { id: string; type: string; store_id: string; entity_id: string | null }[]
  >`
    select id, type, store_id, entity_id from sellbase.events
     where processed_at is null and attempts < ${MAX_ATTEMPTS}
     order by created_at limit ${options.limit ?? 50}`;

  for (const event of events) {
    try {
      await sql.begin(async (tx) => {
        const [locked] = await tx`
          select id from sellbase.events where id = ${event.id} and processed_at is null for update skip locked`;
        if (!locked) return;
        if (HANDLED.has(event.type) && event.entity_id)
          await handleOrderPaid(deps, tx, event.store_id, event.entity_id, event.id);
        await tx`update sellbase.events set processed_at = now(), attempts = attempts + 1, last_error = null where id = ${event.id}`;
      });
      summary.processed += 1;
    } catch (error) {
      summary.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      await sql`update sellbase.events set attempts = attempts + 1, last_error = ${message} where id = ${event.id}`;
    }
  }
  return summary;
}

async function handleOrderPaid(
  deps: Deps,
  tx: TransactionSql,
  storeId: string,
  orderId: string,
  eventId: string,
) {
  const links = await fulfillDigital(deps, tx, orderId);
  await refreshOrderStatus(tx, orderId);
  const props = await loadOrderEmailProps(tx, orderId, links);
  if (!props) return;
  const { email: to, ...emailProps } = props;
  const email = await renderOrderConfirmation(emailProps);
  const order = { email: to };
  const notify = await deps.notify(storeId);
  const [notification] = await tx<{ id: string }[]>`
    insert into sellbase.notifications (store_id, event_id, channel, "to", template)
    values (${storeId}, ${eventId}, 'email', ${order.email}, 'order_confirmation') returning id`;
  // The provider idempotency key makes a retried job safe: the email is not sent twice.
  const sent = await notify.send({
    to: order.email,
    ...email,
    idempotency_key: `order-confirmation-${orderId}`,
  });
  await tx`
    update sellbase.notifications set status = 'sent', provider_message_id = ${sent.provider_message_id}
     where id = ${notification?.id ?? null}`;
  await tx`
    insert into sellbase.order_events (store_id, order_id, type, message, data)
    values (${storeId}, ${orderId}, 'notification.sent', 'Order confirmation email sent.',
            ${tx.json({ to: order.email, provider: notify.id } as never)})`;
}
