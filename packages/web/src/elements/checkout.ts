import type { ShippingRate } from '@sellbase/sdk';
import { api } from '../api.js';
import { esc, SellbaseElement } from '../base.js';
import { getConfig } from '../config.js';
import { money, t } from '../i18n.js';
import { loadCart, state } from '../store.js';
import { cartCss, handleCartAction, handleCartSubmit } from './cart.js';

const FIELDS = ['first_name', 'line1', 'line2', 'city', 'state', 'postal_code', 'phone'] as const;

/**
 * <sellbase-checkout></sellbase-checkout>: email, address (only when something ships),
 * shipping option, deposit or full payment for services, summary, then redirects to pay.
 * The order is created by the payment webhook, never by this page.
 * Attributes: `success-url` (default config.successUrl or /gracias), `cancel-url`,
 * `country` (default MX), `consent` (text of a required checkbox, e.g. "Confirmo que soy
 * mayor de 18 años"; it is sent with the checkout).
 */
export class SellbaseCheckout extends SellbaseElement {
  private email = '';
  private address: Record<string, string> = {};
  private rates: ShippingRate[] = [];
  private rateId: string | null = null;
  private quoting = false;
  private quoteTimer: ReturnType<typeof setTimeout> | null = null;
  private payMode: 'full' | 'deposit' = 'full';
  private consent = false;
  private sending = false;
  private error: string | null = null;

  protected override css = `${cartCss}
    form.checkout { display: grid; gap: 2em; }
    @media (min-width: 760px) { form.checkout { grid-template-columns: 1fr 22em; } }
    fieldset { border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: .75em; }
    legend { font-weight: 700; font-size: 1.1em; margin-bottom: .5em; }
    .grid2 { display: grid; gap: .75em; grid-template-columns: 1fr 1fr; }
    .option { display: flex; gap: .6em; align-items: center; border: 1px solid var(--sellbase-border, #d4d4d8); border-radius: 8px; padding: .7em .9em; }
    .summary { border: 1px solid var(--sellbase-border, #e5e7eb); border-radius: var(--sellbase-radius, 10px); padding: 1em; height: fit-content; }
    .summary .btn { width: 100%; margin-top: 1em; }
  `;

  protected override async load() {
    this.address.country = this.getAttribute('country') ?? 'MX';
    await loadCart();
    if (state.cart?.requires_shipping) await this.quote();
  }

  private addressReady() {
    return Boolean(this.address.line1 && this.address.city && this.address.postal_code);
  }

  private async quote() {
    if (!state.token) return;
    this.quoting = true;
    this.update();
    try {
      const body = this.addressReady() ? { ...this.address } : undefined;
      this.rates = (await api.shippingRates(state.token, body)).rates;
      if (!this.rates.some((r) => r.id === this.rateId)) this.rateId = this.rates[0]?.id ?? null;
    } catch {
      this.rates = [];
    } finally {
      this.quoting = false;
      this.update();
    }
  }

  protected override onInput(el: HTMLInputElement) {
    if (el.name === 'email') this.email = el.value;
    else if ((FIELDS as readonly string[]).includes(el.name)) {
      this.address[el.name] = el.value;
      // Re-quote only once the address settles.
      if (this.quoteTimer) clearTimeout(this.quoteTimer);
      this.quoteTimer = setTimeout(() => void this.quote(), 600);
    } else if (el.name === 'rate') {
      this.rateId = el.value;
      this.update();
    } else if (el.name === 'pay_mode') {
      this.payMode = el.value === 'deposit' ? 'deposit' : 'full';
      this.update();
    } else if (el.name === 'consent') {
      this.consent = el.checked;
      this.update();
    }
  }

  protected override onAction(action: string, el: HTMLElement) {
    handleCartAction(action, el);
  }

  protected override async onSubmit(form: HTMLFormElement) {
    if (form.dataset.form === 'discount') {
      handleCartSubmit(form);
      return;
    }
    if (!state.token || !state.cart) return;
    const c = state.cart;
    const rate = this.rates.find((r) => r.id === this.rateId);
    const needsAddress = c.requires_shipping && (rate?.requires_address ?? true);
    const origin = window.location.origin;
    const abs = (url: string) => new URL(url, origin).toString();
    const success = this.getAttribute('success-url') ?? getConfig().successUrl ?? '/gracias';
    const cancel = this.getAttribute('cancel-url') ?? window.location.pathname;
    const consentText = this.getAttribute('consent');
    this.sending = true;
    this.error = null;
    this.update();
    try {
      const result = await api.checkout({
        cart_token: state.token,
        email: this.email,
        ...(c.requires_shipping && this.rateId ? { shipping_rate_id: this.rateId } : {}),
        ...(needsAddress ? { shipping_address: { ...this.address } } : {}),
        ...(this.payMode === 'deposit' ? { pay_mode: 'deposit' } : {}),
        ...(consentText ? { consents: [consentText] } : {}),
        success_url: abs(success),
        cancel_url: abs(cancel),
      });
      if (result.mode === 'redirect') window.location.assign(result.url);
    } catch (error) {
      const e = error as { message: string; hint?: string };
      this.error = e.hint ? `${e.message} ${e.hint}` : e.message;
      this.sending = false;
      this.update();
    }
  }

