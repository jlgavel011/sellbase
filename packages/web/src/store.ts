import type { CartView } from '@sellbase/sdk';
import { api, resetApiCache } from './api.js';

/**
 * Cart state shared by every element on the page (and by @sellbase/react: same
 * localStorage key, so a site can mix both). Elements subscribe and re-render.
 */
const KEY = 'sellbase_cart_token';

type Listener = () => void;
const listeners = new Set<Listener>();

export const state = {
  token: null as string | null,
  cart: null as CartView | null,
  loading: false,
  updating: false,
  error: null as { message: string; hint: string; code: string } | null,
  drawerOpen: false,
};

const read = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const write = (token: string | null) => {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    // private mode: the cart lives for this page only
  }
};

export function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  for (const l of listeners) l();
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent('sellbase:cart', { detail: state.cart }));
}

let loaded: Promise<void> | null = null;

/** Query parameter of cart recovery links (abandoned checkout emails). */
export const CART_PARAM = 'sellbase_cart';

/** A recovery link (?sellbase_cart=…) replaces the saved cart, then leaves the URL clean. */
function takeCartFromUrl() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const token = url.searchParams.get(CART_PARAM);
  if (!token || token.length < 20) return;
  write(token);
  url.searchParams.delete(CART_PARAM);
  window.history.replaceState(window.history.state, '', url.toString());
}

/** Loads the saved cart once; converted or missing carts are forgotten. */
export function loadCart() {
  loaded ??= (async () => {
    takeCartFromUrl();
    state.token = read();
    if (!state.token) return;
    state.loading = true;
    emit();
    try {
      const cart = await api.cart(state.token);
      if (cart.status !== 'open') forget();
      else state.cart = cart;
    } catch {
      forget();
    } finally {
      state.loading = false;
      emit();
    }
  })();
  return loaded;
}

function forget() {
  state.token = null;
  state.cart = null;
  write(null);
}

async function run(action: (token: string) => Promise<CartView>) {
  await loadCart();
  state.updating = true;
  state.error = null;
  emit();
  try {
    if (!state.token) {
      const created = await api.createCart();
      state.token = created.token;
      write(created.token);
    }
    state.cart = await action(state.token as string);
    return state.cart;
  } catch (error) {
    const e = error as { message?: string; hint?: string; code?: string };
    state.error = {
      message: e.message ?? 'Error',
      hint: e.hint ?? '',
      code: e.code ?? 'INTERNAL_ERROR',
    };
    throw error;
  } finally {
    state.updating = false;
    emit();
  }
}

export const cart = {
  add: (variantId: string, quantity = 1, slot?: { starts_at: string }) =>
    run((t) => api.addItem(t, variantId, quantity, slot)),
  update: (itemId: string, quantity: number) => run((t) => api.updateItem(t, itemId, quantity)),
  remove: (itemId: string) => run((t) => api.removeItem(t, itemId)),
  applyDiscount: (code: string) => run((t) => api.applyDiscount(t, code)),
  removeDiscount: (code: string) => run((t) => api.removeDiscount(t, code)),
  /** Forget the cart (after the order is paid). */
  clear: () => {
    forget();
    emit();
  },
  count: () => state.cart?.items.reduce((n, i) => n + i.quantity, 0) ?? 0,
};

export function setDrawer(open: boolean) {
  state.drawerOpen = open;
  emit();
}

/** Tests only. */
export function resetStore() {
  loaded = null;
  resetApiCache();
  forget();
  state.drawerOpen = false;
  state.error = null;
}
