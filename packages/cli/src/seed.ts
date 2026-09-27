import type { ProductUpsertInput } from '@sellbase/core';
import { createSellbase, type Sellbase } from '@sellbase/sdk';
import { cliError, log } from './util.js';

/**
 * Example catalogs by line of business (SPEC §14.2 `sellbase seed <giro>`), so the owner
 * and the agent start from something that looks like their store. Idempotent: products
 * that already exist (same title) are skipped. Prices in MXN minor units.
 */
interface Preset {
  label: string;
  products: (ProductUpsertInput & { file?: string })[];
  settings?: Record<string, unknown>;
  collection?: { title: string; titles: string[] };
  discount?: { code: string; percent: number };
  resource?: { name: string; weekdays: number[]; start: string; end: string; forTitles: string[] };
}

const physical = (weight_g: number) => ({
  weight_g,
  length_cm: 25,
  width_cm: 20,
  height_cm: 5,
  requires_shipping: true,
  hs_code: null,
});

export const PRESETS: Record<string, Preset> = {
  ropa: {
    label: 'Tienda de ropa',
    settings: { shipping: { flat_rate_amount: 9900, free_over_amount: 99900 } },
    products: [
      {
        type: 'physical',
        title: 'Playera básica',
        status: 'active',
        description: 'Algodón peinado 100 %, corte regular.',
        options: [{ name: 'Talla', values: ['S', 'M', 'L'] }],
        variants: ['S', 'M', 'L'].map((talla) => ({
          title: talla,
          sku: `EJ-PLAY-${talla}`,
          option_values: { Talla: talla },
          price_amount: 34900,
          compare_at_amount: 39900,
          inventory: { on_hand: 20, policy: 'deny' as const },
          physical: physical(200),
        })),
      },
      {
        type: 'physical',
        title: 'Sudadera con capucha',
        status: 'active',
        description: 'Felpa suave, bolsa canguro.',
        variants: [
          {
            title: 'Default',
            sku: 'EJ-SUD-01',
            option_values: {},
            price_amount: 79900,
            inventory: { on_hand: 10, policy: 'deny' as const },
            physical: physical(550),
          },
        ],
      },
      {
        type: 'physical',
        title: 'Gorra bordada',
        status: 'active',
        variants: [
          {
            title: 'Default',
            sku: 'EJ-GOR-01',
            option_values: {},
            price_amount: 29900,
            inventory: { on_hand: 15, policy: 'deny' as const },
            physical: physical(120),
          },
        ],
      },
    ],
    collection: { title: 'Lo más vendido', titles: ['Playera básica', 'Sudadera con capucha'] },
  },
  curso: {
    label: 'Curso y productos digitales',
    products: [
      {
        type: 'digital',
        title: 'Curso: fotografía con tu celular',
        status: 'active',
        description: '8 lecciones en video y ejercicios. Acceso inmediato.',
        variants: [{ title: 'Default', option_values: {}, price_amount: 149900 }],
        file: 'curso-fotografia.pdf',
      },
      {
        type: 'digital',
        title: 'Guía PDF: edición rápida',
        status: 'active',
        variants: [{ title: 'Default', option_values: {}, price_amount: 19900 }],
        file: 'guia-edicion.pdf',
      },
    ],
    discount: { code: 'BIENVENIDA', percent: 10 },
  },
  consultorio: {
    label: 'Consultorio con citas',
    products: [
      {
        type: 'service',
        title: 'Consulta de nutrición',
        status: 'active',
        description: 'Primera consulta: evaluación y plan de alimentación.',
        variants: [
          {
            title: 'Default',
            option_values: {},
            price_amount: 80000,
            service: {
              duration_min: 50,
              buffer_before_min: 0,
              buffer_after_min: 10,
              capacity: 1,
              deposit_amount: 20000,
              location_type: 'in_person',
              online_meeting_url: null,
              booking_window_days: 60,
              min_notice_min: 120,
              slot_interval_min: 60,
            },
          },
        ],
      },
      {
        type: 'service',
        title: 'Seguimiento en línea',
        status: 'active',
        variants: [
          {
            title: 'Default',
            option_values: {},
            price_amount: 45000,
            service: {
              duration_min: 30,
              buffer_before_min: 0,
              buffer_after_min: 0,
              capacity: 1,
              deposit_amount: null,
              location_type: 'online',
              online_meeting_url: 'https://meet.example.com/consultorio',
              booking_window_days: 60,
              min_notice_min: 60,
              slot_interval_min: 30,
            },
          },
        ],
      },
    ],
    resource: {
      name: 'Dra. Ana López',
      weekdays: [1, 2, 3, 4, 5],
      start: '09:00',
      end: '17:00',
      forTitles: ['Consulta de nutrición', 'Seguimiento en línea'],
    },
  },
  cafeteria: {
    label: 'Cafetería (recoger en tienda)',
    settings: {
      shipping: {
        flat_rate_amount: 6900,
        pickup: { enabled: true, label: 'Recoger en la cafetería' },
      },
    },
    products: [
      {
        type: 'physical',
        title: 'Café de especialidad 250 g',
        status: 'active',
        options: [{ name: 'Molido', values: ['Grano', 'Espresso', 'Prensa francesa'] }],
        variants: ['Grano', 'Espresso', 'Prensa francesa'].map((m, i) => ({
          title: m,
          sku: `EJ-CAF-250-${i + 1}`,
          option_values: { Molido: m },
          price_amount: 21000,
          inventory: { on_hand: 30, policy: 'deny' as const },
          physical: physical(270),
        })),
      },
      {
        type: 'physical',
        title: 'Taza de cerámica',
        status: 'active',
        variants: [
          {
            title: 'Default',
            sku: 'EJ-TAZA-01',
            option_values: {},
            price_amount: 18900,
            inventory: { on_hand: 12, policy: 'deny' as const },
            physical: physical(350),
          },
        ],
      },
    ],
  },
};

