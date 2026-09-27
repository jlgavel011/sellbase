import { DEFAULT_AGENT_SCOPES } from '@sellbase/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runJobs } from '../src/index.js';
import { createTestStore, sendWebhook, sql, type TestStore } from './helpers.js';

/** Monday 06:00 UTC (00:00 in Mexico City) at least a week ahead, so notice rules never bite. */
function nextMonday(weeksAhead = 1) {
  const d = new Date();
  d.setUTCHours(6, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7) + 7 * (weeksAhead - 1));
  return d;
}
/** `hourLocal` o'clock in Mexico City on the day of `base` (base is 00:00 local). */
const at = (base: Date, hourLocal: number) =>
  new Date(base.getTime() + hourLocal * 3_600_000).toISOString();

let s: TestStore;
let token: string;
let ana: string;
let variant: string;
let monday: Date;

async function book(startsAt: string, email = 'cliente@test.dev') {
  const cart = await s.request('POST', '/storefront/carts', { body: {} });
  const add = await s.request('POST', `/storefront/carts/${cart.body.token}/items`, {
    body: { variant_id: variant, booking_slot: { starts_at: startsAt } },
  });
  if (add.status !== 200) return { add };
  const checkout = await s.request('POST', '/storefront/checkout', {
    body: {
      cart_token: cart.body.token,
      email,
      success_url: 'https://spa.test/ok',
      cancel_url: 'https://spa.test/no',
    },
  });
  return { add, checkout, cartToken: cart.body.token as string };
}

async function pay(sessionId: string) {
  const eventId = `evt_${crypto.randomUUID()}`;
  const amount = s.payments.created.at(-1)?.amount_total ?? 0;
  await sendWebhook(s, {
    id: eventId,
    data: {
      type: 'checkout.paid',
      provider_event_id: eventId,
      checkout_session_id: sessionId,
      provider_payment_id: `pi_${crypto.randomUUID()}`,
      method: 'card',
      amount,
      currency: 'MXN',
      raw: {},
    },
  });
  await runJobs(s.deps, { storeId: s.storeId });
}

beforeAll(async () => {
  s = await createTestStore();
  token = await s.token([...DEFAULT_AGENT_SCOPES, 'refunds:write']);
  monday = nextMonday();
  const product = await s.request('POST', '/products', {
    token,
    body: {
      type: 'service',
      title: 'Masaje relajante',
      status: 'active',
      variants: [
        {
          price_amount: 80000,
          service: { duration_min: 60, location_type: 'in_person', min_notice_min: 0 },
        },
      ],
    },
  });
  expect(product.status, JSON.stringify(product.body)).toBe(200);
  variant = product.body.variants[0].id;
  const resource = await s.request('POST', '/resources', {
    token,
    body: {
      name: 'Ana',
      timezone: 'America/Mexico_City',
      rules: [1, 2, 3, 4, 5].map((weekday) => ({
        weekday,
        start_time: '09:00',
        end_time: '18:00',
      })),
      product_ids: [product.body.id],
    },
  });
  expect(resource.status, JSON.stringify(resource.body)).toBe(200);
  ana = resource.body.id;
});

afterAll(async () => {
  await sql.end();
});

describe('services setup', () => {
  it('stores service specs and resources on the product', async () => {
    const product = await s.request('GET', `/products?type=service`, { token });
    expect(product.body.data[0].variants[0].service).toMatchObject({
      duration_min: 60,
      capacity: 1,
    });
    expect(product.body.data[0].resource_ids).toEqual([ana]);
  });

  it('refuses unknown resources and bad hours', async () => {
    const bad = await s.request('POST', '/products', {
      token,
      body: {
        type: 'service',
        title: 'X',
        variants: [{ price_amount: 1, service: { duration_min: 30, location_type: 'online' } }],
        resource_ids: [crypto.randomUUID()],
      },
    });
    expect(bad.status).toBe(400);
    const hours = await s.request('POST', '/resources', {
      token,
      body: { name: 'Z', rules: [{ weekday: 1, start_time: '18:00', end_time: '09:00' }] },
    });
    expect(hours.status).toBe(400);
    expect(hours.body.error.hint).toContain('Overnight');
  });
});

