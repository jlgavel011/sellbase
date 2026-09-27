import { routes, sellbaseError, slugify, type ProductUpsertInput } from '@sellbase/core';
import type { Hono } from 'hono';
import type { Sql, TransactionSql } from 'postgres';
import { actorRef, type Actor } from '../auth.js';
import type { Deps } from '../deps.js';
import { notFound } from '../errors.js';
import { register, type AppOptions } from '../http.js';
import { decodeCursor, encodeCursor } from '../pagination.js';
import { loadStore } from '../pricing-context.js';

type Db = Sql | TransactionSql;

const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  zip: 'application/zip',
  epub: 'application/epub+zip',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  csv: 'text/csv',
};

export function contentTypeFor(fileName: string): string {
  return (
    CONTENT_TYPES[fileName.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
  );
}

export function safeFileName(fileName: string): string {
  return (
    fileName
      .normalize('NFKD')
      .replace(/[^\w.-]+/g, '-')
      .replace(/-+/g, '-')
      .slice(-120) || 'file'
  );
}

function decodeBase64(content: string, maxBytes: number): Uint8Array {
  let binary: string;
  try {
    binary = atob(content.replace(/^data:[^,]*,/, ''));
  } catch {
    throw sellbaseError(
      'VALIDATION_ERROR',
      'content_base64 is not valid base64.',
      'Encode the file bytes as base64 (without line breaks).',
    );
  }
  if (binary.length > maxBytes) {
    throw sellbaseError(
      'VALIDATION_ERROR',
      `The file is larger than ${Math.round(maxBytes / 1_000_000)} MB.`,
      'Compress the file or host it elsewhere and link it.',
      { size_bytes: binary.length },
    );
  }
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

/** Full product for admin/agent views: variants with inventory and specs, plus media. */
export async function loadAdminProduct(sql: Db, storeId: string, id: string) {
  const [product] = await sql`
    select id, type, title, slug, description, status, seo, tags, metadata, created_at, updated_at
      from sellbase.products where id = ${id} and store_id = ${storeId}`;
  if (!product) throw notFound('Product', id, 'Search products with GET /products.');
  const variants = await sql`
    select v.id, v.product_id, v.sku, v.title, v.option_values, v.price_amount, v.compare_at_amount,
           v.currency::text as currency, v.status, v.position, v.created_at, v.updated_at,
           (select jsonb_build_object('on_hand', sum(il.on_hand), 'reserved', sum(il.reserved),
                                      'policy', min(il.policy))
              from sellbase.inventory_levels il where il.variant_id = v.id
            having count(*) > 0) as inventory,
           (select jsonb_build_object('weight_g', ps.weight_g, 'length_cm', ps.length_cm::float8,
                                      'width_cm', ps.width_cm::float8, 'height_cm', ps.height_cm::float8,
                                      'requires_shipping', ps.requires_shipping)
              from sellbase.physical_specs ps where ps.variant_id = v.id) as physical,
           coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'file_name', a.file_name, 'size_bytes', a.size_bytes))
                       from sellbase.digital_assets a where a.variant_id = v.id), '[]') as digital_assets,
           (select jsonb_build_object('duration_min', s.duration_min, 'buffer_before_min', s.buffer_before_min,
                                      'buffer_after_min', s.buffer_after_min, 'capacity', s.capacity,
                                      'deposit_amount', s.deposit_amount, 'location_type', s.location_type,
                                      'online_meeting_url', s.online_meeting_url, 'booking_window_days', s.booking_window_days,
                                      'min_notice_min', s.min_notice_min, 'slot_interval_min', s.slot_interval_min)
              from sellbase.service_specs s where s.variant_id = v.id) as service
      from sellbase.variants v where v.product_id = ${id}
     order by v.position, v.created_at`;
  const media = await sql`
    select id, url, alt, position from sellbase.product_media where product_id = ${id} order by position`;
  const resources = await sql<{ resource_id: string }[]>`
    select resource_id from sellbase.service_resources where product_id = ${id}`;
  return {
    ...product,
    variants,
    media,
    resource_ids: resources.map((r) => r.resource_id),
  } as never;
}

async function uniqueSlug(tx: Db, storeId: string, base: string, exceptId: string | null) {
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const [taken] = await tx`
      select 1 from sellbase.products where store_id = ${storeId} and slug = ${candidate}
         and (${exceptId}::uuid is null or id <> ${exceptId}::uuid)`;
    if (!taken) return candidate;
  }
  throw sellbaseError('VALIDATION_ERROR', `Slug "${base}" is taken.`, 'Send a different slug.');
}

/** Creates or updates a whole product in one transaction (SPEC §13.2 product_upsert). */
export async function upsertProduct(
  deps: Deps,
  storeId: string,
  actor: Actor | null,
  input: ProductUpsertInput,
) {
  const store = await loadStore(deps.sql, storeId);
  const currency = input.currency ?? store.default_currency;

  const productId = await deps.sql.begin(async (tx) => {
    let existing: { id: string; slug: string } | undefined;
    if (input.id) {
      [existing] = await tx<{ id: string; slug: string }[]>`
        select id, slug from sellbase.products where id = ${input.id} and store_id = ${storeId} for update`;
      if (!existing) throw notFound('Product', input.id, 'Omit id to create a new product.');
    }
    const slug = input.slug
      ? await uniqueSlug(tx, storeId, input.slug, existing?.id ?? null)
      : (existing?.slug ?? (await uniqueSlug(tx, storeId, slugify(input.title), null)));

    const [row] = await tx<{ id: string }[]>`
      insert into sellbase.products (id, store_id, type, title, slug, description, status, tags, metadata)
      values (${existing?.id ?? crypto.randomUUID()}, ${storeId}, ${input.type}, ${input.title}, ${slug},
              ${input.description ?? ''}, ${input.status}, ${tx.array(input.tags ?? [])},
              ${tx.json((input.metadata ?? {}) as never)})
      on conflict (id) do update set
        type = excluded.type, title = excluded.title, slug = excluded.slug, status = excluded.status,
        description = ${input.description === undefined ? tx`sellbase.products.description` : tx`excluded.description`},
        tags = ${input.tags === undefined ? tx`sellbase.products.tags` : tx`excluded.tags`},
        metadata = ${input.metadata === undefined ? tx`sellbase.products.metadata` : tx`sellbase.products.metadata || excluded.metadata`}
      returning id`;
    if (!row) throw new Error('product upsert returned no row');
    const id = row.id;

    if (input.options) {
      await tx`delete from sellbase.product_options where product_id = ${id}`;
      for (const [position, option] of input.options.entries()) {
        const [opt] = await tx<{ id: string }[]>`
          insert into sellbase.product_options (store_id, product_id, name, position)
          values (${storeId}, ${id}, ${option.name}, ${position}) returning id`;
        for (const [valuePosition, value] of option.values.entries()) {
          await tx`insert into sellbase.product_option_values (store_id, option_id, value, position)
                   values (${storeId}, ${opt?.id ?? null}, ${value}, ${valuePosition})`;
        }
      }
    }

    const keep: string[] = [];
    for (const [position, v] of input.variants.entries()) {
      let variantId: string;
      if (v.id) {
        const [updated] = await tx<{ id: string }[]>`
          update sellbase.variants set
            sku = ${v.sku === undefined ? tx`sku` : tx`${v.sku}`}, title = ${v.title},
            option_values = ${tx.json(v.option_values as never)}, price_amount = ${v.price_amount},
            compare_at_amount = ${v.compare_at_amount ?? null}, currency = ${currency},
            status = 'active', position = ${position}
          where id = ${v.id} and product_id = ${id} returning id`;
        if (!updated)
          throw notFound(
            'Variant',
            v.id,
            'Omit the variant id to create it, or use an id from GET /products/:id.',
          );
        variantId = updated.id;
      } else {
        const [created] = await tx<{ id: string }[]>`
          insert into sellbase.variants (store_id, product_id, sku, title, option_values, price_amount,
                                         compare_at_amount, currency, position)
          values (${storeId}, ${id}, ${v.sku ?? null}, ${v.title}, ${tx.json(v.option_values as never)},
                  ${v.price_amount}, ${v.compare_at_amount ?? null}, ${currency}, ${position})
          returning id`;
        if (!created) throw new Error('variant insert returned no row');
        variantId = created.id;
      }
      keep.push(variantId);

      if (v.physical) {
        await tx`
          insert into sellbase.physical_specs (variant_id, store_id, weight_g, length_cm, width_cm, height_cm,
                                               requires_shipping, hs_code)
          values (${variantId}, ${storeId}, ${v.physical.weight_g}, ${v.physical.length_cm}, ${v.physical.width_cm},
                  ${v.physical.height_cm}, ${v.physical.requires_shipping}, ${v.physical.hs_code})
          on conflict (variant_id) do update set weight_g = excluded.weight_g, length_cm = excluded.length_cm,
            width_cm = excluded.width_cm, height_cm = excluded.height_cm,
            requires_shipping = excluded.requires_shipping, hs_code = excluded.hs_code`;
      }
      if (v.service) {
        await tx`
          insert into sellbase.service_specs (variant_id, store_id, duration_min, buffer_before_min, buffer_after_min, capacity,
                                              deposit_amount, location_type, online_meeting_url, booking_window_days,
                                              min_notice_min, slot_interval_min)
          values (${variantId}, ${storeId}, ${v.service.duration_min}, ${v.service.buffer_before_min}, ${v.service.buffer_after_min},
                  ${v.service.capacity}, ${v.service.deposit_amount}, ${v.service.location_type}, ${v.service.online_meeting_url},
                  ${v.service.booking_window_days}, ${v.service.min_notice_min}, ${v.service.slot_interval_min})
          on conflict (variant_id) do update set duration_min = excluded.duration_min, buffer_before_min = excluded.buffer_before_min,
            buffer_after_min = excluded.buffer_after_min, capacity = excluded.capacity, deposit_amount = excluded.deposit_amount,
            location_type = excluded.location_type, online_meeting_url = excluded.online_meeting_url,
            booking_window_days = excluded.booking_window_days, min_notice_min = excluded.min_notice_min,
            slot_interval_min = excluded.slot_interval_min`;
      }
      if (v.inventory) {
        const [current] = await tx<{ on_hand: number }[]>`
          select coalesce(sum(on_hand), 0)::int as on_hand from sellbase.inventory_levels where variant_id = ${variantId}`;
        const delta = v.inventory.on_hand - (current?.on_hand ?? 0);
        const { actor_type, actor_id } = actorRef(actor);
        await tx`select sellbase.adjust_inventory(${variantId}, ${delta}, 'product_upsert', ${actor_type}, ${actor_id}, ${v.inventory.policy})`;
      }
    }
    if (input.resource_ids) {
      const found = await tx<{ id: string }[]>`
        select id from sellbase.resources where store_id = ${storeId} and id = any(${tx.array(input.resource_ids)}::uuid[])`;
      if (found.length !== new Set(input.resource_ids).size) {
        throw sellbaseError(
          'VALIDATION_ERROR',
          'Some resource_ids do not exist in this store.',
          'Create them first with POST /resources (or service_setup).',
        );
      }
      await tx`delete from sellbase.service_resources where product_id = ${id}`;
      for (const r of found) {
        await tx`insert into sellbase.service_resources (store_id, product_id, resource_id) values (${storeId}, ${id}, ${r.id})`;
      }
    }
    await tx`
      update sellbase.variants set status = 'archived'
       where product_id = ${id} and not (id = any(${tx.array(keep)}::uuid[]))`;

    const { actor_type, actor_id } = actorRef(actor);
    await tx`
      insert into sellbase.audit_log (store_id, actor_type, actor_id, action, entity, entity_id, diff)
      values (${storeId}, ${actor_type}, ${actor_id}, ${existing ? 'product.update' : 'product.create'},
              'product', ${id}, ${tx.json({ input } as never)})`;
    await tx`select sellbase.emit_event(${storeId}, ${existing ? 'product.updated' : 'product.created'}, 'product', ${id})`;
    return id;
  });

  return loadAdminProduct(deps.sql, storeId, productId);
}

export function registerCatalog(app: Hono, deps: Deps, options: AppOptions) {
  const { sql } = deps;

  register(app, deps, options, routes.productsList, async ({ storeId, query }) => {
    const after = decodeCursor(query.cursor);
    const rows = await sql<{ id: string; created_at: Date }[]>`
      select id, created_at from sellbase.products
       where store_id = ${storeId}
         ${query.status ? sql`and status = ${query.status}` : sql`and status <> 'archived'`}
         ${query.type ? sql`and type = ${query.type}` : sql``}
         ${
           query.q
             ? sql`and (title ilike ${'%' + query.q + '%'} or exists (
              select 1 from sellbase.variants v where v.product_id = sellbase.products.id and v.sku ilike ${'%' + query.q + '%'}))`
             : sql``
         }
         ${after ? sql`and (created_at, id) < (${after.at}, ${after.id})` : sql``}
       order by created_at desc, id desc limit ${query.limit + 1}`;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: await Promise.all(page.map((r) => loadAdminProduct(sql, storeId, r.id))),
      next_cursor:
        rows.length > query.limit && last ? encodeCursor(last.created_at, last.id) : null,
    };
  });

  register(app, deps, options, routes.productGet, ({ storeId, params }) =>
    loadAdminProduct(sql, storeId, params.id),
  );

  register(app, deps, options, routes.productUpsert, ({ storeId, actor, body }) =>
    upsertProduct(deps, storeId, actor, body),
  );

  register(app, deps, options, routes.productArchive, async ({ storeId, actor, params }) => {
    const updated = await sql`
      update sellbase.products set status = 'archived' where id = ${params.id} and store_id = ${storeId} returning id`;
    if (updated.length === 0)
      throw notFound('Product', params.id, 'Search products with GET /products.');
    const { actor_type, actor_id } = actorRef(actor);
    await sql`
      insert into sellbase.audit_log (store_id, actor_type, actor_id, action, entity, entity_id)
      values (${storeId}, ${actor_type}, ${actor_id}, 'product.archive', 'product', ${params.id})`;
    await sql`select sellbase.emit_event(${storeId}, 'product.archived', 'product', ${params.id})`;
    return loadAdminProduct(sql, storeId, params.id);
  });

  register(app, deps, options, routes.productMediaAdd, async ({ storeId, actor, params, body }) => {
    const [product] =
      await sql`select id from sellbase.products where id = ${params.id} and store_id = ${storeId}`;
    if (!product) throw notFound('Product', params.id, 'Search products with GET /products.');
    let url = body.url ?? null;
    let storagePath: string | null = null;
    if (!url && body.file_name && body.content_base64) {
      const bytes = decodeBase64(body.content_base64, 5_000_000);
      storagePath = `${storeId}/${params.id}/${crypto.randomUUID()}-${safeFileName(body.file_name)}`;
      await deps.storage.upload(
        'sellbase-media',
        storagePath,
        bytes,
        contentTypeFor(body.file_name),
      );
      url = deps.storage.publicUrl('sellbase-media', storagePath);
    }
    await sql`
      insert into sellbase.product_media (store_id, product_id, variant_id, storage_path, url, alt, position)
      values (${storeId}, ${params.id}, ${body.variant_id ?? null}, ${storagePath}, ${url}, ${body.alt},
              (select coalesce(max(position) + 1, 0) from sellbase.product_media where product_id = ${params.id}))`;
    const { actor_type, actor_id } = actorRef(actor);
    await sql`
      insert into sellbase.audit_log (store_id, actor_type, actor_id, action, entity, entity_id, diff)
      values (${storeId}, ${actor_type}, ${actor_id}, 'product.media_add', 'product', ${params.id}, ${sql.json({ url } as never)})`;
    return loadAdminProduct(sql, storeId, params.id);
  });

  register(
    app,
    deps,
    options,
    routes.digitalAssetUpload,
    async ({ storeId, actor, params, body }) => {
      const [variant] = await sql<{ type: string }[]>`
      select p.type from sellbase.variants v join sellbase.products p on p.id = v.product_id
       where v.id = ${params.id} and v.store_id = ${storeId}`;
      if (!variant) throw notFound('Variant', params.id, 'Get variant ids from GET /products/:id.');
      if (variant.type !== 'digital') {
        throw sellbaseError(
          'VALIDATION_ERROR',
          `Files can only be attached to digital products; this one is ${variant.type}.`,
          'Change the product type to "digital" with product_upsert, or attach the file to a digital product.',
        );
      }
      const bytes = decodeBase64(body.content_base64, 10_000_000);
      const path = `${storeId}/${params.id}/${crypto.randomUUID()}-${safeFileName(body.file_name)}`;
      await deps.storage.upload('sellbase-digital', path, bytes, contentTypeFor(body.file_name));
      const [asset] = await sql<{ id: string; file_name: string; size_bytes: number }[]>`
      insert into sellbase.digital_assets (store_id, variant_id, storage_path, file_name, size_bytes, download_limit, link_ttl_hours)
      values (${storeId}, ${params.id}, ${path}, ${body.file_name}, ${bytes.byteLength}, ${body.download_limit}, ${body.link_ttl_hours})
      returning id, file_name, size_bytes`;
      const { actor_type, actor_id } = actorRef(actor);
      await sql`
      insert into sellbase.audit_log (store_id, actor_type, actor_id, action, entity, entity_id, diff)
      values (${storeId}, ${actor_type}, ${actor_id}, 'digital_asset.upload', 'variant', ${params.id},
              ${sql.json({ file_name: body.file_name, size_bytes: bytes.byteLength } as never)})`;
      if (!asset) throw new Error('digital asset insert returned no row');
      return asset;
    },
  );

  register(app, deps, options, routes.inventoryAdjust, async ({ storeId, actor, body }) => {
    const [owned] =
      await sql`select 1 from sellbase.variants where id = ${body.variant_id} and store_id = ${storeId}`;
    if (!owned)
      throw notFound('Variant', body.variant_id, 'Get variant ids from GET /products/:id.');
    const { actor_type, actor_id } = actorRef(actor);
    const [level] = await sql<{ on_hand: number; reserved: number; policy: 'deny' | 'continue' }[]>`
      select (l).on_hand, (l).reserved, (l).policy
        from sellbase.adjust_inventory(${body.variant_id}, ${body.delta}, ${body.reason}, ${actor_type}, ${actor_id},
                                       ${body.policy ?? null}) l`;
    if (!level) throw new Error('adjust_inventory returned nothing');
    return { variant_id: body.variant_id, ...level };
  });
}
