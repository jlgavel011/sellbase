import {
  renderBookingNotice,
  renderOrderConfirmation,
  renderOrderUpdate,
  toLocale,
  type RenderedEmail,
} from '@sellbase/emails';
import type { TransactionSql } from 'postgres';
import type { Deps } from './deps.js';
import {
  bookingEmail,
  fulfillDigital,
  loadBookingsForEmail,
  loadOrderEmailProps,
  refreshOrderStatus,
} from './fulfillment.js';

const MAX_ATTEMPTS = 8;

interface OutboxEvent {
  id: string;
  type: string;
  store_id: string;
  entity_id: string | null;
  payload: {
    notify?: boolean;
    template?: string;
    amount?: number;
    refunded_amount?: number;
    fulfillment_id?: string;
  };
}

/**
 * Processes the outbox (SPEC §5.7). Each event runs in its own transaction; failures are
 * retried on the next run up to MAX_ATTEMPTS, with the error kept in `last_error`.
 * Triggered right after writes (kickJobs) and every minute by pg_cron as a safety net.
 */
export async function runJobs(deps: Deps, options: { limit?: number; storeId?: string } = {}) {
  const { sql } = deps;
  await sql`select sellbase.release_expired_checkouts()`;

  const summary = { processed: 0, failed: 0 };
  const events = await sql<OutboxEvent[]>`
    select id, type, store_id, entity_id, payload from sellbase.events
     where processed_at is null and attempts < ${MAX_ATTEMPTS}
       ${options.storeId ? sql`and store_id = ${options.storeId}` : sql``}
     order by created_at limit ${options.limit ?? 50}`;

  for (const event of events) {
    try {
      await sql.begin(async (tx) => {
        const [locked] = await tx`
          select id from sellbase.events where id = ${event.id} and processed_at is null for update skip locked`;
        if (!locked) return;
        await handle(deps, tx, event);
        await tx`update sellbase.events set processed_at = now(), attempts = attempts + 1, last_error = null where id = ${event.id}`;
      });
      summary.processed += 1;
    } catch (error) {
      summary.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      await sql`update sellbase.events set attempts = attempts + 1, last_error = ${message} where id = ${event.id}`;
    }
  }
  await sendReminders(deps, summary, options.storeId);
  return summary;
}

/**
 * Appointment reminders 24 h and 2 h before (SPEC §9). Each reminder is claimed with an
 * UPDATE … RETURNING so concurrent runs never send it twice. Bookings made inside the
 * window (e.g. booked 3 h ahead) skip the 24 h reminder.
 */
async function sendReminders(
  deps: Deps,
  summary: { processed: number; failed: number },
  storeId?: string,
) {
  const { sql } = deps;
  for (const [column, hours] of [
    ['reminder_24h_sent_at', 24],
    ['reminder_2h_sent_at', 2],
  ] as const) {
    const due = await sql<
      {
        id: string;
        store_id: string;
        order_id: string | null;
        email: string | null;
        send: boolean;
      }[]
    >`
      update sellbase.bookings set ${sql(column)} = now()
       where status = 'confirmed' and ${sql(column)} is null and email is not null
         ${storeId ? sql`and store_id = ${storeId}` : sql``}
         and starts_at <= now() + ${`${hours} hours`}::interval and starts_at > now()
         ${hours === 24 ? sql`and starts_at > now() + interval '2 hours'` : sql``}
      returning id, store_id, order_id, email::text, created_at < starts_at - ${`${hours} hours`}::interval as send`;
    for (const booking of due) {
      if (!booking.send || !booking.email) continue;
      try {
        await sql.begin(async (tx) => {
          const [b] = await loadBookingsForEmail(tx, { bookingId: booking.id });
          if (!b || !booking.email) return;
          const props = booking.order_id
            ? await loadOrderEmailProps(tx, booking.order_id, [])
            : null;
          const locale = props?.locale ?? 'es';
          const brand = props?.brand ?? {
            store_name: b.store_name,
            logo_url: null,
            brand_color: null,
            contact_email: b.contact_email,
          };
          const { view, attachment } = bookingEmail(b, locale);
          const email = await renderBookingNotice({
            kind: 'reminder',
            brand,
            locale,
            booking: view,
          });
          const notify = await deps.notify(booking.store_id);
          const template = `booking_reminder_${hours}h`;
          const sent = await notify.send({
            to: booking.email,
            ...email,
            attachments: [attachment],
            idempotency_key: `reminder-${hours}h-${booking.id}`,
          });
          await tx`
            insert into sellbase.notifications (store_id, channel, "to", template, status, provider_message_id)
            values (${booking.store_id}, 'email', ${booking.email}, ${template}, 'sent', ${sent.provider_message_id})`;
          if (booking.order_id) {
            await tx`
              insert into sellbase.order_events (store_id, order_id, type, message, data)
              values (${booking.store_id}, ${booking.order_id}, 'notification.sent', ${`Email sent: ${email.subject}`},
                      ${tx.json({ to: booking.email, template, provider: notify.id } as never)})`;
          }
        });
        summary.processed += 1;
      } catch (error) {
        summary.failed += 1;
        console.error('[sellbase-jobs] reminder failed', booking.id, error);
      }
    }
  }
}