describe('availability and booking', () => {
  it('lists free times in the store time zone', async () => {
    const res = await s.request(
      'GET',
      `/storefront/availability?variant_id=${variant}&from=${monday.toISOString()}&to=${at(monday, 24)}`,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.timezone).toBe('America/Mexico_City');
    expect(res.body.slots.map((x: { starts_at: string }) => x.starts_at)).toEqual(
      [9, 10, 11, 12, 13, 14, 15, 16, 17].map((h) => at(monday, h)),
    );
    expect(res.body.resources).toEqual([{ id: ana, name: 'Ana' }]);
  });

  it('requires a valid time in the cart', async () => {
    const cart = await s.request('POST', '/storefront/carts', { body: {} });
    const none = await s.request('POST', `/storefront/carts/${cart.body.token}/items`, {
      body: { variant_id: variant },
    });
    expect(none.status).toBe(400);
    expect(none.body.error.hint).toContain('/storefront/availability');
    const offGrid = await s.request('POST', `/storefront/carts/${cart.body.token}/items`, {
      body: { variant_id: variant, booking_slot: { starts_at: at(monday, 9.5) } },
    });
    expect(offGrid.status).toBe(409);
    expect(offGrid.body.error.code).toBe('SLOT_UNAVAILABLE');
  });

  it('holds the slot at checkout, so a second buyer cannot take it', async () => {
    const first = await book(at(monday, 9));
    expect(first.checkout?.status, JSON.stringify(first.checkout?.body)).toBe(200);
    expect(first.add.body.items[0].booking).toMatchObject({
      starts_at: at(monday, 9),
      timezone: 'America/Mexico_City',
    });
    const second = await book(at(monday, 9), 'otro@test.dev');
    expect(second.add.status).toBe(409);
    const free = await s.request(
      'GET',
      `/storefront/availability?variant_id=${variant}&from=${monday.toISOString()}&to=${at(monday, 24)}`,
    );
    expect(free.body.slots.map((x: { starts_at: string }) => x.starts_at)).not.toContain(
      at(monday, 9),
    );

    await pay(first.checkout?.body.checkout_session_id);
    const [booking] = await sql<{ status: string; email: string }[]>`
      select status, email::text from sellbase.bookings where checkout_session_id = ${first.checkout?.body.checkout_session_id}`;
    expect(booking).toMatchObject({ status: 'confirmed', email: 'cliente@test.dev' });

    const email = s.emails.find(
      (m) => m.to === 'cliente@test.dev' && m.subject.includes('confirmado'),
    );
    expect(email?.html).toContain('Tu cita');
    expect(email?.attachments?.[0]).toMatchObject({ filename: 'cita.ics' });
    expect(
      Buffer.from(email?.attachments?.[0]?.content_base64 ?? '', 'base64').toString(),
    ).toContain(`DTSTART:${at(monday, 9).replace(/[-:]/g, '').replace('.000', '')}`);
  });
});

