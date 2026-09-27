import {
  computeSlots,
  occupiedRange,
  sellbaseError,
  type ResourceSchedule,
  type ServiceTiming,
  type Slot,
} from '@sellbase/core';
import type { Sql, TransactionSql } from 'postgres';
import { notFound } from './errors.js';

type Db = Sql | TransactionSql;

export interface ServiceInfo extends ServiceTiming {
  variant_id: string;
  product_id: string;
  title: string;
  deposit_amount: number | null;
  location_type: 'in_person' | 'online';
  online_meeting_url: string | null;
  timezone: string;
}

/** Service specs of a variant, or null if the variant is not a service. */
export async function loadService(
  sql: Db,
  storeId: string,
  variantId: string,
): Promise<ServiceInfo | null> {
  const [row] = await sql<ServiceInfo[]>`
    select v.id as variant_id, p.id as product_id, p.title, s.duration_min, s.buffer_before_min, s.buffer_after_min,
           s.capacity, s.min_notice_min, s.booking_window_days, s.slot_interval_min, s.deposit_amount,
           s.location_type, s.online_meeting_url, st.timezone
      from sellbase.variants v
      join sellbase.products p on p.id = v.product_id
      join sellbase.service_specs s on s.variant_id = v.id
      join sellbase.stores st on st.id = v.store_id
     where v.id = ${variantId} and v.store_id = ${storeId}`;
  return row ?? null;
}

/**
 * Weekly hours, exceptions and active bookings of every resource that delivers the
 * service. `excludeBookingId` ignores one booking (used when rescheduling it).
 */
export async function loadSchedules(
  sql: Db,
  service: ServiceInfo,
  from: Date,
  to: Date,
  excludeBookingId?: string,
) {
  const resources = await sql<{ id: string; name: string; timezone: string }[]>`
    select r.id, r.name, r.timezone from sellbase.resources r
      join sellbase.service_resources sr on sr.resource_id = r.id
     where sr.product_id = ${service.product_id} and r.active
     order by r.name`;
  const ids = resources.map((r) => r.id);
  if (ids.length === 0) return { resources, schedules: [] as ResourceSchedule[] };
  const pad = 24 * 3_600_000;
  const [rules, exceptions, busy] = await Promise.all([
    sql<
      {
        resource_id: string;
        weekday: number;
        start_time: string;
        end_time: string;
        timezone: string | null;
      }[]
    >`
      select resource_id, weekday, to_char(start_time, 'HH24:MI') as start_time,
             case when end_time = '24:00'::time then '24:00' else to_char(end_time, 'HH24:MI') end as end_time, timezone
        from sellbase.availability_rules where resource_id = any(${sql.array(ids)}::uuid[])`,
    sql<{ resource_id: string; starts_at: Date; ends_at: Date; kind: 'closed' | 'open' }[]>`
      select resource_id, starts_at, ends_at, kind from sellbase.availability_exceptions
       where resource_id = any(${sql.array(ids)}::uuid[])
         and ends_at > ${new Date(from.getTime() - pad)} and starts_at < ${new Date(to.getTime() + pad)}`,
    sql<{ resource_id: string; starts_at: Date; ends_at: Date }[]>`
      select resource_id, lower(occupied) as starts_at, upper(occupied) as ends_at from sellbase.bookings
       where resource_id = any(${sql.array(ids)}::uuid[])
         and (status = 'confirmed' or (status = 'held' and expires_at > now()))
         and ${excludeBookingId ?? null}::uuid is distinct from id
         and occupied && tstzrange(${new Date(from.getTime() - pad)}, ${new Date(to.getTime() + pad)})`,
  ]);
  const schedules: ResourceSchedule[] = resources.map((r) => ({
    id: r.id,
    timezone: r.timezone,
    rules: rules.filter((x) => x.resource_id === r.id),
    exceptions: exceptions.filter((x) => x.resource_id === r.id),
    busy: busy.filter((x) => x.resource_id === r.id),
  }));
  return { resources, schedules };
}

export async function slotsFor(
  sql: Db,
  service: ServiceInfo,
  from: Date,
  to: Date,
  now: Date,
  excludeBookingId?: string,
) {
  const { resources, schedules } = await loadSchedules(sql, service, from, to, excludeBookingId);
  return { resources, slots: computeSlots({ now, from, to, service, resources: schedules }) };
}

/**
 * Resolves a requested start time into a concrete booking for checkout: the resource
 * (requested or least busy) and the occupied range. Fails with SLOT_UNAVAILABLE.
 */
