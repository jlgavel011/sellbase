import { isTimeZone, routes, sellbaseError } from '@sellbase/core';
import type { Hono } from 'hono';
import type { TransactionSql } from 'postgres';
import { actorRef, authorize, type Actor } from '../auth.js';
import type { Deps } from '../deps.js';
import { notFound } from '../errors.js';
import { refreshOrderStatus } from '../fulfillment.js';
import { register, type AppOptions } from '../http.js';
import { kickJobs } from '../jobs.js';
import {
  BOOKING_SELECT,
  loadBooking,
  loadResource,
  loadService,
  resolveBooking,
  slotsFor,
} from '../services.js';
import { refundOrder } from './order-actions.js';

const DAY = 86_400_000;

interface BookingRow {
  id: string;
  store_id: string;
  status: string;
  order_id: string | null;
  order_item_id: string | null;
  variant_id: string | null;
  starts_at: Date;
}

async function lockBooking(tx: TransactionSql, storeId: string, id: string) {
  const [b] = await tx<BookingRow[]>`
    select id, store_id, status, order_id, order_item_id, variant_id, starts_at from sellbase.bookings
     where id = ${id} and store_id = ${storeId} for update`;
  if (!b) throw notFound('Booking', id, 'List bookings with GET /bookings.');
  return b;
}

function assertConfirmed(b: BookingRow, action: string) {
  if (b.status !== 'confirmed') {
    throw sellbaseError(
      'INVALID_TRANSITION',
      `This booking is ${b.status}; only confirmed bookings can be ${action}.`,
      'Check the booking with GET /bookings.',
      { status: b.status },
    );
  }
}

async function log(
  tx: TransactionSql,
  b: BookingRow,
  actor: Actor | null,
  type: string,
  message: string,
  data: object = {},
) {
  const { actor_type, actor_id } = actorRef(actor);
  if (b.order_id) {
    await tx`
      insert into sellbase.order_events (store_id, order_id, type, message, data, actor_type, actor_id)
      values (${b.store_id}, ${b.order_id}, ${type}, ${message}, ${tx.json({ booking_id: b.id, ...data } as never)}, ${actor_type}, ${actor_id})`;
  }
  await tx`
    insert into sellbase.audit_log (store_id, actor_type, actor_id, action, entity, entity_id, diff)
    values (${b.store_id}, ${actor_type}, ${actor_id}, ${type}, 'booking', ${b.id}, ${tx.json(data as never)})`;
}

/** Closes the booking's order line (done, no-show or cancelled) and updates the order. */
async function closeLine(tx: TransactionSql, b: BookingRow) {
  if (!b.order_item_id || !b.order_id) return;
  await tx`update sellbase.order_items set fulfilled_quantity = least(quantity, fulfilled_quantity + 1) where id = ${b.order_item_id}`;
  const [open] =
    await tx`select 1 from sellbase.bookings where order_id = ${b.order_id} and status = 'confirmed' limit 1`;
  if (!open)
    await tx`update sellbase.fulfillments set status = 'fulfilled' where order_id = ${b.order_id} and type = 'booking'`;
  const [order] = await tx<
    { status: string }[]
  >`select status from sellbase.orders where id = ${b.order_id}`;
  if (order?.status === 'open') await refreshOrderStatus(tx, b.order_id);
}

