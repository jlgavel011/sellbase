import {
  mulDivRound,
  productsFromCsv,
  productUpsertInput,
  routes,
  sellbaseError,
  type CsvProduct,
  type CsvRowError,
  type ProductUpsertInput,
} from '@sellbase/core';
import type { Hono } from 'hono';
import { actorRef } from '../auth.js';
import type { Deps } from '../deps.js';
import { fromDbError } from '../errors.js';
import { register, type AppOptions } from '../http.js';
import { loadStore } from '../pricing-context.js';
import { upsertProduct } from './catalog.js';

interface Existing {
  id: string;
  type: CsvProduct['type'];
  variants: { id: string; sku: string | null }[];
}

/** Maps a CSV product onto an upsert input; existing variants are matched by SKU. */
function toUpsertInput(p: CsvProduct, existing: Existing | null): ProductUpsertInput {
  const bySku = new Map(existing?.variants.filter((v) => v.sku).map((v) => [v.sku, v.id]));
  const onlyOne =
    existing?.variants.length === 1 && p.variants.length === 1 ? existing.variants[0]?.id : null;
  return productUpsertInput.parse({
    ...(existing ? { id: existing.id } : {}),
    type: existing?.type ?? p.type,
    title: p.title,
    slug: p.slug,
    ...(p.description ? { description: p.description } : {}),
    status: p.status,
    ...(p.tags.length ? { tags: p.tags } : {}),
    ...(p.options.length ? { options: p.options } : {}),
    variants: p.variants.map((v) => {
      const id = (v.sku && bySku.get(v.sku)) || onlyOne;
      return {
        ...(id ? { id } : {}),
        sku: v.sku,
        title: v.title,
        option_values: v.option_values,
        price_amount: v.price_amount,
        compare_at_amount: v.compare_at_amount,
        ...(v.stock !== null ? { inventory: { on_hand: v.stock } } : {}),
        ...(v.physical ? { physical: v.physical } : {}),
      };
    }),
  });
}