/** Runs the outbox in the background after a write, when the runtime supports it. */
export function kickJobs(deps: Deps) {
  deps.background?.(
    runJobs(deps).catch((error: unknown) => console.error('[sellbase-jobs]', error)),
  );
}

async function handle(deps: Deps, tx: TransactionSql, event: OutboxEvent) {
  const orderId = event.entity_id;
  if (!orderId) return;
  const notify = event.payload.notify !== false;
  switch (event.type) {
    case 'order.paid': {
      const links = await fulfillDigital(deps, tx, orderId);
      await refreshOrderStatus(tx, orderId);
      await confirmation(deps, tx, event, orderId, links);
      return;
    }
    case 'notification.requested':
      if (event.payload.template === 'order_shipped')
        await update(deps, tx, event, orderId, 'shipped');
      else await confirmation(deps, tx, event, orderId, []);
      return;
    case 'fulfillment.shipped':
      if (notify) await update(deps, tx, event, orderId, 'shipped');
      return;
    case 'refund.created':
      if (notify) await update(deps, tx, event, orderId, 'refunded');
      return;
    case 'order.cancelled':
      if (notify) await update(deps, tx, event, orderId, 'cancelled');
      return;
    case 'booking.rescheduled':
    case 'booking.cancelled':
      if (notify)
        await bookingNotice(
          deps,
          tx,
          event,
          orderId,
          event.type === 'booking.rescheduled' ? 'rescheduled' : 'cancelled',
        );
      return;
    default:
      return; // other events have no side effects yet
  }
}

async function bookingNotice(
  deps: Deps,
  tx: TransactionSql,
  event: OutboxEvent,
  bookingId: string,
  kind: 'rescheduled' | 'cancelled',
) {
  const [b] = await loadBookingsForEmail(tx, { bookingId });
  const [row] = await tx<
    { order_id: string | null; email: string | null; currency: string; locale: string }[]
  >`
    select bk.order_id, bk.email::text, s.default_currency::text as currency, s.default_locale as locale
      from sellbase.bookings bk join sellbase.stores s on s.id = bk.store_id where bk.id = ${bookingId}`;
  if (!b || !row?.email) return;
  const props = row.order_id ? await loadOrderEmailProps(tx, row.order_id, []) : null;
  const locale = props?.locale ?? toLocale(row.locale);
  const brand = props?.brand ?? {
    store_name: b.store_name,
    logo_url: null,
    brand_color: null,
    contact_email: b.contact_email,
  };
  const { view, attachment } = bookingEmail(b, locale);
  const email =
    kind === 'rescheduled'
      ? await renderBookingNotice({ kind, brand, locale, booking: view })
      : await renderBookingNotice({
          kind,
          brand,
          locale,
          booking: view,
          refunded_amount: event.payload.refunded_amount ?? 0,
          currency: props?.order.currency ?? row.currency,
        });
  await deliver(
    deps,
    tx,
    event,
    row.order_id,
    row.email,
    `booking_${kind}`,
    email,
    kind === 'rescheduled' ? [attachment] : [],
  );
}

