import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, defineElements, Sellbase } from '../src/index.js';
import { resetStore } from '../src/store.js';

/** In-memory storefront API: two products, carts by token. */
let requiredConsent: string | null = null;

function fakeApi() {
  const products: Record<string, unknown> = {
    espadin: {
      id: 'p1',
      slug: 'espadin',
      type: 'physical',
      title: 'Espadín',
      description: '',
      tags: [],
      image_url: null,
      image_alt: null,
      min_price_amount: 89000,
      max_price_amount: 89000,
      currency: 'MXN',
      seo: {},
      options: [],
      media: [],
      variants: [
        {
          id: 'v1',
          sku: 'E',
          title: 'Default',
          option_values: {},
          price_amount: 89000,
          compare_at_amount: null,
          currency: 'MXN',
          available: true,
          available_quantity: 10,
          service: null,
        },
      ],
    },
    playera: {
      id: 'p2',
      slug: 'playera',
      type: 'physical',
      title: 'Playera',
      description: '',
      tags: [],
      image_url: null,
      image_alt: null,
      min_price_amount: 30000,
      max_price_amount: 30000,
      currency: 'MXN',
      seo: {},
      options: [{ name: 'Talla', values: ['M', 'L'] }],
      media: [],
      variants: [
        {
          id: 'vm',
          sku: null,
          title: 'M',
          option_values: { Talla: 'M' },
          price_amount: 30000,
          compare_at_amount: null,
          currency: 'MXN',
          available: true,
          available_quantity: 3,
          service: null,
        },
        {
          id: 'vl',
          sku: null,
          title: 'L',
          option_values: { Talla: 'L' },
          price_amount: 30000,
          compare_at_amount: null,
          currency: 'MXN',
          available: false,
          available_quantity: 0,
          service: null,
        },
      ],
    },
  };
  const carts = new Map<string, { id: string; variant_id: string; quantity: number }[]>();
  const checkouts: unknown[] = [];
  const view = (token: string) => {
    const items = carts.get(token) ?? [];
    const total = items.reduce((n, i) => n + i.quantity * 89000, 0);
    return {
      token,
      currency: 'MXN',
      status: 'open',
      email: null,
      discount_codes: [],
      rejected_discounts: [],
      requires_shipping: true,
      items: items.map((i) => ({
        ...i,
        product_id: 'p1',
        product_slug: 'espadin',
        title: 'Espadín',
        variant_title: null,
        sku: null,
        image_url: null,
        unit_price_amount: 89000,
        subtotal_amount: i.quantity * 89000,
        discount_amount: 0,
        total_amount: i.quantity * 89000,
        available: true,
        booking: null,
      })),
      totals: {
        currency: 'MXN',
        subtotal_amount: total,
        discount_amount: 0,
        shipping_amount: 0,
        tax_amount: 0,
        tax_mode: 'inclusive',
        total_amount: total,
        deposit_amount: null,
      },
    };
  };
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  const fetchMock = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const path = url.pathname.replace(/.*\/v1/, '');
    const body = init.body ? JSON.parse(String(init.body)) : {};
    const product = /^\/storefront\/products\/(.+)$/.exec(path);
    if (product)
      return products[product[1] ?? '']
        ? json(products[product[1] ?? ''])
        : json({ error: { code: 'NOT_FOUND', message: 'nope', hint: '' } }, 404);
    if (path === '/storefront/carts' && init.method === 'POST') {
      const token = `tok-${carts.size + 1}-xxxxxxxxxxxxxxxxxxxxx`;
      carts.set(token, []);
      return json(view(token));
    }
    const items = /^\/storefront\/carts\/([^/]+)\/items$/.exec(path);
    if (items) {
      const list = carts.get(items[1] ?? '') ?? [];
      list.push({ id: `i${list.length}`, variant_id: body.variant_id, quantity: body.quantity });
      return json(view(items[1] ?? ''));
    }
    const rates = /^\/storefront\/carts\/([^/]+)\/shipping-rates$/.exec(path);
    if (rates)
      return json({
        rates: [
          {
            id: 'manual:flat',
            carrier: 'manual',
            service: 'Envío estándar',
            amount: 9900,
            currency: 'MXN',
            requires_address: true,
          },
        ],
      });
    const cart = /^\/storefront\/carts\/([^/]+)$/.exec(path);
    if (cart) return json(view(cart[1] ?? ''));
    if (path === '/storefront/store')
      return json({
        name: 'Tienda de prueba',
        logo_url: null,
        currency: 'MXN',
        locale: 'es',
        contact_email: null,
        checkout: { required_consent: requiredConsent },
      });
    if (path === '/storefront/checkout') {
      checkouts.push(body);
      return json({
        mode: 'redirect',
        url: 'https://checkout.stripe.test/x',
        checkout_session_id: 's1',
        expires_at: new Date().toISOString(),
      });
    }
    if (path.startsWith('/storefront/checkout/'))
      return json({
        checkout_session_id: 's1',
        status: 'paid',
        order: {
          number: 1001,
          email: 'b***@test.dev',
          status: 'open',
          payment_status: 'paid',
          fulfillment_status: 'unfulfilled',
          currency: 'MXN',
          subtotal_amount: 89000,
          discount_amount: 0,
          shipping_amount: 9900,
          tax_amount: 0,
          total_amount: 98900,
          amount_paid: 98900,
          placed_at: new Date().toISOString(),
          items: [
            {
              title: 'Espadín',
              variant_title: null,
              quantity: 1,
              total_amount: 89000,
              fulfillment_type: 'shipment',
            },
          ],
          shipments: [],
          bookings: [],
          has_downloads: false,
        },
      });
    return json({ error: { code: 'NOT_FOUND', message: `no route ${path}`, hint: '' } }, 404);
  });
  return { fetchMock, checkouts };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle() {
  for (let i = 0; i < 10; i++) await tick();
}
const shadow = (selector: string) => document.querySelector(selector)?.shadowRoot as ShadowRoot;

