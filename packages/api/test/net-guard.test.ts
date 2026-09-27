import { describe, expect, it } from 'vitest';
import { assertWebhookDestination, isPrivateAddress } from '../src/net-guard.js';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1%en0',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '64:ff9b::10.0.0.1',
  ])('blocks %s', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::6810:84e5', '::ffff:8.8.8.8'])(
    'allows %s',
    (ip) => expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe('assertWebhookDestination', () => {
  const resolve = async (host: string) =>
    ({
      'erp.example.com': ['93.184.216.34'],
      'sneaky.example.com': ['93.184.216.34', '10.0.0.5'],
      'rebind.example.com': ['::ffff:169.254.169.254'],
      'host.docker.internal': ['192.168.65.254'],
    })[host] ?? [];
  const guard = (url: string, allowPrivate = false) =>
    assertWebhookDestination(url, { allowPrivate, resolve });

  it('accepts public destinations', async () => {
    await expect(guard('https://erp.example.com/hooks')).resolves.toBeUndefined();
    await expect(guard('https://93.184.216.34/hooks')).resolves.toBeUndefined();
  });

  it('rejects private IPs, internal names and names that resolve to private addresses', async () => {
    for (const url of [
      'http://127.0.0.1:54321/functions/v1/sellbase-api',
      'http://[::1]/x',
      'http://169.254.169.254/latest/meta-data',
      'http://kong:8000/functions/v1/sellbase-jobs',
      'http://localhost:3000',
      'https://db.supabase.internal',
      'https://sneaky.example.com/hooks',
      'https://rebind.example.com/hooks',
    ]) {
      const error = await guard(url).catch((e: unknown) => e as { code: string; hint: string });
      expect(error, url).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect((error as { hint: string }).hint).toContain('SELLBASE_WEBHOOKS_ALLOW_PRIVATE');
    }
  });

  it('rejects credentials, other schemes and names that do not resolve', async () => {
    await expect(guard('https://user:pw@erp.example.com')).rejects.toMatchObject({
      message: expect.stringContaining('credentials'),
    });
    await expect(guard('ftp://erp.example.com')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(guard('https://nope.example.com')).rejects.toMatchObject({
      message: expect.stringContaining('does not resolve'),
    });
  });

  it('local development can allow private destinations', async () => {
    await expect(guard('http://host.docker.internal:4000/hook', true)).resolves.toBeUndefined();
    await expect(guard('http://kong:8000/x', true)).rejects.toMatchObject({
      message: expect.stringContaining('does not resolve'),
    });
  });
});
