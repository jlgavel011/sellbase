import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runJobs, verifyWebhookSignature } from '../src/index.js';
import { createTestStore, sql, type TestStore } from './helpers.js';

let s: TestStore;
let owner: string;

beforeAll(async () => {
  s = await createTestStore();
  owner = await s.staff('owner');
});

afterAll(async () => {
  await sql.end();
});

describe('team', () => {
  it('invites new people, adds existing users and lists roles', async () => {
    const email = `nuevo-${randomUUID()}@test.dev`;
    const invited = await s.request('POST', '/team', {
      token: owner,
      body: { email, role: 'staff', redirect_to: 'https://tienda.test/admin' },
    });
    expect(invited.status, JSON.stringify(invited.body)).toBe(200);
    expect(invited.body).toMatchObject({ email, role: 'staff', invited: true });
    expect(s.invites.at(-1)).toEqual({ email, redirectTo: 'https://tienda.test/admin' });

    const again = await s.request('POST', '/team', { token: owner, body: { email } });
    expect(again.status).toBe(400);
    expect(again.body.error.hint).toContain('PATCH /team');

    const list = await s.request('GET', '/team', { token: owner });
    expect(list.body.data.map((m: { role: string }) => m.role)).toEqual(['owner', 'staff']);
  });

  it('keeps ownership changes for owners and always keeps one owner', async () => {
    const admin = await s.staff('admin');
    const email = `socio-${randomUUID()}@test.dev`;
    const denied = await s.request('POST', '/team', {
      token: admin,
      body: { email, role: 'owner' },
    });
    expect(denied.status).toBe(403);

    const list = await s.request('GET', '/team', { token: owner });
    const ownerId = list.body.data.find((m: { role: string }) => m.role === 'owner').user_id;
    const demote = await s.request('PATCH', `/team/${ownerId}`, {
      token: owner,
      body: { role: 'admin' },
    });
    expect(demote.status).toBe(400);
    expect(demote.body.error.message).toContain('at least one owner');
    const remove = await s.request('DELETE', `/team/${ownerId}`, { token: owner });
    expect(remove.status).toBe(400);

    const staffMember = list.body.data.find((m: { role: string }) => m.role === 'staff');
    const promoted = await s.request('PATCH', `/team/${staffMember.user_id}`, {
      token: admin,
      body: { role: 'admin' },
    });
    expect(promoted.body.role).toBe('admin');
    const removed = await s.request('DELETE', `/team/${staffMember.user_id}`, { token: admin });
    expect(removed.body).toEqual({ user_id: staffMember.user_id, removed: true });
  });

  it('is closed to the staff role', async () => {
    const staff = await s.staff('staff');
    const res = await s.request('GET', '/team', { token: staff });
    expect(res.status).toBe(403);
  });
});