describe('agenda actions', () => {
  it('lists, completes and closes the order', async () => {
    const list = await s.request(
      'GET',
      `/bookings?from=${monday.toISOString()}&to=${at(monday, 24)}`,
      { token },
    );
    const booking = list.body.data.find(
      (b: { starts_at: string }) => b.starts_at === at(monday, 9),
    );
    expect(booking).toMatchObject({
      status: 'confirmed',
      resource: { name: 'Ana' },
      product: { title: 'Masaje relajante' },
    });
    const done = await s.request('POST', `/bookings/${booking.id}/complete`, { token });
    expect(done.body.status).toBe('completed');
    const order = await s.request('GET', `/orders/${booking.order.id}`, { token });
    expect(order.body).toMatchObject({ status: 'completed', fulfillment_status: 'fulfilled' });
    const again = await s.request('POST', `/bookings/${booking.id}/complete`, { token });
    expect(again.status).toBe(409);
  });

  it('reschedules to a free time and emails the new time', async () => {
    const { checkout } = await book(at(monday, 10));
    await pay(checkout?.body.checkout_session_id);
    const [b] = await sql<
      { id: string }[]
    >`select id from sellbase.bookings where checkout_session_id = ${checkout?.body.checkout_session_id}`;
    const other = await book(at(monday, 14), 'otra@test.dev');
    await pay(other.checkout?.body.checkout_session_id);
    const taken = await s.request('POST', `/bookings/${b?.id}/reschedule`, {
      token,
      body: { starts_at: at(monday, 14) },
    });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('SLOT_UNAVAILABLE');
    const moved = await s.request('POST', `/bookings/${b?.id}/reschedule`, {
      token,
      body: { starts_at: at(monday, 15) },
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body).toMatchObject({
      status: 'confirmed',
      starts_at: at(monday, 15),
      rescheduled_from: b?.id,
    });
    const old = await s.request(
      'GET',
      `/bookings?from=${monday.toISOString()}&to=${at(monday, 24)}&status=rescheduled`,
      { token },
    );
    expect(old.body.data.map((x: { id: string }) => x.id)).toContain(b?.id);
    await runJobs(s.deps, { storeId: s.storeId });
    const email = s.emails.find((m) => m.subject.includes('cambió de horario'));
    expect(email?.attachments?.[0]?.filename).toBe('cita.ics');
  });

  it('cancels with a refund of the booked line', async () => {
    const { checkout } = await book(at(monday, 11));
    await pay(checkout?.body.checkout_session_id);
    const [b] = await sql<
      { id: string; order_id: string }[]
    >`select id, order_id from sellbase.bookings where checkout_session_id = ${checkout?.body.checkout_session_id}`;
    const res = await s.request('POST', `/bookings/${b?.id}/cancel`, {
      token,
      body: { reason: 'Enfermedad', refund: true, confirm: true },
    });
    expect(res.body.status).toBe('cancelled');
    const order = await s.request('GET', `/orders/${b?.order_id}`, { token });
    expect(order.body.amount_refunded).toBe(80000);
    await runJobs(s.deps, { storeId: s.storeId });
    expect(
      s.emails.some((m) => m.subject.includes('fue cancelada') && m.text.includes('$800.00')),
    ).toBe(true);
    const free = await s.request(
      'GET',
      `/storefront/availability?variant_id=${variant}&from=${monday.toISOString()}&to=${at(monday, 24)}`,
    );
    expect(free.body.slots.map((x: { starts_at: string }) => x.starts_at)).toContain(
      at(monday, 11),
    );
  });

  it('marks no-shows', async () => {
    const { checkout } = await book(at(monday, 12));
    await pay(checkout?.body.checkout_session_id);
    const [b] = await sql<
      { id: string }[]
    >`select id from sellbase.bookings where checkout_session_id = ${checkout?.body.checkout_session_id}`;
    const res = await s.request('POST', `/bookings/${b?.id}/no-show`, { token });
    expect(res.body.status).toBe('no_show');
  });
});

describe('reminders', () => {
  it('sends the 2 h reminder once, and skips the 24 h one for late bookings', async () => {
    const startsAt = new Date(Date.now() + 90 * 60_000);
    const rows = await sql<{ id: string }[]>`
      insert into sellbase.bookings (store_id, product_id, variant_id, resource_id, status, starts_at, ends_at, occupied, email, created_at)
      select ${s.storeId}, v.product_id, v.id, ${ana}, 'confirmed', ${startsAt}, ${new Date(startsAt.getTime() + 3_600_000)},
             tstzrange(${startsAt}, ${new Date(startsAt.getTime() + 3_600_000)}), 'recordatorio@test.dev', now() - interval '3 days'
        from sellbase.variants v where v.id = ${variant} returning id`;
    const bookingId = rows[0]?.id ?? '';
    await runJobs(s.deps, { storeId: s.storeId });
    await runJobs(s.deps, { storeId: s.storeId });
    const reminders = s.emails.filter((m) => m.to === 'recordatorio@test.dev');
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.subject).toContain('Recordatorio: Masaje relajante');
    const [flags] = await sql<{ r24: boolean; r2: boolean }[]>`
      select reminder_24h_sent_at is not null as r24, reminder_2h_sent_at is not null as r2 from sellbase.bookings where id = ${bookingId}`;
    expect(flags).toEqual({ r24: false, r2: true });
  });
});

describe('exceptions and test purchase', () => {
  it('closed exceptions remove the day', async () => {
    const nextWeek = nextMonday(2);
    const res = await s.request('POST', `/resources/${ana}/exceptions`, {
      token,
      body: {
        starts_at: nextWeek.toISOString(),
        ends_at: at(nextWeek, 24),
        kind: 'closed',
        note: 'Vacaciones',
      },
    });
    expect(res.body.exceptions).toHaveLength(1);
    const slots = await s.request(
      'GET',
      `/storefront/availability?variant_id=${variant}&from=${nextWeek.toISOString()}&to=${at(nextWeek, 24)}`,
    );
    expect(slots.body.slots).toEqual([]);
  });

  it('test_purchase books the first free slot and frees it again', async () => {
    const res = await s.request('POST', '/test-purchase', {
      token,
      body: { variant_ids: [variant] },
    });
    expect(res.body.ok, JSON.stringify(res.body.steps, null, 2)).toBe(true);
    expect(res.body.steps.find((x: { step: string }) => x.step === 'booking')?.detail).toContain(
      'confirmed',
    );
    const [b] = await sql<
      { status: string }[]
    >`select status from sellbase.bookings where order_id = ${res.body.order_id}`;
    expect(b?.status).toBe('cancelled');
  });
});
