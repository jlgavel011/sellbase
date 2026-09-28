import { configure, getConfig } from './config.js';
import { SellbaseAddToCart, SellbasePrice } from './elements/add-to-cart.js';
import {
  SellbaseCheckoutReturn,
  SellbaseDownload,
  SellbaseOrderLookup,
} from './elements/after-purchase.js';
import { SellbaseCartButton, SellbaseCartDrawer } from './elements/cart.js';
import { SellbaseCheckout } from './elements/checkout.js';
import { SellbaseProductGrid } from './elements/product-grid.js';
import { cart, loadCart, setDrawer, state, subscribe } from './store.js';

export { configure, getConfig, type SellbaseWebConfig } from './config.js';
export { SellbaseApiError } from './api.js';

const ELEMENTS: [string, CustomElementConstructor][] = [
  ['sellbase-add-to-cart', SellbaseAddToCart],
  ['sellbase-price', SellbasePrice],
  ['sellbase-product-grid', SellbaseProductGrid],
  ['sellbase-cart-button', SellbaseCartButton],
  ['sellbase-cart-drawer', SellbaseCartDrawer],
  ['sellbase-checkout', SellbaseCheckout],
  ['sellbase-checkout-return', SellbaseCheckoutReturn],
  ['sellbase-order-lookup', SellbaseOrderLookup],
  ['sellbase-download', SellbaseDownload],
];

/** Registers every <sellbase-*> element and adds the cart drawer if the page has none. */
export function defineElements() {
  if (typeof customElements === 'undefined') return;
  for (const [name, ctor] of ELEMENTS)
    if (!customElements.get(name)) customElements.define(name, ctor);
  const addDrawer = () => {
    if (!document.querySelector('sellbase-cart-drawer'))
      document.body.appendChild(document.createElement('sellbase-cart-drawer'));
  };
  if (document.body) addDrawer();
  else document.addEventListener('DOMContentLoaded', addDrawer, { once: true });
}

/** Programmatic API for sites that want their own buttons: window.Sellbase in the script build. */
export const Sellbase = {
  configure,
  getConfig,
  cart: {
    ...cart,
    get: () => state.cart,
    load: loadCart,
    open: () => setDrawer(true),
    close: () => setDrawer(false),
  },
  /** Called on every cart change; returns an unsubscribe function. */
  onChange: (listener: () => void) => subscribe(listener),
  defineElements,
};