describe('api tokens and agent activity', () => {
  it('creates a token shown once, logs what it does and revokes it', async () => {
    const created = await s.request('POST', '/tokens', {
      token: owner,
      body: { name: 'Claude Code', expires_in_days: 30 },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body.token).toMatch(/^sb_live_/);
    expect(created.body.scopes).not.toContain('refunds:write');
    expect(created.body.expires_at).not.toBeNull();

    await s.request('POST', '/products', {
      token: created.body.token,
      body: { type: 'digital', title: 'Hecho por IA', variants: [{ price_amount: 100 }] },
    });
    const activity = await s.request('GET', `/audit?actor_type=token&actor_id=${created.body.id}`, {
      token: owner,
    });
    expect(activity.body.data[0]).toMatchObject({
      actor_type: 'token',
      actor_name: 'Claude Code',
      action: 'product.create',
    });
    const list = await s.request('GET', '/tokens', { token: owner });
    const listed = list.body.data.find((t: { id: string }) => t.id === created.body.id);
    expect(listed).toMatchObject({ actions_30d: 1 });
    expect(listed.token).toBeUndefined();

    const revoked = await s.request('DELETE', `/tokens/${created.body.id}`, { token: owner });
    expect(revoked.body.revoked_at).not.toBeNull();
    const after = await s.request('GET', '/products', { token: created.body.token });
    expect(after.status).toBe(401);
  });

  it('never lets a token mint scopes it lacks', async () => {
    const agent = await s.token();
    const res = await s.request('POST', '/tokens', {
      token: agent,
      body: { name: 'escalada', scopes: ['refunds:write'] },
    });
    expect(res.status).toBe(403);
    expect(res.body.error.details.missing).toEqual(['refunds:write']);
  });
});

describe('outbound webhooks', () => {
  it('signs deliveries, retries failures and records every attempt', async () => {
    const created = await s.request('POST', '/webhooks', {
      token: owner,
      body: { url: 'https://erp.test/hooks', events: ['product.created'] },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body.secret).toMatch(/^whsec_/);
    const { id, secret } = created.body;

    // A product event reaches the endpoint, signed; other events are skipped.
    s.hookResponses.push(500);
    const product = await s.request('POST', '/products', {
      token: owner,
      body: { type: 'digital', title: 'Webhook', variants: [{ price_amount: 100 }] },
    });
    await runJobs(s.deps, { storeId: s.storeId });
    const first = s.hooks.at(-1);
    expect(first?.url).toBe('https://erp.test/hooks');
    expect(JSON.parse(first?.body ?? '{}')).toMatchObject({
      type: 'product.created',
      data: { product: { id: product.body.id, title: 'Webhook' } },
    });
    expect(
      await verifyWebhookSignature(
        secret,
        first?.body ?? '',
        first?.headers['sellbase-signature'] ?? '',
      ),
    ).toBe(true);
    expect(
      await verifyWebhookSignature(
        'whsec_wrong',
        first?.body ?? '',
        first?.headers['sellbase-signature'] ?? '',
      ),
    ).toBe(false);

    let deliveries = await s.request('GET', `/webhooks/${id}/deliveries`, { token: owner });
    expect(deliveries.body.data[0]).toMatchObject({
      status: 'pending',
      attempts: 1,
      last_status_code: 500,
    });

    // The retry is due after the backoff; it succeeds this time.
    await sql`update sellbase.webhook_deliveries set next_attempt_at = now() where endpoint_id = ${id}`;
    await runJobs(s.deps, { storeId: s.storeId });
    deliveries = await s.request('GET', `/webhooks/${id}/deliveries`, { token: owner });
    expect(deliveries.body.data[0]).toMatchObject({ status: 'succeeded', attempts: 2 });
    expect(deliveries.body.data).toHaveLength(1);

    const list = await s.request('GET', '/webhooks', { token: owner });
    expect(list.body.data[0]).toMatchObject({ id, stats: { failed: 0, last_status: 'succeeded' } });
    expect(list.body.events).toContain('order.paid');
  });

  it('gives up after the last retry', async () => {
    const created = await s.request('POST', '/webhooks', {
      token: owner,
      body: { url: 'https://down.test/hooks' },
    });
    for (let i = 0; i < 6; i++) s.hookResponses.push(503);
    const test = await s.request('POST', `/webhooks/${created.body.id}/test`, { token: owner });
    expect(test.body).toMatchObject({ status: 'pending', attempts: 1, last_status_code: 503 });
    for (let i = 0; i < 5; i++) {
      await sql`update sellbase.webhook_deliveries set next_attempt_at = now() where endpoint_id = ${created.body.id}`;
      await runJobs(s.deps, { storeId: s.storeId });
    }
    const deliveries = await s.request('GET', `/webhooks/${created.body.id}/deliveries`, {
      token: owner,
    });
    expect(deliveries.body.data[0]).toMatchObject({ status: 'failed', attempts: 6 });
  });

  it('pauses, edits and deletes endpoints with their secret', async () => {
    const created = await s.request('POST', '/webhooks', {
      token: owner,
      body: { url: 'https://pausa.test/hooks' },
    });
    const paused = await s.request('PATCH', `/webhooks/${created.body.id}`, {
      token: owner,
      body: { enabled: false, events: ['order.paid'] },
    });
    expect(paused.body).toMatchObject({ enabled: false, events: ['order.paid'] });
    const [ref] =
      await sql`select secret_ref from sellbase.webhook_endpoints where id = ${created.body.id}`;
    const del = await s.request('DELETE', `/webhooks/${created.body.id}`, { token: owner });
    expect(del.body.deleted).toBe(true);
    const [secret] = await sql`select 1 from vault.secrets where id = ${ref?.secret_ref ?? null}`;
    expect(secret).toBeUndefined();
  });
});