export async function resolveBooking(
  sql: Db,
  service: ServiceInfo,
  startsAt: Date,
  now: Date,
  resourceId?: string | null,
  excludeBookingId?: string,
) {
  const { resources, slots } = await slotsFor(
    sql,
    service,
    new Date(startsAt.getTime() - 1),
    new Date(startsAt.getTime() + 1),
    now,
    excludeBookingId,
  );
  const slot: Slot | undefined = slots.find((s) => s.starts_at.getTime() === startsAt.getTime());
  const chosen = resourceId
    ? slot?.resource_ids.find((id) => id === resourceId)
    : slot?.resource_ids[0];
  if (!slot || !chosen) {
    throw sellbaseError(
      'SLOT_UNAVAILABLE',
      `${service.title} is not available at ${startsAt.toISOString()}.`,
      `Pick a time from GET /storefront/availability?variant_id=${service.variant_id}.`,
      {
        variant_id: service.variant_id,
        starts_at: startsAt.toISOString(),
        resource_id: resourceId ?? null,
      },
    );
  }
  const occupied = occupiedRange(startsAt, service);
  return {
    resource_id: chosen,
    resource_name: resources.find((r) => r.id === chosen)?.name ?? null,
    starts_at: startsAt,
    ends_at: slot.ends_at,
    occupied_start: occupied.starts_at,
    occupied_end: occupied.ends_at,
  };
}

export async function loadResource(sql: Db, storeId: string, id: string) {
  const [resource] = await sql`
    select id, name, kind, timezone, email::text as email, active from sellbase.resources where id = ${id} and store_id = ${storeId}`;
  if (!resource) throw notFound('Resource', id, 'List resources with GET /resources.');
  const rules = await sql`
    select weekday, to_char(start_time, 'HH24:MI') as start_time,
           case when end_time = '24:00'::time then '24:00' else to_char(end_time, 'HH24:MI') end as end_time
      from sellbase.availability_rules where resource_id = ${id} order by weekday, start_time`;
  const exceptions = await sql`
    select id, starts_at, ends_at, kind, note from sellbase.availability_exceptions
     where resource_id = ${id} and ends_at > now() - interval '30 days' order by starts_at`;
  const products = await sql<
    { product_id: string }[]
  >`select product_id from sellbase.service_resources where resource_id = ${id}`;
  return {
    ...resource,
    rules,
    exceptions,
    product_ids: products.map((p) => p.product_id),
  } as never;
}

export const BOOKING_SELECT = `
  b.id, b.status, b.starts_at, b.ends_at, r.timezone, jsonb_build_object('id', r.id, 'name', r.name) as resource,
  case when p.id is null then null else jsonb_build_object('id', p.id, 'title', p.title) end as product,
  case when o.id is null then null else jsonb_build_object('id', o.id, 'number', o.number) end as "order",
  b.email::text as email, b.meeting_url, b.rescheduled_from, b.notes`;

export async function loadBooking(sql: Db, storeId: string, id: string) {
  const [booking] = await sql`
    select ${sql.unsafe(BOOKING_SELECT)}
      from sellbase.bookings b
      join sellbase.resources r on r.id = b.resource_id
      left join sellbase.products p on p.id = b.product_id
      left join sellbase.orders o on o.id = b.order_id
     where b.id = ${id} and b.store_id = ${storeId}`;
  if (!booking) throw notFound('Booking', id, 'List bookings with GET /bookings.');
  return booking as never;
}

/**
 * Adds the resolved booking (resource + occupied range) to each service line of a
 * checkout snapshot. `slots` gives the requested start per line; missing ones fail.
 */
export async function withBookings(
  sql: Db,
  storeId: string,
  lines: readonly { variant_id: string; title: string; fulfillment_type: string }[],
  requested: readonly ({ starts_at: string; resource_id?: string } | null | undefined)[],
  now: Date,
) {
  const out: Record<string, unknown>[] = [];
  for (const [i, line] of lines.entries()) {
    const slot = requested[i];
    if (line.fulfillment_type !== 'booking') {
      out.push({ ...line });
      continue;
    }
    if (!slot)
      throw sellbaseError(
        'VALIDATION_ERROR',
        `"${line.title}" needs a time.`,
        'Remove it and add it again with booking_slot.',
      );
    const service = await loadService(sql, storeId, line.variant_id);
    if (!service)
      throw sellbaseError(
        'NOT_FOUND',
        `"${line.title}" is no longer bookable.`,
        'Remove it from the cart.',
      );
    const b = await resolveBooking(sql, service, new Date(slot.starts_at), now, slot.resource_id);
    out.push({
      ...line,
      booking: {
        resource_id: b.resource_id,
        starts_at: b.starts_at.toISOString(),
        ends_at: b.ends_at.toISOString(),
        occupied_start: b.occupied_start.toISOString(),
        occupied_end: b.occupied_end.toISOString(),
      },
    });
  }
  return { snapshot: out, hasBookings: out.some((l) => 'booking' in l) };
}