let api: ReturnType<typeof fakeApi>;

beforeAll(() => {
  configure({ url: 'https://p.test/functions/v1/sellbase-api', anonKey: 'anon' });
  defineElements();
});

beforeEach(() => {
  api = fakeApi();
  vi.stubGlobal('fetch', api.fetchMock);
  localStorage.clear();
  resetStore();
  document.body.innerHTML = '<sellbase-cart-drawer></sellbase-cart-drawer>';
});

afterEach(() => vi.unstubAllGlobals());

describe('<sellbase-add-to-cart>', () => {
  it('shows the price from the API and adds to the cart, opening the drawer', async () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<sellbase-cart-button></sellbase-cart-button><sellbase-add-to-cart product="espadin"></sellbase-add-to-cart>',
    );
    await settle();
    const root = shadow('sellbase-add-to-cart');
    expect(root.querySelector('.price')?.textContent).toContain('890');
    (root.querySelector('[data-action="add"]') as HTMLButtonElement).click();
    await settle();
    expect(Sellbase.cart.count()).toBe(1);
    expect(localStorage.getItem('sellbase_cart_token')).toMatch(/^tok-/);
    const drawer = shadow('sellbase-cart-drawer');
    expect(drawer.querySelector('[role="dialog"]')).not.toBeNull();
    expect(drawer.textContent).toContain('Espadín');
    expect(shadow('sellbase-cart-button').querySelector('button')?.getAttribute('aria-label')).toBe(
      'Carrito, 1 artículo',
    );
    // Escape closes it.
    drawer
      .querySelector('.panel')
      ?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
      );
    await settle();
    expect(drawer.querySelector('[role="dialog"]')).toBeNull();
  });

  it('asks for an option and marks sold-out values', async () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<sellbase-add-to-cart product="playera"></sellbase-add-to-cart>',
    );
    await settle();
    const root = shadow('sellbase-add-to-cart');
    const button = () => root.querySelector('[data-action="add"]') as HTMLButtonElement;
    expect(button().disabled).toBe(true);
    expect(button().textContent).toBe('Elige una opción');
    expect(root.querySelector('[aria-label="L (agotado)"]')).not.toBeNull();
    (root.querySelector('[data-value="L"]') as HTMLButtonElement).click();
    await settle();
    expect(button().textContent).toBe('Agotado');
    (root.querySelector('[data-value="M"]') as HTMLButtonElement).click();
    await settle();
    expect(button().disabled).toBe(false);
  });

  it('explains an unknown product instead of breaking the page', async () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<sellbase-add-to-cart product="nada"></sellbase-add-to-cart>',
    );
    await settle();
    expect(shadow('sellbase-add-to-cart').querySelector('[role="alert"]')?.textContent).toBe(
      'No disponible',
    );
  });
});