const tinyPdf = (title: string) =>
  Buffer.from(`%PDF-1.4\n% ${title} (archivo de ejemplo de Sellbase: reemplázalo)\n`).toString(
    'base64',
  );

export async function seed(
  creds: { url: string; token: string; anonKey?: string | undefined },
  giro: string,
) {
  const preset = PRESETS[giro];
  if (!preset) {
    throw cliError(`Unknown giro "${giro}".`, `Available: ${Object.keys(PRESETS).join(', ')}.`);
  }
  const sb: Sellbase = createSellbase({
    url: creds.url,
    token: creds.token,
    ...(creds.anonKey ? { anonKey: creds.anonKey } : {}),
  });
  if (preset.settings) await sb.admin.store.update({ settings: preset.settings });

  const existing = await sb.admin.products.search({ limit: 100 });
  const ids = new Map(existing.data.map((p) => [p.title, p.id]));
  let created = 0;
  for (const { file, ...product } of preset.products) {
    if (ids.has(product.title)) continue;
    const saved = await sb.admin.products.upsert(product);
    ids.set(saved.title, saved.id);
    created += 1;
    const variant = saved.variants[0];
    if (file && variant) {
      await sb.admin.variants.uploadFile(variant.id, {
        file_name: file,
        content_base64: tinyPdf(product.title),
        download_limit: 5,
      });
    }
  }
  if (preset.collection) {
    const collections = await sb.admin.collections.list();
    if (!collections.data.some((c) => c.title === preset.collection?.title)) {
      await sb.admin.collections.upsert({
        title: preset.collection.title,
        product_ids: preset.collection.titles.flatMap((t) => ids.get(t) ?? []),
      });
    }
  }
  if (preset.discount) {
    const discounts = await sb.admin.discounts.list();
    if (!discounts.data.some((d) => d.code === preset.discount?.code)) {
      await sb.admin.discounts.upsert({
        code: preset.discount.code,
        kind: 'percent',
        value: preset.discount.percent * 100,
      });
    }
  }
  if (preset.resource) {
    const resources = await sb.admin.resources.list();
    const r = preset.resource;
    if (!resources.data.some((x) => x.name === r.name)) {
      await sb.admin.resources.upsert({
        name: r.name,
        rules: r.weekdays.map((weekday) => ({ weekday, start_time: r.start, end_time: r.end })),
        product_ids: r.forTitles.flatMap((t) => ids.get(t) ?? []),
      });
    }
  }
  log.step(
    `${preset.label}: ${created} product(s) added${created < preset.products.length ? ` (${preset.products.length - created} already existed)` : ''}`,
  );
  return { created };
}
