import { routes, sellbaseError } from '@sellbase/core';
import { renderCartRecovery, toLocale } from '@sellbase/emails';
import type { Hono } from 'hono';
import { actorRef, type Actor } from '../auth.js';
import type { Deps } from '../deps.js';
import { notFound } from '../errors.js';
import { register, type AppOptions } from '../http.js';
import { decodeCursor, encodeCursor } from '../pagination.js';

/** Query parameter the storefront reads to restore a cart (web components and React). */
export const CART_PARAM = 'sellbase_cart';

interface SnapshotLine {
  title: string;
  variant_title?: string | null;
  quantity: number;
  image_url?: string | null;
  total_amount: number;
}

interface CheckoutRow {
  id: string;
  store_id: string;
  email: string | null;
  created_at: Date;
  amount_total: number;
  currency: string;
  lines_snapshot: SnapshotLine[];
  recovery_sent_at: Date | null;
  session_status: 'open' | 'completed' | 'expired';
  cart_token: string;
  cart_status: string;
  recovered_order: { id: string; number: number } | null;
}

/** Storefront link that reopens the cart, or null without settings.site_url. */
export function recoveryUrl(siteUrl: unknown, cartToken: string): string | null {
  if (typeof siteUrl !== 'string' || !siteUrl) return null;
  try {
    const url = new URL(siteUrl);
    url.searchParams.set(CART_PARAM, cartToken);
    return url.toString();
  } catch {
    return null;
  }
}

const statusOf = (row: CheckoutRow) =>
  row.recovered_order || row.cart_status === 'converted'
    ? ('recovered' as const)
    : row.session_status === 'open'
      ? ('in_progress' as const)
      : ('abandoned' as const);

/** Latest unpaid checkout per cart, with the order that later bought the cart (if any). */
function checkoutsQuery(deps: Deps, storeId: string, sessionId: string | null) {
  const { sql } = deps;
  return sql<CheckoutRow[]>`
    select distinct on (cs.cart_id)
           cs.id, cs.store_id, cs.email::text as email, cs.created_at, cs.amount_total,
           cs.currency::text as currency, cs.lines_snapshot, cs.recovery_sent_at,
           cs.status as session_status, c.token as cart_token, c.status as cart_status,
           (select jsonb_build_object('id', o.id, 'number', o.number)
              from sellbase.orders o join sellbase.checkout_sessions x on x.id = o.checkout_session_id
             where x.cart_id = cs.cart_id order by o.created_at limit 1) as recovered_order
      from sellbase.checkout_sessions cs join sellbase.carts c on c.id = cs.cart_id
     where cs.store_id = ${storeId} and cs.order_id is null and cs.email is not null
       ${sessionId ? sql`and cs.id = ${sessionId}` : sql``}
     order by cs.cart_id, cs.created_at desc`;
}

async function loadSiteUrl(deps: Deps, storeId: string) {
  const [row] = await deps.sql<{ site_url: string | null }[]>`
    select settings ->> 'site_url' as site_url from sellbase.stores where id = ${storeId}`;
  return row?.site_url ?? null;
}

/**
 * Emails the buyer a link that restores their cart. Used by the admin/agent route and by
 * the jobs (automatic, once per checkout). Throws a helpful error when it cannot be sent.
 */
export async function sendRecoveryEmail(
  deps: Deps,
  storeId: string,
  sessionId: string,
  options: { actor?: Actor | null; resend?: boolean; claimed?: boolean } = {},
) {
  const { sql } = deps;
  const [row] = await checkoutsQuery(deps, storeId, sessionId);
  if (!row)
    throw notFound(
      'Checkout',
      sessionId,
      'List abandoned checkouts with GET /checkouts/abandoned.',
    );
  if (statusOf(row) === 'recovered') {
    throw sellbaseError(
      'INVALID_TRANSITION',
      'This cart was already bought.',
      'Nothing to recover; open the order instead.',
      { order: row.recovered_order },
    );
  }
  if (row.cart_status !== 'open') {
    throw sellbaseError(
      'INVALID_TRANSITION',
      'This cart expired and cannot be restored.',
      'Carts are kept for 30 days; contact the buyer directly.',
    );
  }
  if (row.recovery_sent_at && !options.resend && !options.claimed) {
    throw sellbaseError(
      'INVALID_TRANSITION',
      'The recovery email was already sent for this checkout.',
      'Send resend: true to email the buyer again.',
      { sent_at: row.recovery_sent_at.toISOString() },
    );
  }
  const url = recoveryUrl(await loadSiteUrl(deps, storeId), row.cart_token);
  if (!url || !row.email) {
    throw sellbaseError(
      'VALIDATION_ERROR',
      'The store address is not set, so the email cannot link back to the cart.',
      'Set your storefront URL in Settings → Checkout (settings.site_url with PATCH /store).',
    );
  }
  const [store] = await sql<
    {
      name: string;
      logo_url: string | null;
      contact_email: string | null;
      default_locale: string;
      brand_color: string | null;
    }[]
  >`
    select name, logo_url, contact_email::text, default_locale, settings ->> 'brand_color' as brand_color
      from sellbase.stores where id = ${storeId}`;
  if (!store) throw notFound('Store', storeId, 'Run `sellbase init` to create the store.');

  const email = await renderCartRecovery({
    brand: {
      store_name: store.name,
      logo_url: store.logo_url,
      brand_color: store.brand_color,
      contact_email: store.contact_email,
    },
    locale: toLocale(store.default_locale),
    currency: row.currency,
    total_amount: row.amount_total,
    items: row.lines_snapshot.map((l) => ({
      title: l.title,
      variant_title: l.variant_title ?? null,
      quantity: l.quantity,
      image_url: l.image_url ?? null,
    })),
    url,
  });
  const notify = await deps.notify(storeId);
  const sentAt = deps.now();
  const sent = await notify.send({
    to: row.email,
    ...email,
    idempotency_key: `cart-recovery-${sessionId}${options.resend ? `-${sentAt.getTime()}` : ''}`,
  });
  await sql.begin(async (tx) => {
    await tx`update sellbase.checkout_sessions set recovery_sent_at = ${sentAt} where id = ${sessionId}`;
    await tx`
      insert into sellbase.notifications (store_id, channel, "to", template, status, provider_message_id)
      values (${storeId}, 'email', ${row.email}, 'cart_recovery', 'sent', ${sent.provider_message_id})`;
    if (!options.claimed) {
      const { actor_type, actor_id } = actorRef(options.actor ?? null);
      await tx`
        insert into sellbase.audit_log (store_id, actor_type, actor_id, action, entity, entity_id, diff)
        values (${storeId}, ${actor_type}, ${actor_id}, 'checkout.recovery_email', 'checkout', ${sessionId},
                ${tx.json({ to: row.email, resend: Boolean(options.resend) } as never)})`;
    }
  });
  return { sent_to: row.email, recovery_url: url, sent_at: sentAt.toISOString() };
}

