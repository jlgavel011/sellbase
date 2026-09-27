import { routes, sellbaseError, type DiscountUpsertInput } from '@sellbase/core';
import type { Hono } from 'hono';
import type { Sql, TransactionSql } from 'postgres';
import { actorRef, type Actor } from '../auth.js';
import type { Deps } from '../deps.js';
import { notFound } from '../errors.js';
import { register, type AppOptions } from '../http.js';
import { slugify } from './catalog.js';

type Db = Sql | TransactionSql;

const COLLECTION_SELECT = `
  c.id, c.title, c.slug, c.description, c.rule, c.position, c.created_at, c.updated_at,
  coalesce((select array_agg(cp.product_id order by cp.position, cp.product_id)
              from sellbase.collection_products cp where cp.collection_id = c.id), '{}') as product_ids`;

const DISCOUNT_SELECT = `
  id, code::text as code, kind, value, applies_to, min_subtotal_amount, usage_limit, per_customer_limit,
  usage_count, starts_at, ends_at, status, created_at, updated_at`;

async function audit(
  db: Db,
  storeId: string,
  actor: Actor | null,
  action: string,
  entity: string,
  entityId: string,
  diff: object = {},
) {
  const { actor_type, actor_id } = actorRef(actor);
  await db`
    insert into sellbase.audit_log (store_id, actor_type, actor_id, action, entity, entity_id, diff)
    values (${storeId}, ${actor_type}, ${actor_id}, ${action}, ${entity}, ${entityId}, ${db.json(diff as never)})`;
}

async function assertIds(
  db: Db,
  storeId: string,
  table: 'products' | 'collections',
  ids: string[],
) {
  if (ids.length === 0) return;
  const found = await db<{ id: string }[]>`
    select id from ${db('sellbase.' + table)} where store_id = ${storeId} and id = any(${db.array(ids)}::uuid[])`;
  if (found.length !== new Set(ids).size) {
    const missing = ids.filter((x) => !found.some((f) => f.id === x));
    throw sellbaseError(
      'VALIDATION_ERROR',
      `Some ${table} do not exist in this store: ${missing.join(', ')}.`,
      table === 'products'
        ? 'Search products with GET /products and use their ids.'
        : 'List collections with GET /collections and use their ids.',
      { missing },
    );
  }
}

async function loadCollection(db: Db, storeId: string, id: string) {
  const [row] = await db`
    select ${db.unsafe(COLLECTION_SELECT)} from sellbase.collections c where c.id = ${id} and c.store_id = ${storeId}`;
  if (!row) throw notFound('Collection', id, 'List collections with GET /collections.');
  return row as never;
}

async function loadDiscount(db: Db, storeId: string, id: string) {
  const [row] = await db`
    select ${db.unsafe(DISCOUNT_SELECT)} from sellbase.discounts where id = ${id} and store_id = ${storeId}`;
  if (!row) throw notFound('Discount', id, 'List discounts with GET /discounts.');
  return row as never;
}

async function upsertDiscount(
  deps: Deps,
  storeId: string,
  actor: Actor | null,
  input: DiscountUpsertInput,
) {
  const { id: inputId, ...d } = input;
  const appliesTo = d.applies_to;
  return deps.sql.begin(async (tx) => {
    if (appliesTo.type === 'products')
      await assertIds(tx, storeId, 'products', appliesTo.product_ids);
    if (appliesTo.type === 'collections')
      await assertIds(tx, storeId, 'collections', appliesTo.collection_ids);
    const values = {
      code: d.code,
      kind: d.kind,
      value: d.kind === 'free_shipping' ? 0 : d.value,
      applies_to: tx.json(appliesTo as never),
      min_subtotal_amount: d.min_subtotal_amount,
      usage_limit: d.usage_limit,
      per_customer_limit: d.per_customer_limit,
      starts_at: d.starts_at,
      ends_at: d.ends_at,
      status: d.status,
    };
    let id: string;
    if (inputId) {
      const [row] = await tx<{ id: string }[]>`
        update sellbase.discounts set ${tx(values)} where id = ${inputId} and store_id = ${storeId} returning id`;
      if (!row) throw notFound('Discount', inputId, 'List discounts with GET /discounts.');
      id = row.id;
    } else {
      const [row] = await tx<{ id: string }[]>`
        insert into sellbase.discounts ${tx({ ...values, store_id: storeId })} returning id`;
      if (!row) throw new Error('discount insert returned no row');
      id = row.id;
    }
    await audit(
      tx,
      storeId,
      actor,
      inputId ? 'discount.update' : 'discount.create',
      'discount',
      id,
      {
        input,
      },
    );
    return loadDiscount(tx, storeId, id);
  });
}

