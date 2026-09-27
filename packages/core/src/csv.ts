import { toMinorUnits } from './money.js';
import type { ProductType, ProductStatus } from './schemas/catalog.js';

/** URL-safe slug from any title ("Café Ñandú" → "cafe-nandu"). */
export function slugify(text: string, fallback = 'product'): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/g, '');
  return slug || fallback;
}

/** RFC 4180 CSV: quoted fields, escaped quotes, CRLF/LF, optional BOM. Detects `;` files. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const sep =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const norm = (h: string) =>
  h
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ');

/** Our column names, Spanish names and Shopify export headers. */
const COLUMNS = {
  handle: ['handle', 'slug', 'url'],
  title: ['title', 'titulo', 'name', 'nombre'],
  description: ['description', 'body (html)', 'body html', 'descripcion'],
  type: ['type', 'tipo', 'product type'],
  status: ['status', 'estado', 'published', 'publicado'],
  tags: ['tags', 'etiquetas'],
  option1_name: ['option1 name', 'opcion1 nombre'],
  option1_value: ['option1 value', 'opcion1 valor'],
  option2_name: ['option2 name', 'opcion2 nombre'],
  option2_value: ['option2 value', 'opcion2 valor'],
  option3_name: ['option3 name', 'opcion3 nombre'],
  option3_value: ['option3 value', 'opcion3 valor'],
  sku: ['sku', 'variant sku'],
  price: ['price', 'precio', 'variant price'],
  compare_at_price: [
    'compare at price',
    'variant compare at price',
    'precio anterior',
    'precio antes',
  ],
  stock: ['stock', 'inventory', 'inventario', 'existencias', 'variant inventory qty'],
  weight_g: ['weight g', 'peso g', 'peso', 'variant grams', 'grams'],
  length_cm: ['length cm', 'largo cm', 'largo'],
  width_cm: ['width cm', 'ancho cm', 'ancho'],
  height_cm: ['height cm', 'alto cm', 'alto'],
  image: ['image', 'image url', 'image src', 'imagen', 'variant image'],
} as const;
type Column = keyof typeof COLUMNS;

const TYPES: Record<string, ProductType> = {
  physical: 'physical',
  fisico: 'physical',
  digital: 'digital',
  service: 'service',
  servicio: 'service',
};
const STATUSES: Record<string, ProductStatus> = {
  active: 'active',
  activo: 'active',
  true: 'active',
  si: 'active',
  draft: 'draft',
  borrador: 'draft',
  false: 'draft',
  no: 'draft',
  archived: 'archived',
  archivado: 'archived',
};

export interface CsvRowError {
  /** 1-based line in the file, counting the header as line 1. */
  row: number;
  message: string;
  hint: string;
}

export interface CsvVariant {
  sku: string | null;
  title: string;
  option_values: Record<string, string>;
  price_amount: number;
  compare_at_amount: number | null;
  stock: number | null;
  physical: { weight_g: number; length_cm: number; width_cm: number; height_cm: number } | null;
  row: number;
}

export interface CsvProduct {
  slug: string;
  type: ProductType;
  title: string;
  description: string;
  status: ProductStatus;
  tags: string[];
  options: { name: string; values: string[] }[];
  variants: CsvVariant[];
  images: string[];
  row: number;
}

export const CSV_MAX_ROWS = 2000;

/**
 * Reads a products CSV (our template, Spanish headers or a Shopify export). Rows with the
 * same handle become variants of one product; rows without price only add images.
 */