/**
 * Automatic recovery emails (settings.abandoned_checkout.auto_email): once per cart, for
 * checkouts that expired more than delay_hours ago (default 2) and less than 7 days ago.
 * Each one is claimed with UPDATE … RETURNING so concurrent job runs never send twice.
 */
export async function sendCartRecoveries(deps: Deps, storeId?: string) {
  const { sql } = deps;
  const due = await sql<{ id: string; store_id: string }[]>`
    update sellbase.checkout_sessions cs set recovery_sent_at = now()
      from sellbase.stores s, sellbase.carts c
     where s.id = cs.store_id and c.id = cs.cart_id
       ${storeId ? sql`and cs.store_id = ${storeId}` : sql``}
       and coalesce((s.settings #>> '{abandoned_checkout,auto_email}')::boolean, false)
       and coalesce(s.settings ->> 'site_url', '') <> ''
       and cs.status = 'expired' and cs.order_id is null and cs.email is not null
       and cs.recovery_sent_at is null and c.status = 'open'
       and cs.created_at < now() - make_interval(hours => coalesce((s.settings #>> '{abandoned_checkout,delay_hours}')::int, 2))
       and cs.created_at > now() - interval '7 days'
       and cs.id = (select x.id from sellbase.checkout_sessions x where x.cart_id = cs.cart_id
                     order by x.created_at desc limit 1)
       and not exists (select 1 from sellbase.checkout_sessions x
                        where x.cart_id = cs.cart_id and x.recovery_sent_at is not null)
    returning cs.id, cs.store_id`;
  let sent = 0;
  for (const row of due) {
    try {
      await sendRecoveryEmail(deps, row.store_id, row.id, { claimed: true });
      sent += 1;
    } catch (error) {
      // Claimed rows are not retried: a buyer never gets this email twice.
      console.error('[sellbase-jobs] cart recovery failed', row.id, error);
    }
  }
  return sent;
}

export function registerCheckouts(app: Hono, deps: Deps, options: AppOptions) {
  register(app, deps, options, routes.abandonedCheckoutsList, async ({ storeId, query }) => {
    const after = decodeCursor(query.cursor);
    const siteUrl = await loadSiteUrl(deps, storeId);
    const all = (await checkoutsQuery(deps, storeId, null))
      .filter((r) => !query.status || statusOf(r) === query.status)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || (a.id < b.id ? 1 : -1))
      .filter(
        (r) =>
          !after ||
          r.created_at.getTime() < new Date(after.at).getTime() ||
          (r.created_at.getTime() === new Date(after.at).getTime() && r.id < after.id),
      );
    const page = all.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: page.map((r) => ({
        id: r.id,
        email: r.email,
        created_at: r.created_at.toISOString(),
        amount_total: r.amount_total,
        currency: r.currency,
        items: r.lines_snapshot.map((l) => ({
          title: l.title,
          variant_title: l.variant_title ?? null,
          quantity: l.quantity,
          image_url: l.image_url ?? null,
          total_amount: l.total_amount,
        })),
        status: statusOf(r),
        recovery_sent_at: r.recovery_sent_at?.toISOString() ?? null,
        recovery_url: r.cart_status === 'open' ? recoveryUrl(siteUrl, r.cart_token) : null,
        recovered_order: r.recovered_order,
      })),
      next_cursor: all.length > query.limit && last ? encodeCursor(last.created_at, last.id) : null,
    };
  });

  register(
    app,
    deps,
    options,
    routes.abandonedCheckoutRecover,
    ({ storeId, actor, params, body }) =>
      sendRecoveryEmail(deps, storeId, params.id, { actor, resend: body.resend }),
  );
}
