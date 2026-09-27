import type { PaymentAccount, PaymentsAdapter } from '@sellbase/core';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestStore, sendWebhook, sql, type TestStore } from './helpers.js';

let s: TestStore;
let owner: string;
const webhookCalls: { url: string; haveSecret: boolean }[] = [];
let account: PaymentAccount;

/** The fake provider, but with live keys: mode, account and webhook setup. */
function goLive() {
  const base = s.payments.adapter;
  const live: PaymentsAdapter = {
    ...base,
    mode: () => 'live',
    account: async () => account,
    ensureWebhook: async (url, { haveSecret }) => {
      webhookCalls.push({ url, haveSecret });
      return { endpoint_id: 'we_live_1', secret: 'whsec_live_new', created: true };
    },
  };
  s.deps.payments = async () => live;
}

const check = async (id: string) => {
  const doctor = await s.request('GET', '/doctor', { token: owner });
  return doctor.body.checks.find((c: { id: string }) => c.id === id);
};

beforeAll(async () => {
  s = await createTestStore();
  owner = await s.staff('owner');
  account = {
    id: 'acct_live',
    name: 'Tienda Real',
    country: 'MX',
    default_currency: 'MXN',
    mode: 'live',
    charges_enabled: true,
    payouts_enabled: false,
    details_submitted: true,
  };
});

afterAll(async () => {
  await sql.end();
});

describe('going live with Stripe', () => {
  it('warns that test mode takes no real money', async () => {
    await s.request('POST', '/integrations/stripe/connect', {
      token: owner,
      body: { secret_key: 'sk_test_abc123', webhook_secret: 'whsec_test' },
    });
    const payments = await check('payments');
    expect(payments).toMatchObject({ status: 'warn' });
    expect(payments.hint).toContain('sk_live_');
    expect(await check('live_check')).toBeUndefined();
  });

  it('asks for confirmation before connecting live keys', async () => {
    goLive();
    const res = await s.request('POST', '/integrations/stripe/connect', {
      token: owner,
      body: { secret_key: 'sk_live_abc123' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.hint).toContain('confirm: true');
  });

  it('connects live keys, reads the account and creates the webhook endpoint', async () => {
    const res = await s.request('POST', '/integrations/stripe/connect', {
      token: owner,
      body: { secret_key: 'sk_live_abc123', confirm: true },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(webhookCalls.at(-1)).toEqual({
      url: 'https://project.test/functions/v1/sellbase-webhooks/stripe',
      haveSecret: false,
    });
    expect(res.body.integration.config).toMatchObject({
      mode: 'live',
      account: { name: 'Tienda Real', payouts_enabled: false },
      webhook: { setup: 'auto', endpoint_id: 'we_live_1' },
    });
    expect(res.body.next_steps.join(' ')).toContain('live-check');
    const [secret] = await sql<{ s: string }[]>`
      select sellbase.get_integration_secret(${s.storeId}, 'stripe') as s`;
    expect(JSON.parse(secret?.s ?? '{}')).toEqual({
      secret_key: 'sk_live_abc123',
      webhook_secret: 'whsec_live_new',
    });

    expect(await check('payments')).toMatchObject({ status: 'ok' });
    expect((await check('payments')).message).toContain('payouts not enabled');
    expect(await check('live_check')).toMatchObject({ status: 'warn' });
    expect((await check('webhooks')).message).toContain('we_live_1');
  });

  it('fails the doctor while the live account cannot charge', async () => {
    account = { ...account, charges_enabled: false };
    await s.request('POST', '/integrations/stripe/test', { token: owner });
    expect(await check('payments')).toMatchObject({ status: 'fail' });
    account = { ...account, charges_enabled: true };
    await s.request('POST', '/integrations/stripe/test', { token: owner });
    expect(await check('payments')).toMatchObject({ status: 'ok' });
  });

  it('keeps test_purchase away from real money', async () => {
    const res = await s.request('POST', '/test-purchase', { token: owner, body: {} });
    const step = res.body.steps.find((st: { step: string }) => st.step === 'payments');
    expect(step).toMatchObject({ ok: false });
    expect(step.hint).toContain('payments_live_check');
  });

  it('charges the minimum for real, then refunds it when the webhook arrives', async () => {
    const noUrl = await s.request('POST', '/integrations/stripe/live-check', {
      token: owner,
      body: { confirm: true },
    });
    expect(noUrl.status).toBe(400);
    expect(noUrl.body.error.hint).toContain('site_url');

    const started = await s.request('POST', '/integrations/stripe/live-check', {
      token: owner,
      body: { confirm: true, success_url: 'https://tienda.test/gracias' },
    });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.body).toMatchObject({ amount: 1000, currency: 'MXN' });
    expect(s.payments.created.at(-1)).toMatchObject({
      amount_total: 1000,
      checkout_session_id: null,
    });
    expect(await check('live_check')).toMatchObject({ status: 'warn' });

    const eventId = `evt_${randomUUID()}`;
    const hook = await sendWebhook(s, {
      id: eventId,
      data: {
        type: 'live_check.paid',
        provider_event_id: eventId,
        live_check_id: started.body.live_check_id,
        provider_payment_id: 'pi_live_check',
        amount: 1000,
        currency: 'MXN',
      },
    });
    expect(hook.body.outcome).toBe('live_check');
    expect(s.payments.refunds.at(-1)).toMatchObject({
      provider_payment_id: 'pi_live_check',
      amount: 1000,
      idempotency_key: `live-check-refund-${started.body.live_check_id}`,
    });
    expect(await check('live_check')).toMatchObject({ status: 'ok' });
    expect(await check('webhooks')).toMatchObject({ status: 'ok' });

    // The same event again changes nothing and refunds nothing twice.
    const refunds = s.payments.refunds.length;
    await sendWebhook(s, { id: eventId, data: {} });
    expect(s.payments.refunds).toHaveLength(refunds);
  });

  it('is only for live keys and needs integrations:write', async () => {
    const agent = await s.token(['catalog:read']);
    const denied = await s.request('POST', '/integrations/stripe/live-check', {
      token: agent,
      body: { confirm: true },
    });
    expect(denied.status).toBe(403);
    s.deps.payments = async () => s.payments.adapter;
    const test = await s.request('POST', '/integrations/stripe/live-check', {
      token: owner,
      body: { confirm: true, success_url: 'https://tienda.test' },
    });
    expect(test.status).toBe(400);
    expect(test.body.error.hint).toContain('test_purchase');
  });
});
