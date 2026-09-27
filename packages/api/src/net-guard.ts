import { sellbaseError } from '@sellbase/core';

/**
 * Outbound webhooks must not reach the project's own network (SSRF): database, Kong,
 * cloud metadata, other containers. Every destination is resolved and rejected when any
 * address is private, loopback, link-local or otherwise not publicly routable. Local
 * development can allow them with SELLBASE_WEBHOOKS_ALLOW_PRIVATE=true (ADR 0010).
 */

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const v = Number(part);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

const V4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata (169.254.169.254)
  ['172.16.0.0', 12], // private (Docker networks)
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
];

function isPrivateV4(ip: string) {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  return V4_BLOCKED.some(([base, bits]) => {
    const b = ipv4ToInt(base) ?? 0;
    const size = 2 ** (32 - bits);
    return n >= b && n < b + size;
  });
}

/** Expands an IPv6 address to 8 groups of 16 bits (null if it is not one). */
function ipv6Groups(ip: string): number[] | null {
  let addr =
    ip
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
      .split('%')[0] ?? '';
  // IPv4-embedded tail (::ffff:10.0.0.1, 64:ff9b::a.b.c.d)
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (v4?.[1]) {
    const n = ipv4ToInt(v4[1]);
    if (n === null) return null;
    addr = addr.replace(v4[1], `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`);
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

function isPrivateV6(ip: string) {
  const g = ipv6Groups(ip);
  if (!g) return false;
  const [a = 0, b = 0, , , , f = 0, g6 = 0, h = 0] = g;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && h === 1) return true; // ::1
  if ((a & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((a & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((a & 0xff00) === 0xff00) return true; // multicast
  if (a === 0x2001 && b === 0x0db8) return true; // documentation
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d): judge the IPv4 inside.
  const mapped = g.slice(0, 5).every((x) => x === 0) && f === 0xffff;
  const nat64 = a === 0x64 && b === 0xff9b && g.slice(2, 6).every((x) => x === 0);
  if (mapped || nat64) return isPrivateV4(`${g6 >> 8}.${g6 & 255}.${h >> 8}.${h & 255}`);
  return false;
}

export function isPrivateAddress(ip: string) {
  return ip.includes(':') ? isPrivateV6(ip) : isPrivateV4(ip);
}

const isIpLiteral = (host: string) => ipv4ToInt(host) !== null || ipv6Groups(host) !== null;

/** Names that only exist inside a network (localhost, kong, db.internal, printer.local). */
function isInternalName(host: string) {
  return (
    !host.includes('.') ||
    /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/.test(host)
  );
}

export type Resolver = (host: string) => Promise<string[]>;

/** Resolves A and AAAA records: Deno in Edge Functions, node:dns elsewhere. */
export const defaultResolver: Resolver = async (host) => {
  const deno = (
    globalThis as { Deno?: { resolveDns?: (h: string, t: string) => Promise<string[]> } }
  ).Deno;
  if (deno?.resolveDns) {
    const results = await Promise.allSettled([
      deno.resolveDns(host, 'A'),
      deno.resolveDns(host, 'AAAA'),
    ]);
    return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  }
  const dns = await import('node:dns/promises');
  return (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address);
};

/**
 * Throws a SellbaseError when the URL may not receive webhooks. Always resolves the name
 * (so typos fail early); `allowPrivate` only accepts private results.
 */
export async function assertWebhookDestination(
  rawUrl: string,
  options: { allowPrivate: boolean; resolve: Resolver },
) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw sellbaseError(
      'VALIDATION_ERROR',
      `"${rawUrl}" is not a URL.`,
      'Use a full URL, e.g. https://erp.example.com/hooks.',
    );
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw sellbaseError(
      'VALIDATION_ERROR',
      'Webhooks go to http(s) URLs only.',
      'Use an https:// URL.',
    );
  }
  if (url.username || url.password) {
    throw sellbaseError(
      'VALIDATION_ERROR',
      'Webhook URLs cannot carry credentials.',
      'Remove user:password@ from the URL; verify requests with the Sellbase-Signature header instead.',
    );
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const blocked = (why: string) =>
    sellbaseError(
      'VALIDATION_ERROR',
      `Webhooks cannot be sent to ${host}: ${why}.`,
      'Use a public URL of the receiving system. For local development, set SELLBASE_WEBHOOKS_ALLOW_PRIVATE=true in the Edge Functions secrets of the local stack only.',
      { host },
    );
  if (!options.allowPrivate && !isIpLiteral(host) && isInternalName(host))
    throw blocked('it is an internal network name');
  const addresses = isIpLiteral(host) ? [host] : await options.resolve(host).catch(() => []);
  if (addresses.length === 0) {
    throw sellbaseError(
      'VALIDATION_ERROR',
      `${host} does not resolve to any address.`,
      'Check the domain name of the receiving system.',
      { host },
    );
  }
  if (!options.allowPrivate) {
    const privateOne = addresses.find(isPrivateAddress);
    if (privateOne) throw blocked(`it points to a private address (${privateOne})`);
  }
}
