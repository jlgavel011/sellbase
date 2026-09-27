import {
  DEFAULT_AGENT_SCOPES,
  routes,
  sellbaseError,
  type ApiScope,
  type StaffRole,
} from '@sellbase/core';
import type { Hono } from 'hono';
import type { Sql, TransactionSql } from 'postgres';
import { actorRef, createApiToken, type Actor } from '../auth.js';
import type { Deps } from '../deps.js';
import { notFound } from '../errors.js';
import { register, type AppOptions } from '../http.js';
import { decodeCursor, encodeCursor } from '../pagination.js';

type Db = Sql | TransactionSql;

const MEMBER_SELECT = `
  m.user_id, u.email::text as email, m.role, u.last_sign_in_at,
  (u.invited_at is not null and u.last_sign_in_at is null) as invited, m.created_at`;

const TOKEN_SELECT = `
  t.id, t.name, t.prefix, t.scopes, t.created_at, t.last_used_at, t.expires_at, t.revoked_at,
  (select count(*)::int from sellbase.audit_log a
    where a.store_id = t.store_id and a.actor_type = 'token' and a.actor_id = t.id::text
      and a.created_at > now() - interval '30 days') as actions_30d`;

async function loadMember(db: Db, storeId: string, userId: string) {
  const [row] = await db`
    select ${db.unsafe(MEMBER_SELECT)} from sellbase.staff_members m join auth.users u on u.id = m.user_id
     where m.store_id = ${storeId} and m.user_id = ${userId}`;
  if (!row) throw notFound('Team member', userId, 'List the team with GET /team.');
  return row as never;
}

async function loadToken(db: Db, storeId: string, id: string) {
  const [row] = await db`
    select ${db.unsafe(TOKEN_SELECT)} from sellbase.api_tokens t where t.id = ${id} and t.store_id = ${storeId}`;
  if (!row) throw notFound('API token', id, 'List tokens with GET /tokens.');
  return row as never;
}

async function audit(
  db: Db,
  storeId: string,
  actor: Actor | null,
  action: string,
  entity: string,
  entityId: string | null,
  diff: object,
) {
  const { actor_type, actor_id } = actorRef(actor);
  await db`
    insert into sellbase.audit_log (store_id, actor_type, actor_id, action, entity, entity_id, diff)
    values (${storeId}, ${actor_type}, ${actor_id}, ${action}, ${entity}, ${entityId}, ${db.json(diff as never)})`;
}

/** Only owners hand out or take away ownership; tokens never do. */
function assertCanManage(actor: Actor | null, roles: StaffRole[]) {
  if (!roles.includes('owner')) return;
  if (actor?.type === 'staff' && actor.role === 'owner') return;
  throw sellbaseError(
    'FORBIDDEN',
    'Only an owner can add, change or remove owners.',
    'Ask an owner of the store to do it.',
  );
}

async function assertKeepsAnOwner(tx: TransactionSql, storeId: string, userId: string) {
  const [row] = await tx<{ owners: number }[]>`
    select count(*)::int as owners from sellbase.staff_members
     where store_id = ${storeId} and role = 'owner' and user_id <> ${userId}`;
  if ((row?.owners ?? 0) === 0) {
    throw sellbaseError(
      'VALIDATION_ERROR',
      'The store must keep at least one owner.',
      'Make someone else owner first.',
    );
  }
}