async function confirmation(
  deps: Deps,
  tx: TransactionSql,
  event: OutboxEvent,
  orderId: string,
  links: Awaited<ReturnType<typeof fulfillDigital>>,
) {
  const props = await loadOrderEmailProps(tx, orderId, links);
  if (!props) return;
  const { email: to, bookings, ...emailProps } = props;
  const email = await renderOrderConfirmation({
    ...emailProps,
    bookings: bookings.map((b) => b.view),
  });
  await deliver(
    deps,
    tx,
    event,
    orderId,
    to,
    'order_confirmation',
    email,
    bookings.map((b) => b.attachment),
  );
}

async function update(
  deps: Deps,
  tx: TransactionSql,
  event: OutboxEvent,
  orderId: string,
  kind: 'shipped' | 'refunded' | 'cancelled',
) {
  const props = await loadOrderEmailProps(tx, orderId, []);
  if (!props) return;
  const base = {
    brand: props.brand,
    locale: props.locale,
    order: { number: props.order.number, currency: props.order.currency },
  };
  let email: RenderedEmail;
  if (kind === 'shipped') {
    const [shipment] = await tx<
      { carrier: string | null; tracking_number: string | null; tracking_url: string | null }[]
    >`
      select s.carrier, s.tracking_number, s.tracking_url from sellbase.shipments s
        join sellbase.fulfillments f on f.id = s.fulfillment_id
       where f.order_id = ${orderId}
         and (${event.payload.fulfillment_id ?? null}::uuid is null or f.id = ${event.payload.fulfillment_id ?? null}::uuid)
       order by s.created_at desc limit 1`;
    email = await renderOrderUpdate({
      ...base,
      kind,
      carrier: shipment?.carrier ?? null,
      tracking_number: shipment?.tracking_number ?? null,
      tracking_url: shipment?.tracking_url ?? null,
    });
  } else if (kind === 'refunded') {
    email = await renderOrderUpdate({ ...base, kind, amount: event.payload.amount ?? 0 });
  } else {
    email = await renderOrderUpdate({
      ...base,
      kind,
      refunded_amount: event.payload.refunded_amount ?? 0,
    });
  }
  await deliver(deps, tx, event, orderId, props.email, `order_${kind}`, email);
}

async function deliver(
  deps: Deps,
  tx: TransactionSql,
  event: OutboxEvent,
  orderId: string | null,
  to: string,
  template: string,
  email: RenderedEmail,
  attachments: { filename: string; content_base64: string; content_type: string }[] = [],
) {
  const notify = await deps.notify(event.store_id);
  const [notification] = await tx<{ id: string }[]>`
    insert into sellbase.notifications (store_id, event_id, channel, "to", template)
    values (${event.store_id}, ${event.id}, 'email', ${to}, ${template}) returning id`;
  // Keyed by event: a retried job never sends twice, a new request (resend) always sends.
  const sent = await notify.send({
    to,
    ...email,
    ...(attachments.length ? { attachments } : {}),
    idempotency_key: `${template}-${event.id}`,
  });
  await tx`
    update sellbase.notifications set status = 'sent', provider_message_id = ${sent.provider_message_id}
     where id = ${notification?.id ?? null}`;
  if (orderId)
    await tx`
    insert into sellbase.order_events (store_id, order_id, type, message, data)
    values (${event.store_id}, ${orderId}, 'notification.sent', ${`Email sent: ${email.subject}`},
            ${tx.json({ to, template, provider: notify.id } as never)})`;
}