describe('<sellbase-checkout>', () => {
  it('quotes shipping, requires the consent and sends it with the checkout', async () => {
    await Sellbase.cart.add('v1', 1);
    const assign = vi.fn();
    vi.stubGlobal('location', {
      ...window.location,
      assign,
      origin: 'https://tienda.test',
      pathname: '/checkout',
      search: '',
    });
    document.body.insertAdjacentHTML(
      'beforeend',
      '<sellbase-checkout consent="Confirmo que soy mayor de 18 años" success-url="/gracias"></sellbase-checkout>',
    );
    await settle();
    const root = shadow('sellbase-checkout');
    expect(root.textContent).toContain('Envío estándar');
    expect(root.querySelector('[data-total]')?.textContent).toContain('989');
    const pay = () => root.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(pay().disabled).toBe(true); // consent not given yet

    const set = (name: string, value: string) => {
      const el = root.querySelector(`[name="${name}"]`) as HTMLInputElement;
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('email', 'b@test.dev');
    set('first_name', 'Ana');
    set('line1', 'Av. Reforma 1');
    set('city', 'CDMX');
    set('state', 'CDMX');
    set('postal_code', '06600');
    const consent = root.querySelector('[name="consent"]') as HTMLInputElement;
    consent.checked = true;
    consent.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(pay().disabled).toBe(false);
    root
      .querySelector('form[data-form="checkout"]')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(api.checkouts[0]).toMatchObject({
      email: 'b@test.dev',
      shipping_rate_id: 'manual:flat',
      shipping_address: { line1: 'Av. Reforma 1', postal_code: '06600', country: 'MX' },
      consents: ['Confirmo que soy mayor de 18 años'],
      success_url: 'https://tienda.test/gracias',
    });
    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.test/x');
  });
});

describe('<sellbase-checkout-return>', () => {
  it('shows the paid order and clears the cart', async () => {
    await Sellbase.cart.add('v1', 1);
    vi.stubGlobal('location', {
      ...window.location,
      search: '?sellbase_checkout=s1',
      origin: 'https://tienda.test',
    });
    document.body.insertAdjacentHTML(
      'beforeend',
      '<sellbase-checkout-return></sellbase-checkout-return>',
    );
    await settle();
    const root = shadow('sellbase-checkout-return');
    expect(root.textContent).toContain('¡Listo! Tu pago se confirmó.');
    expect(root.textContent).toContain('Pedido #1001');
    expect(Sellbase.cart.count()).toBe(0);
    expect(localStorage.getItem('sellbase_cart_token')).toBeNull();
  });
});

describe('configuration', () => {
  it('explains a missing URL', async () => {
    configure({ url: '' });
    document.body.insertAdjacentHTML(
      'beforeend',
      '<sellbase-product-grid></sellbase-product-grid>',
    );
    await settle();
    expect(shadow('sellbase-product-grid').querySelector('[role="alert"]')).not.toBeNull();
    configure({ url: 'https://p.test/functions/v1/sellbase-api', anonKey: 'anon' });
  });
});

describe('store settings and recovery links', () => {
  it('restores the cart from ?sellbase_cart= and cleans the URL', async () => {
    const token = 'recovered-token-xxxxxxxxxxxxxxxx';
    window.history.replaceState(null, '', `/tienda?sellbase_cart=${token}&utm=mail`);
    resetStore();
    document.body.innerHTML = '<sellbase-cart-button></sellbase-cart-button>';
    await settle();
    expect(localStorage.getItem('sellbase_cart_token')).toBe(token);
    expect(window.location.search).toBe('?utm=mail');
    window.history.replaceState(null, '', '/');
  });

  it('shows the consent the store requires and sends it with the checkout', async () => {
    requiredConsent = 'Confirmo que soy mayor de 18 años';
    resetStore();
    try {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<sellbase-add-to-cart product="espadin"></sellbase-add-to-cart><sellbase-checkout></sellbase-checkout>',
      );
      await settle();
      (
        shadow('sellbase-add-to-cart').querySelector('[data-action="add"]') as HTMLButtonElement
      ).click();
      await settle();
      document.body.querySelector('sellbase-checkout')?.remove();
      document.body.insertAdjacentHTML('beforeend', '<sellbase-checkout></sellbase-checkout>');
      await settle();
      const root = shadow('sellbase-checkout');
      expect(root.textContent).toContain('mayor de 18');
      expect(root.querySelector('input[name="consent"]')?.hasAttribute('required')).toBe(true);
    } finally {
      requiredConsent = null;
    }
  });
});

describe('<sellbase-product>', () => {
  it('renders the product with its buy box, from an attribute or the URL', async () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<sellbase-product product="espadin"></sellbase-product>',
    );
    await settle();
    const el = document.querySelector('sellbase-product') as HTMLElement;
    expect(el.shadowRoot?.querySelector('h1')?.textContent).toBe('Espadín');
    expect(el.shadowRoot?.querySelector('slot[name="buy"]')).not.toBeNull();
    const buy = el.querySelector('sellbase-add-to-cart[slot="buy"]');
    expect(buy?.getAttribute('product')).toBe('espadin');
    await settle();
    expect(buy?.shadowRoot?.querySelector('.price')?.textContent).toContain('890');
    el.remove();

    window.history.replaceState(null, '', '/producto.html?p=playera');
    document.body.insertAdjacentHTML(
      'beforeend',
      '<sellbase-product slug-param="p"></sellbase-product>',
    );
    await settle();
    expect(
      document.querySelector('sellbase-product')?.shadowRoot?.querySelector('h1')?.textContent,
    ).toBe('Playera');
    expect(document.title).toBe('Playera');
    window.history.replaceState(null, '', '/');
  });
});