export function registerTeam(app: Hono, deps: Deps, options: AppOptions) {
  const { sql } = deps;

  register(app, deps, options, routes.teamList, async ({ storeId }) => {
    const rows = await sql`
      select ${sql.unsafe(MEMBER_SELECT)} from sellbase.staff_members m join auth.users u on u.id = m.user_id
       where m.store_id = ${storeId}
       order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, m.created_at`;
    return { data: rows as never };
  });

  register(app, deps, options, routes.teamInvite, async ({ storeId, actor, body }) => {
    assertCanManage(actor, [body.role]);
    const [existing] = await sql<
      { id: string }[]
    >`select id from auth.users where lower(email) = lower(${body.email})`;
    const userId = existing?.id ?? (await deps.inviteUser(body.email, body.redirect_to));
    await sql.begin(async (tx) => {
      const [member] = await tx`
        select 1 from sellbase.staff_members where store_id = ${storeId} and user_id = ${userId}`;
      if (member) {
        throw sellbaseError(
          'VALIDATION_ERROR',
          `${body.email} is already on the team.`,
          'Change their role with PATCH /team/:user_id instead.',
        );
      }
      await tx`insert into sellbase.staff_members (store_id, user_id, role) values (${storeId}, ${userId}, ${body.role})`;
      await audit(tx, storeId, actor, 'team.invite', 'staff_member', userId, {
        email: body.email,
        role: body.role,
      });
    });
    return loadMember(sql, storeId, userId);
  });

  register(app, deps, options, routes.teamUpdate, ({ storeId, actor, params, body }) =>
    sql.begin(async (tx) => {
      const [current] = await tx<{ role: StaffRole }[]>`
        select role from sellbase.staff_members where store_id = ${storeId} and user_id = ${params.user_id} for update`;
      if (!current) throw notFound('Team member', params.user_id, 'List the team with GET /team.');
      assertCanManage(actor, [current.role, body.role]);
      if (current.role === 'owner' && body.role !== 'owner')
        await assertKeepsAnOwner(tx, storeId, params.user_id);
      await tx`update sellbase.staff_members set role = ${body.role} where store_id = ${storeId} and user_id = ${params.user_id}`;
      await audit(tx, storeId, actor, 'team.role_change', 'staff_member', params.user_id, {
        from: current.role,
        to: body.role,
      });
      return loadMember(tx, storeId, params.user_id);
    }),
  );

  register(app, deps, options, routes.teamRemove, ({ storeId, actor, params }) =>
    sql.begin(async (tx) => {
      const [current] = await tx<{ role: StaffRole }[]>`
        select role from sellbase.staff_members where store_id = ${storeId} and user_id = ${params.user_id} for update`;
      if (!current) throw notFound('Team member', params.user_id, 'List the team with GET /team.');
      assertCanManage(actor, [current.role]);
      if (current.role === 'owner') await assertKeepsAnOwner(tx, storeId, params.user_id);
      await tx`delete from sellbase.staff_members where store_id = ${storeId} and user_id = ${params.user_id}`;
      await audit(tx, storeId, actor, 'team.remove', 'staff_member', params.user_id, {
        role: current.role,
      });
      return { user_id: params.user_id, removed: true as const };
    }),
  );

  register(app, deps, options, routes.tokensList, async ({ storeId }) => {
    const rows = await sql`
      select ${sql.unsafe(TOKEN_SELECT)} from sellbase.api_tokens t
       where t.store_id = ${storeId} order by t.revoked_at is not null, t.created_at desc`;
    return { data: rows as never };
  });

  register(app, deps, options, routes.tokenCreate, async ({ storeId, actor, body }) => {
    const scopes: ApiScope[] = [...new Set(body.scopes ?? DEFAULT_AGENT_SCOPES)];
    if (actor?.type === 'token') {
      const extra = scopes.filter((s) => !actor.scopes.includes(s));
      if (extra.length) {
        throw sellbaseError(
          'FORBIDDEN',
          `A token cannot create tokens with scopes it does not have: ${extra.join(', ')}.`,
          'Ask the store owner to create it from Admin → Settings → AI agents.',
          { missing: extra },
        );
      }
    }
    const created = await createApiToken(deps, {
      storeId,
      name: body.name,
      scopes,
      createdBy: actor?.type === 'staff' ? actor.id : null,
    });
    if (body.expires_in_days) {
      await sql`update sellbase.api_tokens set expires_at = now() + ${`${body.expires_in_days} days`}::interval where id = ${created.id}`;
    }
    await audit(sql, storeId, actor, 'token.create', 'api_token', created.id, {
      name: body.name,
      scopes,
    });
    const view = (await loadToken(sql, storeId, created.id)) as object;
    return { ...view, token: created.token } as never;
  });

  register(app, deps, options, routes.tokenRevoke, async ({ storeId, actor, params }) => {
    const [row] = await sql`
      update sellbase.api_tokens set revoked_at = coalesce(revoked_at, now())
       where id = ${params.id} and store_id = ${storeId} returning id`;
    if (!row) throw notFound('API token', params.id, 'List tokens with GET /tokens.');
    await audit(sql, storeId, actor, 'token.revoke', 'api_token', params.id, {});
    return loadToken(sql, storeId, params.id);
  });

  register(app, deps, options, routes.auditList, async ({ storeId, query }) => {
    const after = decodeCursor(query.cursor);
    const rows = await sql<{ id: string; created_at: Date }[]>`
      select a.id, a.actor_type, a.actor_id,
             case a.actor_type
               when 'token' then (select t.name from sellbase.api_tokens t where t.id::text = a.actor_id)
               when 'staff' then (select u.email::text from auth.users u where u.id::text = a.actor_id)
               else a.actor_id end as actor_name,
             a.action, a.entity, a.entity_id, a.diff, a.created_at
        from sellbase.audit_log a
       where a.store_id = ${storeId}
         ${query.actor_type ? sql`and a.actor_type = ${query.actor_type}` : sql``}
         ${query.actor_id ? sql`and a.actor_id = ${query.actor_id}` : sql``}
         ${query.entity ? sql`and a.entity = ${query.entity}` : sql``}
         ${after ? sql`and (a.created_at, a.id) < (${after.at}, ${after.id})` : sql``}
       order by a.created_at desc, a.id desc limit ${query.limit + 1}`;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: page as never,
      next_cursor:
        rows.length > query.limit && last ? encodeCursor(last.created_at, last.id) : null,
    };
  });
}