export function registerBookings(app: Hono, deps: Deps, options: AppOptions) {
  const { sql } = deps;

  // ── Public availability ──────────────────────────────────────────────────
  register(app, deps, options, routes.availabilityGet, async ({ storeId, query }) => {
    const service = await loadService(sql, storeId, query.variant_id);
    if (!service) {
      throw sellbaseError(
        'VALIDATION_ERROR',
        'This variant is not a service.',
        'Use the variant id of a service product (type "service").',
      );
    }
    const now = deps.now();
    const from = query.from ? new Date(query.from) : now;
    const to = query.to ? new Date(query.to) : new Date(from.getTime() + 14 * DAY);
    if (to <= from || to.getTime() - from.getTime() > 62 * DAY) {
      throw sellbaseError(
        'VALIDATION_ERROR',
        'The range must be positive and at most 62 days.',
        'Request availability one month at a time.',
      );
    }
    const { resources, slots } = await slotsFor(sql, service, from, to, now);
    return {
      timezone: service.timezone,
      resources: resources.map(({ id, name }) => ({ id, name })),
      slots: slots.map((s) => ({
        starts_at: s.starts_at.toISOString(),
        ends_at: s.ends_at.toISOString(),
        resource_ids: s.resource_ids,
        remaining: s.remaining,
      })),
    };
  });

  // ── Resources ────────────────────────────────────────────────────────────
  register(app, deps, options, routes.resourcesList, async ({ storeId }) => {
    const rows = await sql<
      { id: string }[]
    >`select id from sellbase.resources where store_id = ${storeId} order by active desc, name`;
    return { data: await Promise.all(rows.map((r) => loadResource(sql, storeId, r.id))) };
  });

  register(app, deps, options, routes.resourceUpsert, async ({ storeId, actor, body }) => {
    const [tz] = await sql<
      { timezone: string }[]
    >`select timezone from sellbase.stores where id = ${storeId}`;
    const timezone = body.timezone ?? tz?.timezone ?? 'America/Mexico_City';
    if (!isTimeZone(timezone)) {
      throw sellbaseError(
        'VALIDATION_ERROR',
        `Unknown time zone "${timezone}".`,
        'Use an IANA time zone such as America/Mexico_City.',
      );
    }
    for (const rule of body.rules ?? []) {
      if (rule.end_time <= rule.start_time) {
        throw sellbaseError(
          'VALIDATION_ERROR',
          `Hours ${rule.start_time}–${rule.end_time} end before they start.`,
          'Overnight hours are not supported; split them into two days.',
        );
      }
    }
    const id = await sql.begin(async (tx) => {
      let resourceId = body.id;
      if (resourceId) {
        const updated = await tx`
          update sellbase.resources set name = ${body.name}, kind = ${body.kind}, timezone = ${timezone},
                 email = ${body.email === undefined ? tx`email` : tx`${body.email}`},
                 active = ${body.active ?? true}
           where id = ${resourceId} and store_id = ${storeId} returning id`;
        if (updated.length === 0)
          throw notFound('Resource', resourceId, 'Omit id to create a new resource.');
      } else {
        const [created] = await tx<{ id: string }[]>`
          insert into sellbase.resources (store_id, name, kind, timezone, email, active)
          values (${storeId}, ${body.name}, ${body.kind}, ${timezone}, ${body.email ?? null}, ${body.active ?? true}) returning id`;
        resourceId = created?.id ?? '';
      }
      if (body.rules) {
        await tx`delete from sellbase.availability_rules where resource_id = ${resourceId}`;
        for (const rule of body.rules) {
          await tx`
            insert into sellbase.availability_rules (store_id, resource_id, weekday, start_time, end_time)
            values (${storeId}, ${resourceId}, ${rule.weekday}, ${rule.start_time}::time, ${rule.end_time}::time)`;
        }
      }
      if (body.product_ids) {
        const services = await tx<{ id: string }[]>`
          select id from sellbase.products where store_id = ${storeId} and type = 'service' and id = any(${tx.array(body.product_ids)}::uuid[])`;
        if (services.length !== new Set(body.product_ids).size) {
          throw sellbaseError(
            'VALIDATION_ERROR',
            'Some product_ids are not service products of this store.',
            'Only products with type "service" can be assigned to resources.',
          );
        }
        await tx`delete from sellbase.service_resources where resource_id = ${resourceId}`;
        for (const p of services) {
          await tx`insert into sellbase.service_resources (store_id, product_id, resource_id) values (${storeId}, ${p.id}, ${resourceId})`;
        }
      }
      const { actor_type, actor_id } = actorRef(actor);
      await tx`
        insert into sellbase.audit_log (store_id, actor_type, actor_id, action, entity, entity_id, diff)
        values (${storeId}, ${actor_type}, ${actor_id}, ${body.id ? 'resource.update' : 'resource.create'}, 'resource', ${resourceId}, ${tx.json(body as never)})`;
      return resourceId;
    });
    return loadResource(sql, storeId, id);
  });

  register(app, deps, options, routes.resourceExceptionAdd, async ({ storeId, params, body }) => {
    await loadResource(sql, storeId, params.id);
    if (new Date(body.ends_at) <= new Date(body.starts_at)) {
      throw sellbaseError(
        'VALIDATION_ERROR',
        'ends_at must be after starts_at.',
        'Send a positive time range.',
      );
    }
    await sql`
      insert into sellbase.availability_exceptions (store_id, resource_id, starts_at, ends_at, kind, note)
      values (${storeId}, ${params.id}, ${body.starts_at}, ${body.ends_at}, ${body.kind}, ${body.note ?? null})`;
    return loadResource(sql, storeId, params.id);
  });

  register(app, deps, options, routes.resourceExceptionRemove, async ({ storeId, params }) => {
    await sql`delete from sellbase.availability_exceptions where id = ${params.exception_id} and resource_id = ${params.id} and store_id = ${storeId}`;
    return loadResource(sql, storeId, params.id);
  });

  // ── Agenda ───────────────────────────────────────────────────────────────
  register(app, deps, options, routes.bookingsList, async ({ storeId, query }) => {
    const from = query.from ? new Date(query.from) : new Date(deps.now().getTime() - DAY);
    const to = query.to ? new Date(query.to) : new Date(from.getTime() + 14 * DAY);
    const data = await sql`
      select ${sql.unsafe(BOOKING_SELECT)}
        from sellbase.bookings b
        join sellbase.resources r on r.id = b.resource_id
        left join sellbase.products p on p.id = b.product_id
        left join sellbase.orders o on o.id = b.order_id
       where b.store_id = ${storeId} and b.starts_at >= ${from} and b.starts_at < ${to}
         and b.status not in ('held', 'expired')
         ${query.status ? sql`and b.status = ${query.status}` : sql``}
         ${query.resource_id ? sql`and b.resource_id = ${query.resource_id}` : sql``}
       order by b.starts_at, r.name limit ${query.limit}`;
    return { data } as never;
  });

  const close =
    (status: 'completed' | 'no_show') =>
    async ({
      storeId,
      actor,
      params,
    }: {
      storeId: string;
      actor: Actor | null;
      params: { id: string };
    }) => {
      await sql.begin(async (tx) => {
        const b = await lockBooking(tx, storeId, params.id);
        assertConfirmed(b, status === 'completed' ? 'completed' : 'marked as no-show');
        await tx`update sellbase.bookings set status = ${status} where id = ${b.id}`;
        await closeLine(tx, b);
        await log(
          tx,
          b,
          actor,
          `booking.${status}`,
          status === 'completed' ? 'Appointment completed.' : 'Customer did not show up.',
        );
        await tx`select sellbase.emit_event(${storeId}, ${`booking.${status}`}, 'booking', ${b.id})`;
      });
      return loadBooking(sql, storeId, params.id);
    };
  register(app, deps, options, routes.bookingComplete, close('completed'));
  register(app, deps, options, routes.bookingNoShow, close('no_show'));

  register(app, deps, options, routes.bookingCancel, async ({ storeId, actor, params, body }) => {
    const [pre] = await sql<(BookingRow & { line_total: number | null })[]>`
      select b.id, b.status, b.order_id, oi.total_amount as line_total
        from sellbase.bookings b left join sellbase.order_items oi on oi.id = b.order_item_id
       where b.id = ${params.id} and b.store_id = ${storeId}`;
    if (!pre) throw notFound('Booking', params.id, 'List bookings with GET /bookings.');
    assertConfirmed(pre, 'cancelled');
    let refunded = 0;
    if (body.refund && pre.order_id && pre.line_total) {
      authorize(actor, { kind: 'staff', scope: 'refunds:write' });
      const [order] = await sql<
        { refundable: number }[]
      >`select amount_paid - amount_refunded as refundable from sellbase.orders where id = ${pre.order_id}`;
      const amount = Math.min(pre.line_total, order?.refundable ?? 0);
      if (amount > 0)
        refunded = await refundOrder(
          deps,
          storeId,
          pre.order_id,
          actor,
          amount,
          `Appointment cancelled: ${body.reason}`,
          false,
        );
    }
    await sql.begin(async (tx) => {
      const b = await lockBooking(tx, storeId, params.id);
      assertConfirmed(b, 'cancelled');
      await tx`update sellbase.bookings set status = 'cancelled', notes = ${body.reason} where id = ${b.id}`;
      await closeLine(tx, b);
      await log(tx, b, actor, 'booking.cancelled', `Appointment cancelled: ${body.reason}`, {
        reason: body.reason,
        refunded,
      });
      await tx`select sellbase.emit_event(${storeId}, 'booking.cancelled', 'booking', ${b.id}, ${tx.json({ notify: body.notify_customer, refunded_amount: refunded, reason: body.reason } as never)})`;
    });
    kickJobs(deps);
    return loadBooking(sql, storeId, params.id);
  });

  register(
    app,
    deps,
    options,
    routes.bookingReschedule,
    async ({ storeId, actor, params, body }) => {
      const [current] = await sql<(BookingRow & { email: string | null })[]>`
      select id, store_id, status, order_id, order_item_id, variant_id, starts_at, email::text from sellbase.bookings
       where id = ${params.id} and store_id = ${storeId}`;
      if (!current) throw notFound('Booking', params.id, 'List bookings with GET /bookings.');
      assertConfirmed(current, 'rescheduled');
      const service = current.variant_id
        ? await loadService(sql, storeId, current.variant_id)
        : null;
      if (!service)
        throw sellbaseError(
          'VALIDATION_ERROR',
          'The service of this booking no longer exists.',
          'Cancel it and book again.',
        );
      // Staff may move bookings inside the notice period, so notice is not enforced here.
      const target = await resolveBooking(
        sql,
        { ...service, min_notice_min: 0 },
        new Date(body.starts_at),
        deps.now(),
        body.resource_id,
        current.id,
      );

      const newId = await sql.begin(async (tx) => {
        const b = await lockBooking(tx, storeId, params.id);
        assertConfirmed(b, 'rescheduled');
        await tx`update sellbase.bookings set status = 'rescheduled' where id = ${b.id}`;
        for (let seat = 1; seat <= service.capacity; seat++) {
          try {
            const [created] = await tx.savepoint(
              (sp) => sp<{ id: string }[]>`
              insert into sellbase.bookings
                (store_id, product_id, variant_id, resource_id, seat, status, starts_at, ends_at, occupied, order_id,
                 order_item_id, fulfillment_id, customer_id, email, meeting_url, rescheduled_from)
              select store_id, product_id, variant_id, ${target.resource_id}, ${seat}, 'confirmed', ${target.starts_at}, ${target.ends_at},
                     tstzrange(${target.occupied_start}, ${target.occupied_end}), order_id, order_item_id, fulfillment_id,
                     customer_id, email, meeting_url, id
                from sellbase.bookings where id = ${b.id}
              returning id`,
            );
            await log(
              tx,
              b,
              actor,
              'booking.rescheduled',
              `Appointment moved to ${target.starts_at.toISOString()}.`,
              { new_booking_id: created?.id, starts_at: target.starts_at.toISOString() },
            );
            await tx`select sellbase.emit_event(${storeId}, 'booking.rescheduled', 'booking', ${created?.id ?? null}, ${tx.json({ notify: body.notify_customer, previous_id: b.id } as never)})`;
            return created?.id ?? '';
          } catch (error) {
            if ((error as { code?: string }).code !== '23P01') throw error;
          }
        }
        throw sellbaseError(
          'SLOT_UNAVAILABLE',
          'That time was just taken.',
          'Pick another time from GET /storefront/availability.',
        );
      });
      kickJobs(deps);
      return loadBooking(sql, storeId, newId);
    },
  );
}
