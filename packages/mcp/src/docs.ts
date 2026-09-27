import { DOCS, REGISTRY, type DocSection } from './docs.generated.js';

const normalize = (text: string) => text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

const words = (text: string) => normalize(text).match(/[a-z0-9_:./-]{2,}/g) ?? [];

/** Keyword search over the bundled docs: title matches weigh more than body matches. */
export function searchDocs(query: string, limit = 5): (DocSection & { score: number })[] {
  const terms = [...new Set(words(query))];
  if (terms.length === 0) return [];
  return DOCS.map((doc) => {
    const title = normalize(doc.title);
    const body = normalize(doc.text);
    let score = 0;
    for (const term of terms) {
      if (title.includes(term)) score += 5;
      const hits = body.split(term).length - 1;
      score += Math.min(hits, 5);
    }
    return { ...doc, score };
  })
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** A window of the section around the first matching term, so answers stay compact. */
export function excerpt(text: string, query: string, size = 1200) {
  if (text.length <= size) return text;
  const lower = normalize(text);
  const first = words(query)
    .map((t) => lower.indexOf(t))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0];
  const start = Math.max(0, (first ?? 0) - 200);
  return `${start > 0 ? '…' : ''}${text.slice(start, start + size)}…`;
}

const INTENTS: { match: RegExp; components: string[]; pages: string[]; why: string }[] = [
  {
    match: /cita|agenda|reserv|consult|clase|sesion|turno|book|appointment|servicio/,
    components: ['product-grid', 'product-detail', 'booking-picker', 'checkout'],
    pages: ['/servicios', '/servicios/[slug]', '/checkout', '/gracias'],
    why: 'services are booked on the product page (booking-picker) and paid in checkout; no shipping',
  },
  {
    match: /curso|ebook|digital|descarga|plantilla|pdf|download|course/,
    components: ['product-grid', 'product-detail', 'cart-drawer', 'checkout'],
    pages: ['/', '/productos/[slug]', '/checkout', '/gracias'],
    why: 'digital products: files are emailed after payment, no shipping address',
  },
  {
    match: /tienda|producto|catalogo|ropa|playera|shop|store|venta|vender|carrito|cart/,
    components: ['product-grid', 'product-detail', 'cart-drawer', 'checkout'],
    pages: ['/productos', '/productos/[slug]', '/checkout', '/gracias'],
    why: 'a catalog with product pages, a cart and checkout',
  },
  {
    match: /boton|comprar ya|landing|un producto|single|buy button/,
    components: ['product-card', 'cart-drawer', 'checkout'],
    pages: ['/', '/checkout', '/gracias'],
    why: 'one or a few products on an existing page: a product card plus cart and checkout',
  },
];

/** Which registry components to add for what the owner wants to sell, and the command. */
export function scaffoldStorefront(intent: string) {
  const text = normalize(intent);
  const matched = INTENTS.filter((i) => i.match.test(text));
  const chosen = matched.length ? matched : [INTENTS[2] as (typeof INTENTS)[number]];
  const names = new Set<string>(['theme']);
  for (const i of chosen) i.components.forEach((c) => names.add(c));
  // Include dependencies so the command installs a working set.
  const byName = new Map(REGISTRY.map((c) => [c.name, c]));
  const visit = (name: string) =>
    byName.get(name)?.dependencies.forEach((d) => {
      if (!names.has(d)) {
        names.add(d);
        visit(d);
      }
    });
  [...names].forEach(visit);
  const components = [...names].map((name) => ({
    name,
    description: byName.get(name)?.description ?? '',
  }));
  return {
    components,
    command: `npx sellbase add ${[...names].filter((n) => n !== 'theme').join(' ')}`,
    pages: [...new Set(chosen.flatMap((i) => i.pages))],
    why: chosen.map((i) => i.why),
    next_steps: [
      'Import components/sellbase/theme.css once in the global CSS and map its variables to the site colors.',
      'Wrap the app with <SellbaseStoreProvider> (components/sellbase/provider.tsx).',
      'The return page (/gracias) reads ?sellbase_checkout and shows the order status with sellbase.checkout.status().',
      'Follow the add-storefront skill; keep the site design, the components are yours to edit.',
    ],
  };
}
