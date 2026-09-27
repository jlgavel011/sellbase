import {
  BRAND,
  sellbaseError,
  type ApiScope,
  type RouteAuth,
  type StaffRole,
} from '@sellbase/core';
import type { Deps } from './deps.js';

export type Actor =
  | { type: 'staff'; id: string; storeId: string; role: StaffRole }
  | { type: 'token'; id: string; storeId: string; scopes: ApiScope[] };

export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Creates an API token; only its hash is stored. Returns the plain token once. */
export async function createApiToken(
  deps: Deps,
  input: { storeId: string; name: string; scopes: readonly ApiScope[]; createdBy?: string | null },
): Promise<{ id: string; token: string }> {
  const token = `${BRAND.tokenPrefix}${randomToken()}`;
  const [row] = await deps.sql<{ id: string }[]>`
    insert into sellbase.api_tokens (store_id, name, token_hash, prefix, scopes, created_by)
    values (${input.storeId}, ${input.name}, ${await sha256Hex(token)}, ${token.slice(0, 12)},
            ${deps.sql.array([...input.scopes])}, ${input.createdBy ?? null})
    returning id`;
  if (!row) throw new Error('token insert returned no row');
  return { id: row.id, token };
}

export async function resolveActor(
  deps: Deps,
  authorization: string | undefined,
): Promise<Actor | null> {
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
  const credential = match?.[1]?.trim();
  if (!credential) return null;
  const storeId = await deps.storeId();

  if (credential.startsWith(BRAND.tokenPrefix)) {
    const [row] = await deps.sql<{ id: string; scopes: ApiScope[] }[]>`
      update sellbase.api_tokens set last_used_at = now()
       where token_hash = ${await sha256Hex(credential)} and store_id = ${storeId}
         and revoked_at is null and (expires_at is null or expires_at > now())
      returning id, scopes`;
    if (!row) {
      throw sellbaseError(
        'UNAUTHORIZED',
        'The API token is invalid, revoked or expired.',
        'Create a new token with `sellbase token create` or in Admin → Settings → AI agents.',
      );
    }
    return { type: 'token', id: row.id, storeId, scopes: row.scopes };
  }

  const userId = await deps.verifyUserJwt(credential);
  if (!userId) {
    throw sellbaseError('UNAUTHORIZED', 'The session is invalid or expired.', 'Sign in again.');
  }
  const [staff] = await deps.sql<{ role: StaffRole }[]>`
    select role from sellbase.staff_members where store_id = ${storeId} and user_id = ${userId}`;
  if (!staff) {
    throw sellbaseError(
      'FORBIDDEN',
      'This user is not a member of the store team.',
      'Ask the store owner to invite you from Admin → Settings → Team.',
    );
  }
  return { type: 'staff', id: userId, storeId, role: staff.role };
}

/** Scopes that staff members need owner/admin for. */
const ADMIN_SCOPES: readonly ApiScope[] = [
  'refunds:write',
  'settings:write',
  'integrations:write',
  'webhooks:write',
];

export function authorize(actor: Actor | null, auth: RouteAuth): Actor | null {
  if (auth.kind === 'public') return actor;
  if (!actor) {
    throw sellbaseError(
      'UNAUTHORIZED',
      'This endpoint needs authentication.',
      `Send "Authorization: Bearer <token>" with a staff session or an API token (${BRAND.tokenPrefix}…).`,
    );
  }
  const { scope } = auth;
  if (!scope) return actor;
  if (actor.type === 'token' && !actor.scopes.includes(scope)) {
    throw sellbaseError(
      'FORBIDDEN',
      `This token lacks the "${scope}" scope.`,
      `Ask the store owner to create a token that includes "${scope}".`,
      { required_scope: scope, token_scopes: actor.scopes },
    );
  }
  if (actor.type === 'staff' && ADMIN_SCOPES.includes(scope) && actor.role === 'staff') {
    throw sellbaseError(
      'FORBIDDEN',
      `Only owners and admins can do this (${scope}).`,
      'Ask an owner or admin of the store to do it or to change your role.',
      { required_scope: scope, role: actor.role },
    );
  }
  return actor;
}

export const actorRef = (actor: Actor | null) =>
  actor ? { actor_type: actor.type, actor_id: actor.id } : { actor_type: 'system', actor_id: null };
