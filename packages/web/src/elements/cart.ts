import { icons } from '../icons.js';
import type { CartView } from '@sellbase/sdk';
import { esc, SellbaseElement } from '../base.js';
import { getConfig, productHref } from '../config.js';
import { intlLocale, money, t } from '../i18n.js';
import { cart, loadCart, setDrawer, state } from '../store.js';

/** Lines + discount + totals, shared by the drawer and the cart page. */
export function cartBody(c: CartView) {
  const s = t();
  const f = (n: number) => money(n, c.currency);
  const lines = c.items
    .map(
      (i) => `<li class="line" part="line">
      <div class="thumb">${i.image_url ? `<img src="${esc(i.image_url)}" alt="">` : ''}</div>
      <div class="info">
        <a href="${esc(productHref(i.product_slug))}">${esc(i.title)}</a>
        ${i.variant_title ? `<span class="muted small">${esc(i.variant_title)}</span>` : ''}
        ${
          i.booking
            ? `<span class="muted small">${esc(new Intl.DateTimeFormat(intlLocale(), { timeZone: i.booking.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(i.booking.starts_at)))}${i.booking.resource_name ? ` · ${esc(i.booking.resource_name)}` : ''}</span>`
            : ''
        }
        ${i.available ? '' : `<span class="danger small">${esc(s.notEnough)}</span>`}
        ${
          i.booking
            ? `<button type="button" class="link small" data-action="remove" data-id="${esc(i.id)}">${esc(s.remove)}</button>`
            : `<div class="qty">
                <button type="button" class="step" data-action="dec" data-id="${esc(i.id)}" data-qty="${i.quantity}" aria-label="${esc(s.removeOne(i.title))}">−</button>
                <span aria-label="${esc(s.qtyOf(i.title))}">${i.quantity}</span>
                <button type="button" class="step" data-action="inc" data-id="${esc(i.id)}" data-qty="${i.quantity}" aria-label="${esc(s.addOne(i.title))}">+</button>
              </div>`
        }
      </div>
      <div class="amount">${esc(f(i.total_amount))}${i.discount_amount > 0 ? `<s class="muted small">${esc(f(i.subtotal_amount))}</s>` : ''}</div>
    </li>`,
    )
    .join('');
  const tot = c.totals;
  const applied = c.discount_codes
    .map((code) => {
      const problem = c.rejected_discounts.find((r) => r.code === code);
      return `<p class="row small"><span class="${problem ? 'danger' : 'success'}">${esc(problem ? `${code}: ${problem.hint}` : s.codeApplied(code))}</span><button type="button" class="link" data-action="remove-code" data-code="${esc(code)}" aria-label="${esc(`${s.remove} ${code}`)}">${esc(s.remove)}</button></p>`;
    })
    .join('');
  return `<ul class="lines" aria-live="polite">${lines}</ul>
  <form class="code" data-form="discount">
    <label for="code" class="sr-only">${esc(s.discountCode)}</label>
    <input class="input" id="code" name="code" placeholder="${esc(s.discountCode)}" autocomplete="off" part="input">
    <button class="btn btn--ghost" type="submit">${esc(s.apply)}</button>
  </form>
  <div aria-live="polite">${applied}${state.error && state.error.code.startsWith('DISCOUNT') ? `<p class="danger small" role="alert">${esc(state.error.message)}</p>` : ''}</div>
  <div class="totals" part="total">
    <dl>
      <div class="row"><dt>${esc(s.subtotal)}</dt><dd>${esc(f(tot.subtotal_amount))}</dd></div>
      ${tot.discount_amount > 0 ? `<div class="row success"><dt>${esc(s.discount)}</dt><dd>−${esc(f(tot.discount_amount))}</dd></div>` : ''}
      ${tot.tax_mode === 'exclusive' && tot.tax_amount > 0 ? `<div class="row"><dt>${esc(s.taxes)}</dt><dd>${esc(f(tot.tax_amount))}</dd></div>` : ''}
      <div class="row strong"><dt>${esc(s.total)}</dt><dd>${esc(f(tot.total_amount))}</dd></div>
    </dl>
    ${tot.tax_mode === 'inclusive' && tot.tax_amount > 0 ? `<p class="muted small">${esc(s.taxIncluded(f(tot.tax_amount)))}</p>` : ''}
    ${c.requires_shipping ? `<p class="muted small">${esc(s.shippingAtCheckout)}</p>` : ''}
  </div>`;
}

export const cartCss = `
.lines { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.line { display: flex; gap: .75em; padding: .9em 0; border-bottom: 1px solid var(--sellbase-border, #e5e7eb); }
.thumb { width: 64px; height: 64px; flex: none; border-radius: 8px; overflow: hidden; background: var(--sellbase-border, #e5e7eb); }
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.info { flex: 1; display: flex; flex-direction: column; gap: .2em; min-width: 0; }
.info a { color: inherit; font-weight: 600; text-decoration: none; }
.qty { display: flex; align-items: center; gap: .5em; margin-top: .25em; }
.step { width: 2em; height: 2em; border-radius: 6px; border: 1px solid var(--sellbase-border, #d4d4d8); background: transparent; cursor: pointer; }
.amount { text-align: right; display: flex; flex-direction: column; }
.code { display: flex; gap: .5em; margin-top: 1em; }
.totals dl { margin: 1em 0 0; display: flex; flex-direction: column; gap: .3em; }
.totals dd { margin: 0; }
.strong { font-weight: 700; font-size: 1.1em; }
`;

/** Handles the shared cart actions of cartBody(). */
export function handleCartAction(action: string, el: HTMLElement) {
  const id = el.dataset.id ?? '';
  const qty = Number(el.dataset.qty ?? 0);
  if (action === 'inc') void cart.update(id, qty + 1).catch(() => undefined);
  if (action === 'dec')
    void (qty > 1 ? cart.update(id, qty - 1) : cart.remove(id)).catch(() => undefined);
  if (action === 'remove') void cart.remove(id).catch(() => undefined);
  if (action === 'remove-code')
    void cart.removeDiscount(el.dataset.code ?? '').catch(() => undefined);
}

export function handleCartSubmit(form: HTMLFormElement) {
  if (form.dataset.form !== 'discount') return;
  const code = (new FormData(form).get('code') as string | null)?.trim().toUpperCase();
  if (code) void cart.applyDiscount(code).catch(() => undefined);
}

/** <sellbase-cart-button></sellbase-cart-button>: count badge; opens the drawer. */
export class SellbaseCartButton extends SellbaseElement {
  protected override css = `
    :host { display: inline-block; }
    button { position: relative; background: none; border: 0; cursor: pointer; padding: .4em .6em; color: inherit; font-size: 1.15em; }
    .badge { position: absolute; top: -.2em; right: -.3em; min-width: 1.4em; border-radius: 999px; font-size: .65em; padding: .1em .35em;
      background: var(--sellbase-primary, #111); color: var(--sellbase-primary-text, #fff); }
  `;
  protected override async load() {
    await loadCart();
  }
  protected override onAction() {
    setDrawer(!state.drawerOpen);
  }
  protected render() {
    const n = cart.count();
    const icon = this.innerHTML.trim() ? '<slot></slot>' : icons.cart;
    return `<button type="button" part="button" data-action="toggle" data-sellbase-cart-button aria-haspopup="dialog" aria-expanded="${state.drawerOpen}" aria-label="${esc(t().cartButton(n))}">${icon}${n > 0 ? `<span class="badge" aria-hidden="true">${n}</span>` : ''}</button>`;
  }
}

/**
 * <sellbase-cart-drawer></sellbase-cart-drawer>: the side panel. Added to the page
 * automatically by sellbase.js when missing. Focus moves in, Tab stays inside, Escape
 * and the close button close it. Attribute `checkout-url` (default config.checkoutUrl or /checkout).
 */
export class SellbaseCartDrawer extends SellbaseElement {
  private wasOpen = false;
  private opener: HTMLElement | null = null;
  protected override css = `${cartCss}
    :host { position: fixed; inset: 0; z-index: 2147483000; display: none; }
    :host([open]) { display: block; }
    .backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.45); }
    .panel { position: absolute; right: 0; top: 0; height: 100%; width: min(100%, 420px); background: var(--sellbase-surface, var(--sellbase-bg, #fff));
      color: var(--sellbase-text, #111); display: flex; flex-direction: column; box-shadow: -8px 0 30px rgba(0,0,0,.2); }
    header { display: flex; justify-content: space-between; align-items: center; padding: 1em 1.2em; border-bottom: 1px solid var(--sellbase-border, #e5e7eb); }
    header h2 { margin: 0; font-size: 1.15em; }
    .close { background: none; border: 0; font-size: 1.2em; cursor: pointer; color: inherit; }
    .body { flex: 1; overflow-y: auto; padding: 0 1.2em; }
    footer { padding: 1em 1.2em; border-top: 1px solid var(--sellbase-border, #e5e7eb); display: flex; flex-direction: column; gap: .75em; }
    footer .btn { width: 100%; }
  `;
  protected override async load() {
    await loadCart();
  }
  override update() {
    this.toggleAttribute('open', state.drawerOpen);
    super.update();
    if (state.drawerOpen && !this.wasOpen) {
      this.opener = document.activeElement as HTMLElement | null;
      this.root.querySelector<HTMLElement>('.close')?.focus();
    }
    if (!state.drawerOpen && this.wasOpen) this.opener?.focus();
    this.wasOpen = state.drawerOpen;
  }
  protected override onAction(action: string, el: HTMLElement) {
    if (action === 'close') setDrawer(false);
    else handleCartAction(action, el);
  }
  protected override onSubmit(form: HTMLFormElement) {
    handleCartSubmit(form);
  }
  protected override onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') setDrawer(false);
    if (e.key !== 'Tab') return;
    const items = [
      ...this.root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input'),
    ];
    const first = items[0];
    const last = items[items.length - 1];
    const active = this.root.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first?.focus();
    }
  }
  protected render() {
    if (!state.drawerOpen) return '';
    const s = t();
    const c = state.cart;
    const has = (c?.items.length ?? 0) > 0;
    const checkout = this.getAttribute('checkout-url') ?? getConfig().checkoutUrl ?? '/checkout';
    return `<div class="backdrop" data-action="close" aria-hidden="true"></div>
    <aside class="panel" role="dialog" aria-modal="true" aria-labelledby="t" part="panel">
      <header><h2 id="t">${esc(s.cart)}</h2><button type="button" class="close" data-action="close" aria-label="${esc(s.close)}">${icons.close}</button></header>
      <div class="body">${has && c ? cartBody(c) : `<p class="muted">${esc(state.loading ? s.loading : s.emptyCart)}</p>`}</div>
      ${has ? `<footer><a class="btn" part="button" href="${esc(checkout)}">${esc(s.goToCheckout)}</a></footer>` : ''}
    </aside>`;
  }
}