export function registerMerchandising(app: Hono, deps: Deps, options: AppOptions) {
  const { sql } = deps;

  // ── Collections ──────────────────────────────────────────────────────────
  register(app, deps, options, routes.collectionsList, async ({ storeId }) => {
    const rows = await sql`
      select ${sql.unsafe(COLLECTION_SELECT)} from sellbase.collections c
       where c.store_id = ${storeId} order by c.position, c.title`;
    return { data: rows as never };
  });

  register(app, deps, options, routes.collectionUpsert, ({ storeId, actor, body }) =>
    sql.begin(async (tx) => {
      const values = {
        title: body.title,
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.position !== undefined ? { position: body.position } : {}),
      };
      let id: string;
      if (body.id) {
        const [row] = await tx<{ id: string }[]>`
          update sellbase.collections set ${tx({ ...values, ...(body.slug ? { slug: body.slug } : {}) })}
           where id = ${body.id} and store_id = ${storeId} returning id`;
        if (!row) throw notFound('Collection', body.id, 'List collections with GET /collections.');
        id = row.id;
      } else {
        const [row] = await tx<{ id: string }[]>`
          insert into sellbase.collections ${tx({ ...values, store_id: storeId, slug: body.slug ?? slugify(body.title) })}
          returning id`;
        if (!row) throw new Error('collection insert returned no row');
        id = row.id;
      }
      if (body.product_ids) {
        await assertIds(tx, storeId, 'products', body.product_ids);
        await tx`delete from sellbase.collection_products where collection_id = ${id}`;
        for (const [position, productId] of [...new Set(body.product_ids)].entries()) {
          await tx`
            insert into sellbase.collection_products (collection_id, product_id, store_id, position)
            values (${id}, ${productId}, ${storeId}, ${position})`;
        }
      }
      await audit(
        tx,
        storeId,
        actor,
        body.id ? 'collection.update' : 'collection.create',
        'collection',
        id,
        {
          input: body,
        },
      );
      return loadCollection(tx, storeId, id);
    }),
  );

  register(app, deps, options, routes.collectionDelete, async ({ storeId, actor, params }) => {
    const [row] = await sql<{ id: string }[]>`
      delete from sellbase.collections where id = ${params.id} and store_id = ${storeId} returning id`;
    if (!row) throw notFound('Collection', params.id, 'List collections with GET /collections.');
    await audit(sql, storeId, actor, 'collection.delete', 'collection', params.id);
    return { id: params.id, deleted: true as const };
  });

  // ── Discounts ────────────────────────────────────────────────────────────
  register(app, deps, options, routes.discountsList, async ({ storeId, query }) => {
    const rows = await sql`
      select ${sql.unsafe(DISCOUNT_SELECT)} from sellbase.discounts
       where store_id = ${storeId}
         ${query.status ? sql`and status = ${query.status}` : sql``}
         ${query.q ? sql`and code ilike ${'%' + query.q + '%'}` : sql``}
       order by created_at desc`;
    return { data: rows as never };
  });

  register(app, deps, options, routes.discountUpsert, ({ storeId, actor, body }) =>
    upsertDiscount(deps, storeId, actor, body),
  );

  register(app, deps, options, routes.discountDelete, ({ storeId, actor, params }) =>
    sql.begin(async (tx) => {
      const [row] = await tx<{ id: string; used: boolean }[]>`
        select id, usage_count > 0 or exists (
                 select 1 from sellbase.discount_redemptions r where r.discount_id = d.id) as used
          from sellbase.discounts d where id = ${params.id} and store_id = ${storeId} for update`;
      if (!row) throw notFound('Discount', params.id, 'List discounts with GET /discounts.');
      if (row.used) {
        await tx`update sellbase.discounts set status = 'disabled' where id = ${params.id}`;
        await audit(tx, storeId, actor, 'discount.disable', 'discount', params.id);
        return { id: params.id, deleted: false, status: 'disabled' as const };
      }
      await tx`delete from sellbase.discounts where id = ${params.id}`;
      await audit(tx, storeId, actor, 'discount.delete', 'discount', params.id);
      return { id: params.id, deleted: true, status: 'disabled' as const };
    }),
  );
}