  protected render() {
    const s = t();
    const c = state.cart;
    if (state.loading) return `<div class="skeleton" aria-busy="true"></div>`;
    if (!c || c.items.length === 0) return `<p>${esc(s.emptyCart)}</p>`;
    const f = (n: number) => money(n, c.currency);
    const rate = this.rates.find((r) => r.id === this.rateId);
    const needsAddress = c.requires_shipping && (rate?.requires_address ?? true);
    const shipping = c.requires_shipping ? (rate?.amount ?? 0) : 0;
    const input = (name: string, label: string, auto: string, required = true, id = `f-${name}`) =>
      `<label class="field" for="${id}">${esc(label)}<input class="input" part="input" id="${id}" name="${name}" autocomplete="${auto}" ${required ? 'required' : ''} value="${esc(this.address[name] ?? '')}"></label>`;
    const consentText = this.getAttribute('consent');
    const deposit = c.totals.deposit_amount;
    const disabled =
      this.sending || (Boolean(consentText) && !this.consent) || (c.requires_shipping && !rate);
    return `<form class="checkout" data-form="checkout">
      <div class="stack">
        <fieldset><legend>${esc(s.contact)}</legend>
          <label class="field" for="f-email">${esc(s.email)}<input class="input" part="input" id="f-email" name="email" type="email" autocomplete="email" required value="${esc(this.email)}"></label>
        </fieldset>
        ${
          c.requires_shipping
            ? `<fieldset><legend>${esc(s.shipping)}</legend>
                ${
                  this.rates.length
                    ? `<div role="radiogroup" aria-label="${esc(s.shippingOptions)}" class="stack">${this.rates
                        .map(
                          (r) =>
                            `<label class="option"><input type="radio" name="rate" value="${esc(r.id)}" ${r.id === this.rateId ? 'checked' : ''}> <span style="flex:1">${esc(r.service)}</span> <strong>${esc(r.amount ? f(r.amount) : s.free)}</strong></label>`,
                        )
                        .join('')}</div>`
                    : `<p class="muted small">${esc(this.quoting ? s.loading : s.shippingAtCheckout)}</p>`
                }
                ${
                  needsAddress
                    ? `${input('first_name', s.name, 'name')}${input('line1', s.address, 'address-line1')}${input('line2', s.address2, 'address-line2', false)}
                  <div class="grid2">${input('city', s.city, 'address-level2')}${input('state', s.state, 'address-level1')}</div>
                  <div class="grid2">${input('postal_code', s.postalCode, 'postal-code')}${input('phone', s.phone, 'tel', false)}</div>`
                    : ''
                }
              </fieldset>`
            : ''
        }
        ${
          deposit !== null && deposit < c.totals.total_amount
            ? `<fieldset><legend>${esc(s.pay)}</legend>
                <label class="option"><input type="radio" name="pay_mode" value="deposit" ${this.payMode === 'deposit' ? 'checked' : ''}> ${esc(s.payDeposit(f(deposit)))}</label>
                <label class="option"><input type="radio" name="pay_mode" value="full" ${this.payMode === 'full' ? 'checked' : ''}> ${esc(s.payFull)}</label>
              </fieldset>`
            : ''
        }
      </div>
      <aside class="summary" aria-label="${esc(s.summary)}">
        <ul class="lines">${c.items.map((i) => `<li class="line"><span style="flex:1">${i.quantity > 1 ? `${i.quantity} × ` : ''}${esc(i.title)}${i.variant_title ? ` <span class="muted small">(${esc(i.variant_title)})</span>` : ''}</span><span>${esc(f(i.total_amount))}</span></li>`).join('')}</ul>
        <div class="totals"><dl>
          <div class="row"><dt>${esc(s.subtotal)}</dt><dd>${esc(f(c.totals.subtotal_amount))}</dd></div>
          ${c.totals.discount_amount > 0 ? `<div class="row success"><dt>${esc(s.discount)}</dt><dd>−${esc(f(c.totals.discount_amount))}</dd></div>` : ''}
          ${c.requires_shipping ? `<div class="row"><dt>${esc(s.shipping)}</dt><dd>${esc(rate ? (shipping ? f(shipping) : s.free) : '—')}</dd></div>` : ''}
          <div class="row strong"><dt>${esc(s.total)}</dt><dd data-total>${esc(f(c.totals.total_amount + shipping))}</dd></div>
        </dl></div>
        ${consentText ? `<label class="option small" style="margin-top:1em"><input type="checkbox" name="consent" required ${this.consent ? 'checked' : ''}> ${esc(consentText)}</label>` : ''}
        <button class="btn" part="button" type="submit" ${disabled ? 'disabled' : ''}>${esc(this.sending ? s.redirecting : s.pay)}</button>
        <p class="muted small">${esc(s.secure)}</p>
        ${this.error ? `<p class="danger small" role="alert">${esc(this.error)}</p>` : ''}
      </aside>
    </form>`;
  }
}