export function productsFromCsv(
  text: string,
  currency: string,
): { products: CsvProduct[]; errors: CsvRowError[] } {
  const rows = parseCsv(text);
  const errors: CsvRowError[] = [];
  const [header, ...body] = rows;
  if (!header || body.length === 0) {
    return {
      products: [],
      errors: [
        {
          row: 1,
          message: 'The file has no product rows.',
          hint: 'The first line must be a header (title,price,…) followed by one row per product or variant.',
        },
      ],
    };
  }
  if (body.length > CSV_MAX_ROWS) {
    return {
      products: [],
      errors: [
        {
          row: 1,
          message: `The file has ${body.length} rows; the limit is ${CSV_MAX_ROWS}.`,
          hint: 'Split it into several files.',
        },
      ],
    };
  }
  const index = new Map<Column, number>();
  header.forEach((h, i) => {
    const key = (Object.keys(COLUMNS) as Column[]).find((c) =>
      (COLUMNS[c] as readonly string[]).includes(norm(h)),
    );
    if (key && !index.has(key)) index.set(key, i);
  });
  if (!index.has('title') || !index.has('price')) {
    return {
      products: [],
      errors: [
        {
          row: 1,
          message: 'Missing required columns: title and price.',
          hint: 'Use headers like title,price,sku,stock (or a Shopify export).',
        },
      ],
    };
  }

  const products = new Map<string, CsvProduct>();
  const failed = new Set<string>();
  body.forEach((cells, i) => {
    const line = i + 2;
    const get = (c: Column) => (index.has(c) ? (cells[index.get(c) ?? -1] ?? '').trim() : '');
    const title = get('title');
    const key = get('handle') ? slugify(get('handle')) : title ? slugify(title) : '';
    if (!key) {
      errors.push({ row: line, message: 'Row without title or handle.', hint: 'Add a title.' });
      return;
    }
    let product = products.get(key);
    if (!product) {
      if (!title) {
        errors.push({
          row: line,
          message: `First row of "${key}" has no title.`,
          hint: 'The first row of each product needs its title.',
        });
        return;
      }
      const type = TYPES[norm(get('type'))] ?? 'physical';
      if (type === 'service') {
        errors.push({
          row: line,
          message: `"${title}" is a service.`,
          hint: 'Services need duration and hours: create them with product_upsert or in Admin → Products.',
        });
        return;
      }
      product = {
        slug: key,
        type,
        title: title.slice(0, 200),
        description: get('description'),
        status: STATUSES[norm(get('status'))] ?? 'draft',
        tags: get('tags')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 20),
        options: [1, 2, 3]
          .map((n) => get(`option${n}_name` as Column))
          .filter((name) => name && norm(name) !== 'title')
          .map((name) => ({ name, values: [] })),
        variants: [],
        images: [],
        row: line,
      };
      products.set(key, product);
    }
    const image = get('image');
    if (image && /^https?:\/\//.test(image) && !product.images.includes(image))
      product.images.push(image);

    const priceText = get('price').replace(/[$,\s]/g, '');
    if (!priceText) return; // image-only row (Shopify)
    let price: number;
    let compareAt: number | null;
    try {
      price = toMinorUnits(priceText, currency);
      const compare = get('compare_at_price').replace(/[$,\s]/g, '');
      compareAt = compare ? toMinorUnits(compare, currency) : null;
    } catch {
      errors.push({
        row: line,
        message: `Invalid price "${get('price')}".`,
        hint: 'Write prices as decimals without currency symbols, e.g. 349.00.',
      });
      failed.add(key);
      return;
    }
    const optionValues: Record<string, string> = {};
    product.options.forEach((opt, n) => {
      const value = get(`option${n + 1}_value` as Column);
      if (!value) return;
      optionValues[opt.name] = value;
      if (!opt.values.includes(value)) opt.values.push(value);
    });
    const stockText = get('stock');
    const stock = stockText === '' ? null : Number(stockText);
    if (stock !== null && !Number.isInteger(stock)) {
      errors.push({
        row: line,
        message: `Invalid stock "${stockText}".`,
        hint: 'Use a whole number.',
      });
      failed.add(key);
      return;
    }
    const num = (c: Column) => {
      const n = Number(get(c).replace(',', '.'));
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const weight = Math.round(num('weight_g'));
    product.variants.push({
      sku: get('sku') || null,
      title: Object.values(optionValues).join(' / ') || 'Default',
      option_values: optionValues,
      price_amount: price,
      compare_at_amount: compareAt,
      stock: product.type === 'physical' ? stock : null,
      physical:
        product.type === 'physical' && (weight || num('length_cm'))
          ? {
              weight_g: weight,
              length_cm: num('length_cm'),
              width_cm: num('width_cm'),
              height_cm: num('height_cm'),
            }
          : null,
      row: line,
    });
  });

  const out: CsvProduct[] = [];
  for (const p of products.values()) {
    if (p.variants.length === 0) {
      if (failed.has(p.slug)) continue;
      errors.push({
        row: p.row,
        message: `"${p.title}" has no price.`,
        hint: 'Every product needs at least one row with a price.',
      });
      continue;
    }
    p.options = p.options.filter((o) => o.values.length > 0);
    out.push(p);
  }
  return { products: out, errors };
}