export function registerCatalogBulk(app: Hono, deps: Deps, options: AppOptions) {
  const { sql } = deps;

  register(app, deps, options, routes.productsImport, async ({ storeId, actor, body }) => {
    const store = await loadStore(sql, storeId);
    const parsed = productsFromCsv(body.csv, store.default_currency);
    const errors: CsvRowError[] = [...parsed.errors];
    const result: {
      id: string | null;
      slug: string;
      title: string;
      action: 'create' | 'update';
      variants: number;
    }[] = [];

    for (const p of parsed.products) {
      const [found] = await sql<{ id: string; type: CsvProduct['type'] }[]>`
        select id, type from sellbase.products where store_id = ${storeId} and slug = ${p.slug}`;
      const existing: Existing | null = found
        ? {
            ...found,
            variants: await sql<{ id: string; sku: string | null }[]>`
              select id, sku from sellbase.variants where product_id = ${found.id} and status <> 'archived'`,
          }
        : null;
      let input: ProductUpsertInput;
      try {
        input = toUpsertInput(p, existing);
      } catch (error) {
        errors.push({
          row: p.row,
          message: `"${p.title}": ${error instanceof Error ? error.message.split('\n')[0] : 'invalid product'}`,
          hint: 'Fix the row and import again.',
        });
        continue;
      }
      const action = existing ? 'update' : 'create';
      if (body.dry_run) {
        result.push({
          id: existing?.id ?? null,
          slug: p.slug,
          title: p.title,
          action,
          variants: p.variants.length,
        });
        continue;
      }
      try {
        const product = (await upsertProduct(deps, storeId, actor, input)) as unknown as {
          id: string;
          media: unknown[];
        };
        if (p.images.length && product.media.length === 0) {
          for (const [position, url] of p.images.entries()) {
            await sql`
              insert into sellbase.product_media (store_id, product_id, url, alt, position)
              values (${storeId}, ${product.id}, ${url}, ${p.title}, ${position})`;
          }
        }
        result.push({
          id: product.id,
          slug: p.slug,
          title: p.title,
          action,
          variants: p.variants.length,
        });
      } catch (error) {
        const known = fromDbError(error);
        errors.push({
          row: p.row,
          message: `"${p.title}": ${known?.message ?? (error instanceof Error ? error.message : 'failed')}`,
          hint: known?.hint || 'Fix the row and import again.',
        });
      }
    }

    if (!body.dry_run && result.length) {
      const { actor_type, actor_id } = actorRef(actor);
      await sql`
        insert into sellbase.audit_log (store_id, actor_type, actor_id, action, entity, diff)
        values (${storeId}, ${actor_type}, ${actor_id}, 'product.import', 'product',
                ${sql.json({ products: result.map((r) => r.slug), errors: errors.length } as never)})`;
    }
    return {
      dry_run: body.dry_run,
      created: result.filter((r) => r.action === 'create').length,
      updated: result.filter((r) => r.action === 'update').length,
      products: result,
      errors: errors.sort((a, b) => a.row - b.row),
    };
  });

  register(app, deps, options, routes.productsBulk, async ({ storeId, actor, body }) => {
    const ids = [...new Set(body.product_ids)];
    const { actor_type, actor_id } = actorRef(actor);

    if (body.action !== 'price') {
      const status = { publish: 'active', draft: 'draft', archive: 'archived' }[body.action];
      return sql.begin(async (tx) => {
        const updated = await tx<{ id: string }[]>`
          update sellbase.products set status = ${status}
           where store_id = ${storeId} and id = any(${tx.array(ids)}::uuid[]) returning id`;
        for (const row of updated) {
          await tx`
            insert into sellbase.audit_log (store_id, actor_type, actor_id, action, entity, entity_id, diff)
            values (${storeId}, ${actor_type}, ${actor_id}, 'product.bulk_status', 'product', ${row.id},
                    ${tx.json({ status } as never)})`;
          await tx`select sellbase.emit_event(${storeId}, 'product.updated', 'product', ${row.id})`;
        }
        return { applied: true, updated: updated.length, preview: [] };
      });
    }

    const price = body.price;
    if (!price) {
      throw sellbaseError(
        'VALIDATION_ERROR',
        'action "price" needs price.',
        'Send price: { mode: "percent", value: -1000 } for 10% off, or mode "set"/"amount" in minor units.',
      );
    }
    const variants = await sql<
      { product_id: string; variant_id: string; title: string; price_amount: number }[]
    >`
      select p.id as product_id, v.id as variant_id,
             p.title || case when v.title = 'Default' then '' else ' · ' || v.title end as title, v.price_amount
        from sellbase.variants v join sellbase.products p on p.id = v.product_id
       where p.store_id = ${storeId} and p.id = any(${sql.array(ids)}::uuid[]) and v.status <> 'archived'
       order by p.title, v.position`;
    const preview = variants.map((v) => {
      const to =
        price.mode === 'set'
          ? price.value
          : price.mode === 'amount'
            ? v.price_amount + price.value
            : mulDivRound(v.price_amount, 10_000 + price.value, 10_000);
      if (to < 0) {
        throw sellbaseError(
          'INVALID_AMOUNT',
          `"${v.title}" would cost less than zero.`,
          'Use a smaller decrease.',
          { variant_id: v.variant_id, from_amount: v.price_amount, to_amount: to },
        );
      }
      return {
        product_id: v.product_id,
        variant_id: v.variant_id,
        title: v.title,
        from_amount: v.price_amount,
        to_amount: to,
      };
    });
    if (body.confirm !== true) return { applied: false, updated: 0, preview };

    await sql.begin(async (tx) => {
      for (const p of preview) {
        await tx`update sellbase.variants set price_amount = ${p.to_amount} where id = ${p.variant_id}`;
        await tx`
          insert into sellbase.audit_log (store_id, actor_type, actor_id, action, entity, entity_id, diff)
          values (${storeId}, ${actor_type}, ${actor_id}, 'variant.bulk_price', 'variant', ${p.variant_id},
                  ${tx.json({ from_amount: p.from_amount, to_amount: p.to_amount } as never)})`;
      }
      for (const productId of new Set(preview.map((p) => p.product_id))) {
        await tx`select sellbase.emit_event(${storeId}, 'product.updated', 'product', ${productId})`;
      }
    });
    return { applied: true, updated: preview.length, preview };
  });
}
