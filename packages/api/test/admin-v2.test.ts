import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runJobs } from '../src/index.js';
import { createTestStore, sendWebhook, sql, type TestStore } from './helpers.js';

let s: TestStore;
let agent: string;
let owner: string;
let product: { id: string; variant: string };

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function startCheckout(email: string, extra: Record<string, unknown> = {}) {
  const cart = await s.request('POST', '/storefront/carts', { body: {} });
  await s.request('POST', `/storefront/carts/${cart.body.token}/items`, {
    body: { variant_id: product.variant, quantity: 2 },
  });
  const checkout = await s.request('POST', '/storefront/checkout', {
    body: {
      cart_token: cart.body.token,
      email,
      shipping_rate_id: 'manual:flat',
      shipping_address: { line1: 'A', city: 'B', postal_code: '1', country: 'MX' },
      success_url: 'https://shop.test/gracias',
      cancel_url: 'https://shop.test/carrito',
      ...extra,
    },
  });
  return { cart: cart.body.token as string, checkout };
}

async function pay(checkoutId: string) {
  const eventId = `evt_${crypto.randomUUID()}`;
  await sendWebhook(s, {
    id: eventId,
    data: {
      type: 'checkout.paid',
      provider_event_id: eventId,
      checkout_session_id: checkoutId,
      provider_payment_id: `pi_${crypto.randomUUID()}`,
      method: 'card',
      amount: s.payments.created.at(-1)?.amount_total ?? 0,
      currency: 'MXN',
      raw: {},
    },
  });
}

const expire = (id: string, hoursAgo: number) =>
  sql`update sellbase.checkout_sessions
         set expires_at = now() - interval '1 minute', created_at = now() - make_interval(hours => ${hoursAgo})
       where id = ${id}`;

beforeAll(async () => {
  s = await createTestStore();
  agent = await s.token();
  owner = await s.staff('owner');
  const p = await s.request('POST', '/products', {
    token: agent,
    body: {
      type: 'physical',
      title: 'Mezcal Espadín',
      status: 'active',
      variants: [{ sku: 'ESP-750', price_amount: 89000, inventory: { on_hand: 20 } }],
    },
  });
  product = { id: p.body.id, variant: p.body.variants[0].id };
});

afterAll(async () => {
  await sql`delete from sellbase.stores where id = ${s.storeId}`;
});

