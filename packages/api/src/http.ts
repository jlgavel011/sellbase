import {
  fromZodError,
  isSellbaseError,
  sellbaseError,
  toErrorResponse,
  type RouteDef,
} from '@sellbase/core';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { authorize, resolveActor, sha256Hex, type Actor } from './auth.js';
import type { Deps } from './deps.js';
import { fromDbError, statusFor } from './errors.js';

type Parsed<T extends z.ZodType | undefined> = T extends z.ZodType ? z.output<T> : undefined;

export interface HandlerCtx<R extends RouteDef> {
  deps: Deps;
  storeId: string;
  actor: Actor | null;
  params: Parsed<R['params']>;
  query: Parsed<R['query']>;
  body: Parsed<R['body']>;
  ip: string | null;
}

export type Handler<R extends RouteDef> = (
  ctx: HandlerCtx<R>,
) => Promise<R['redirect'] extends true ? { redirect: string } : z.input<R['response']>>;

export interface AppOptions {
  /** Validate every response against its contract (on in tests, off in production). */
  validateResponses?: boolean;
  rateLimitPerMinute?: number;
}

function parseWith<T extends z.ZodType>(schema: T, value: unknown, context: string): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw fromZodError(result.error, context);
  return result.data;
}

// ── Rate limit (per isolate, public routes only; see ADR 0005) ───────────────
const buckets = new Map<string, { windowStart: number; count: number }>();

function rateLimit(key: string, limit: number, now: number) {
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= 60_000) {
    buckets.set(key, { windowStart: now, count: 1 });
    if (buckets.size > 10_000) buckets.clear();
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    throw sellbaseError('RATE_LIMITED', 'Too many requests.', 'Wait a minute and retry.', {
      limit_per_minute: limit,
    });
  }
}

// ── Idempotency ──────────────────────────────────────────────────────────────
interface StoredResponse {
  status: number;
  body: unknown;
}

async function withIdempotency(
  deps: Deps,
  scope: string,
  key: string | undefined,
  requestHash: string,
  run: () => Promise<StoredResponse>,
): Promise<StoredResponse> {
  if (!key) return run();
  if (key.length > 255) {
    throw sellbaseError(
      'VALIDATION_ERROR',
      'Idempotency-Key is too long.',
      'Use a UUID as the Idempotency-Key.',
    );
  }
  const inserted = await deps.sql`
    insert into sellbase.idempotency_keys (scope, key, request_hash) values (${scope}, ${key}, ${requestHash})
    on conflict do nothing returning key`;
  if (inserted.length === 0) {
    const [row] = await deps.sql<
      { request_hash: string; response_status: number | null; response_body: unknown }[]
    >`
      select request_hash, response_status, response_body from sellbase.idempotency_keys
       where scope = ${scope} and key = ${key}`;
    if (row && row.request_hash !== requestHash) {
      throw sellbaseError(
        'IDEMPOTENCY_CONFLICT',
        'This Idempotency-Key was already used with a different request.',
        'Generate a new Idempotency-Key for a different request.',
      );
    }
    if (!row || row.response_status === null) {
      throw sellbaseError(
        'IDEMPOTENCY_CONFLICT',
        'A request with this Idempotency-Key is still in progress.',
        'Wait a moment and retry with the same key to get its result.',
      );
    }
    return { status: row.response_status, body: row.response_body };
  }
  try {
    const response = await run();
    await deps.sql`
      update sellbase.idempotency_keys set response_status = ${response.status}, response_body = ${deps.sql.json(response.body as never)}
       where scope = ${scope} and key = ${key}`;
    return response;
  } catch (error) {
    // Failed requests are not stored, so the client can fix the input and retry.
    await deps.sql`delete from sellbase.idempotency_keys where scope = ${scope} and key = ${key}`;
    throw error;
  }
}

// ── Registration ─────────────────────────────────────────────────────────────
function honoPath(path: string) {
  return path; // Hono uses the same :param syntax as the contracts
}

export function register<R extends RouteDef>(
  app: Hono,
  deps: Deps,
  options: AppOptions,
  route: R,
  handler: Handler<R>,
) {
  const method = route.method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete';
  app[method](honoPath(route.path), async (c: Context) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    if (route.auth.kind === 'public') {
      rateLimit(`${ip ?? 'unknown'}`, options.rateLimitPerMinute ?? 120, deps.now().getTime());
    }
    const storeId = await deps.storeId();
    const actor = authorize(await resolveActor(deps, c.req.header('authorization')), route.auth);

    const params = route.params
      ? parseWith(route.params, c.req.param(), 'path parameters')
      : undefined;
    const query = route.query ? parseWith(route.query, c.req.query(), 'query') : undefined;
    let rawBody: unknown = undefined;
    if (route.body) {
      rawBody = await c.req.json().catch(() => {
        throw sellbaseError(
          'VALIDATION_ERROR',
          'The request body must be JSON.',
          'Send a JSON body with Content-Type: application/json.',
        );
      });
    }
    const body = route.body ? parseWith(route.body, rawBody, 'body') : undefined;

    const ctx = { deps, storeId, actor, params, query, body, ip } as HandlerCtx<R>;
    const execute = async (): Promise<StoredResponse> => {
      const result = await handler(ctx);
      if (route.redirect) return { status: 302, body: result };
      // Validate what the client actually receives: the JSON form (Dates become ISO strings).
      const data: unknown = JSON.parse(JSON.stringify(result));
      if (options.validateResponses) parseWith(route.response, data, `response of ${route.id}`);
      return { status: 200, body: data };
    };

    const mutating = route.method !== 'GET';
    const response = mutating
      ? await withIdempotency(
          deps,
          `${storeId}:${actor?.id ?? 'public'}:${route.id}:${c.req.path}`,
          c.req.header('idempotency-key'),
          await sha256Hex(JSON.stringify(rawBody ?? null)),
          execute,
        )
      : await execute();

    if (response.status === 302) {
      return c.redirect((response.body as { redirect: string }).redirect, 302);
    }
    return c.json(response.body as object, response.status as 200);
  });
}

export function installErrorHandler(app: Hono) {
  app.onError((error, c) => {
    const known = isSellbaseError(error)
      ? error
      : error instanceof z.ZodError
        ? fromZodError(error)
        : fromDbError(error);
    if (!known) console.error('[sellbase-api] unexpected error', error);
    const body = toErrorResponse(known ?? error);
    return c.json(body, statusFor(body.error.code) as 400);
  });
  app.notFound((c) =>
    c.json(
      toErrorResponse(
        sellbaseError(
          'NOT_FOUND',
          `No route for ${c.req.method} ${c.req.path}.`,
          'Check the path against the OpenAPI document at GET /openapi.json.',
        ),
      ),
      404,
    ),
  );
}
