import {
  ERROR_CODES,
  routes,
  sellbaseError,
  type ErrorCode,
  type RouteDef,
  type SellbaseError,
} from '@sellbase/core';
import type { z } from 'zod';

type Routes = typeof routes;
export type RouteId = keyof Routes;

type Input<T> = T extends z.ZodType ? z.input<T> : never;
export type RouteResponse<K extends RouteId> = z.output<Routes[K]['response']>;

/** Arguments for a route: only the parts the route declares are accepted. */
export type RouteArgs<K extends RouteId> = (Routes[K] extends { params: z.ZodType }
  ? { params: Input<Routes[K]['params']> }
  : { params?: never }) &
  (Routes[K] extends { query: z.ZodType }
    ? { query?: Input<Routes[K]['query']> }
    : { query?: never }) &
  (Routes[K] extends { body: z.ZodType }
    ? { body: Input<Routes[K]['body']> }
    : { body?: never }) & {
    /** Reuse the same key when retrying so the action runs once. Generated when omitted. */
    idempotencyKey?: string;
    signal?: AbortSignal;
  };

export interface SellbaseClientOptions {
  /** Base URL of the API function, e.g. https://<ref>.supabase.co/functions/v1/sellbase-api */
  url: string;
  /** Supabase anon/publishable key; sent as `apikey` (never the service role key). */
  anonKey?: string;
  /** Staff session JWT or sb_live_ API token for admin routes. Omit in the storefront. */
  token?: string | (() => string | null | Promise<string | null>);
  fetch?: typeof fetch;
}

const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);

function buildPath(route: RouteDef, params: Record<string, unknown> | undefined) {
  return route.path.replace(/:([a-z_]+)/g, (_, name: string) => {
    const value = params?.[name];
    if (value === undefined || value === null)
      throw new TypeError(`Missing path parameter "${name}" for ${route.id}`);
    return encodeURIComponent(String(value));
  });
}

function buildQuery(query: Record<string, unknown> | undefined) {
  if (!query) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

async function toError(res: Response): Promise<SellbaseError> {
  const body = (await res.json().catch(() => null)) as {
    error?: { code?: unknown; message?: string; hint?: string; details?: Record<string, unknown> };
  } | null;
  const error = body?.error;
  if (error && isErrorCode(error.code)) {
    return sellbaseError(error.code, error.message ?? error.code, error.hint ?? '', {
      ...error.details,
      status: res.status,
    });
  }
  return sellbaseError(
    'INTERNAL_ERROR',
    `Request failed with HTTP ${res.status}.`,
    'Check that the Sellbase URL is correct and the functions are deployed.',
    { status: res.status },
  );
}

export function createClient(options: SellbaseClientOptions) {
  const base = options.url.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1';
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function request<K extends RouteId>(id: K, args: RouteArgs<K>): Promise<RouteResponse<K>> {
    const route = routes[id] as RouteDef;
    const a = args as {
      params?: Record<string, unknown>;
      query?: Record<string, unknown>;
      body?: unknown;
      idempotencyKey?: string;
      signal?: AbortSignal;
    };
    const url = base + buildPath(route, a.params) + buildQuery(a.query);
    const token = typeof options.token === 'function' ? await options.token() : options.token;
    const mutating = route.method !== 'GET';
    const headers: Record<string, string> = { accept: 'application/json' };
    if (a.body !== undefined) headers['content-type'] = 'application/json';
    if (options.anonKey) headers.apikey = options.anonKey;
    if (token) headers.authorization = `Bearer ${token}`;
    if (mutating) headers['idempotency-key'] = a.idempotencyKey ?? crypto.randomUUID();

    const init: RequestInit = {
      method: route.method,
      headers,
      ...(a.body !== undefined ? { body: JSON.stringify(a.body) } : {}),
      ...(a.signal ? { signal: a.signal } : {}),
    };
    let res: Response;
    try {
      res = await doFetch(url, init);
    } catch (error) {
      // One retry on network failure; the idempotency key makes it safe for mutations.
      if (a.signal?.aborted) throw error;
      res = await doFetch(url, init);
    }
    if (!res.ok) throw await toError(res);
    return (await res.json()) as RouteResponse<K>;
  }

  return { request, baseUrl: base };
}

export type SellbaseClient = ReturnType<typeof createClient>;