describe('product editor API', () => {
  it('saves SEO and collections with the product', async () => {
    const c = await s.request('POST', '/collections', {
      token: agent,
      body: { title: 'Mezcales' },
    });
    const res = await s.request('POST', '/products', {
      token: agent,
      body: {
        id: product.id,
        type: 'physical',
        title: 'Mezcal Espadín',
        status: 'active',
        seo: { title: 'Mezcal Espadín artesanal', description: '  ' },
        collection_ids: [c.body.id],
        variants: [{ id: product.variant, sku: 'ESP-750', price_amount: 89000 }],
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.seo).toEqual({ title: 'Mezcal Espadín artesanal' });
    expect(res.body.collection_ids).toEqual([c.body.id]);

    // Omitting collection_ids keeps them; an empty list removes them.
    const kept = await s.request('POST', '/products', {
      token: agent,
      body: {
        id: product.id,
        type: 'physical',
        title: 'Mezcal Espadín',
        status: 'active',
        variants: [{ id: product.variant, price_amount: 89000 }],
      },
    });
    expect(kept.body.collection_ids).toEqual([c.body.id]);
    expect(kept.body.seo).toEqual({ title: 'Mezcal Espadín artesanal' });
    const unknown = await s.request('POST', '/products', {
      token: agent,
      body: {
        id: product.id,
        type: 'physical',
        title: 'Mezcal Espadín',
        collection_ids: [crypto.randomUUID()],
        variants: [{ id: product.variant, price_amount: 89000 }],
      },
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.hint).toContain('GET /collections');
  });

  it('reorders, relabels and deletes images', async () => {
    for (const name of ['a.png', 'b.png', 'c.png'])
      await s.request('POST', `/products/${product.id}/media`, {
        token: agent,
        body: { file_name: name, content_base64: PNG },
      });
    const before = await s.request('GET', `/products/${product.id}`, { token: agent });
    const [a, b, c] = before.body.media as { id: string; url: string }[];
    const moved = await s.request('PATCH', `/products/${product.id}/media`, {
      token: agent,
      body: { media: [{ id: c!.id, alt: 'Botella' }, { id: a!.id }] },
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.media.map((m: { id: string }) => m.id)).toEqual([c!.id, a!.id, b!.id]);
    expect(moved.body.media[0].alt).toBe('Botella');

    const removed = await s.request('DELETE', `/products/${product.id}/media/${a!.id}`, {
      token: agent,
    });
    expect(removed.body.media.map((m: { id: string }) => m.id)).toEqual([c!.id, b!.id]);
    expect(s.removed.at(-1)?.bucket).toBe('sellbase-media');

    const foreign = await s.request('PATCH', `/products/${product.id}/media`, {
      token: agent,
      body: { media: [{ id: crypto.randomUUID() }] },
    });
    expect(foreign.status).toBe(404);
  });

  it('lists inventory with low and out of stock filters', async () => {
    const low = await s.request('POST', '/products', {
      token: agent,
      body: {
        type: 'physical',
        title: 'Mezcal Tobalá',
        status: 'active',
        variants: [{ sku: 'TOB-750', price_amount: 129000, inventory: { on_hand: 2 } }],
      },
    });
    await s.request('POST', '/products', {
      token: agent,
      body: {
        type: 'digital',
        title: 'Guía de catas',
        status: 'active',
        variants: [{ price_amount: 19900 }],
      },
    });
    const all = await s.request('GET', '/inventory', { token: agent });
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    const tobala = all.body.data.find((i: { sku: string }) => i.sku === 'TOB-750');
    expect(tobala).toMatchObject({
      tracked: true,
      on_hand: 2,
      available: 2,
      product_id: low.body.id,
    });
    const guide = all.body.data.find(
      (i: { product_title: string }) => i.product_title === 'Guía de catas',
    );
    expect(guide).toMatchObject({ tracked: false, policy: null });

    const lowOnly = await s.request('GET', '/inventory?stock=low&threshold=5', { token: agent });
    expect(lowOnly.body.data.map((i: { sku: string }) => i.sku)).toEqual(['TOB-750']);
    const bySku = await s.request('GET', '/inventory?q=ESP', { token: agent });
    expect(bySku.body.data).toHaveLength(1);
    const out = await s.request('GET', '/inventory?stock=out', { token: agent });
    expect(out.body.data).toHaveLength(0);
  });
});

describe('checkout consent', () => {
  it('is required when the store asks for it, and stays with the order', async () => {
    const consent = 'Confirmo que soy mayor de 18 años';
    await s.request('PATCH', '/store', {
      token: owner,
      body: { settings: { checkout: { required_consent: consent } } },
    });
    const info = await s.request('GET', '/storefront/store');
    expect(info.body).toMatchObject({
      name: 'Test Store',
      checkout: { required_consent: consent },
    });

    const missing = await startCheckout('menor@test.dev');
    expect(missing.checkout.status).toBe(400);
    expect(missing.checkout.body.error.details.required_consent).toBe(consent);

    const ok = await startCheckout('mayor@test.dev', { consents: [consent] });
    expect(ok.checkout.status, JSON.stringify(ok.checkout.body)).toBe(200);
    await pay(ok.checkout.body.checkout_session_id);
    const [order] = await sql<
      { metadata: { consents: { text: string; accepted_at: string }[] } }[]
    >`
      select metadata from sellbase.orders where checkout_session_id = ${ok.checkout.body.checkout_session_id}`;
    expect(order?.metadata.consents[0]?.text).toBe(consent);
    expect(order?.metadata.consents[0]?.accepted_at).toMatch(/^\d{4}-/);

    await s.request('PATCH', '/store', {
      token: owner,
      body: { settings: { checkout: { required_consent: null } } },
    });
    const off = await s.request('GET', '/storefront/store');
    expect(off.body.checkout.required_consent).toBeNull();
  });
});

describe('abandoned checkouts', () => {
  it('lists unpaid checkouts, sends the recovery email once and marks recovered carts', async () => {
    const first = await startCheckout('olvido@test.dev');
    expect(first.checkout.status).toBe(200);
    const id = first.checkout.body.checkout_session_id as string;

    let list = await s.request('GET', '/checkouts/abandoned', { token: owner });
    let row = list.body.data.find((r: { id: string }) => r.id === id);
    expect(row).toMatchObject({
      status: 'in_progress',
      email: 'olvido@test.dev',
      recovery_url: null,
    });
    expect(row.items[0]).toMatchObject({ title: 'Mezcal Espadín', quantity: 2 });

    await expire(id, 3);
    await runJobs(s.deps, { storeId: s.storeId });
    list = await s.request('GET', '/checkouts/abandoned?status=abandoned', { token: owner });
    row = list.body.data.find((r: { id: string }) => r.id === id);
    expect(row.status).toBe('abandoned');

    // Without the storefront URL the email cannot link back to the cart.
    const noSite = await s.request('POST', `/checkouts/${id}/recovery-email`, {
      token: owner,
      body: {},
    });
    expect(noSite.status).toBe(400);
    expect(noSite.body.error.hint).toContain('site_url');

    await s.request('PATCH', '/store', {
      token: owner,
      body: { settings: { site_url: 'https://mezcal.test/' } },
    });
    const sent = await s.request('POST', `/checkouts/${id}/recovery-email`, {
      token: owner,
      body: {},
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.recovery_url).toBe(`https://mezcal.test/?sellbase_cart=${first.cart}`);
    const email = s.emails.at(-1);
    expect(email?.to).toBe('olvido@test.dev');
    expect(email?.subject).toContain('Test Store');
    expect(email?.html).toContain(`sellbase_cart=${first.cart}`);

    const again = await s.request('POST', `/checkouts/${id}/recovery-email`, {
      token: owner,
      body: {},
    });
    expect(again.status).toBe(409);
    const resend = await s.request('POST', `/checkouts/${id}/recovery-email`, {
      token: owner,
      body: { resend: true },
    });
    expect(resend.status).toBe(200);

    // The buyer comes back through the link and pays: the row becomes "recovered".
    const back = await s.request('POST', '/storefront/checkout', {
      body: {
        cart_token: first.cart,
        email: 'olvido@test.dev',
        shipping_rate_id: 'manual:flat',
        shipping_address: { line1: 'A', city: 'B', postal_code: '1', country: 'MX' },
        success_url: 'https://shop.test/gracias',
        cancel_url: 'https://shop.test/carrito',
      },
    });
    await pay(back.body.checkout_session_id);
    list = await s.request('GET', '/checkouts/abandoned?status=recovered', { token: owner });
    row = list.body.data.find((r: { id: string }) => r.id === id);
    expect(row.status).toBe('recovered');
    expect(row.recovered_order.number).toBeGreaterThan(1000);
    expect(row.recovery_url).toBeNull();
  });

  it('sends automatic recovery emails once, after the delay', async () => {
    await s.request('PATCH', '/store', {
      token: owner,
      body: { settings: { abandoned_checkout: { auto_email: true, delay_hours: 2 } } },
    });
    const recent = await startCheckout('reciente@test.dev');
    const old = await startCheckout('auto@test.dev');
    await expire(recent.checkout.body.checkout_session_id, 1);
    await expire(old.checkout.body.checkout_session_id, 3);
    const before = s.emails.length;
    await runJobs(s.deps, { storeId: s.storeId });
    await runJobs(s.deps, { storeId: s.storeId });
    const recovery = s.emails.slice(before).filter((e) => e.subject.includes('carrito'));
    expect(recovery.map((e) => e.to)).toEqual(['auto@test.dev']);
    await s.request('PATCH', '/store', {
      token: owner,
      body: { settings: { abandoned_checkout: { auto_email: false } } },
    });
  });

  it('agents need orders:write to email buyers', async () => {
    const readOnly = await s.token(['orders:read']);
    const res = await s.request('POST', `/checkouts/${crypto.randomUUID()}/recovery-email`, {
      token: readOnly,
      body: {},
    });
    expect(res.status).toBe(403);
  });
});

describe('store branding and email test', () => {
  it('uploads the logo and sends a test email', async () => {
    const logo = await s.request('POST', '/store/logo', {
      token: owner,
      body: { file_name: 'logo.png', content_base64: PNG },
    });
    expect(logo.status, JSON.stringify(logo.body)).toBe(200);
    expect(logo.body.logo_url).toMatch(
      /^https:\/\/storage\.test\/public\/sellbase-media\/.+logo\.png$/,
    );
    const pdf = await s.request('POST', '/store/logo', {
      token: owner,
      body: { file_name: 'logo.pdf', content_base64: PNG },
    });
    expect(pdf.status).toBe(400);

    const test = await s.request('POST', '/notifications/test', {
      token: owner,
      body: { to: 'dueno@test.dev' },
    });
    expect(test.status).toBe(200);
    expect(test.body.provider).toBe('log');
    expect(test.body.ok).toBe(false);
    expect(s.emails.at(-1)?.subject).toMatch(/^\[Prueba\]/);
  });
});
