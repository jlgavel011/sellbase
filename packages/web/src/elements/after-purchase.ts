import { icons } from '../icons.js';
import type { DownloadInfo, OrderSummary } from '@sellbase/sdk';
import { api } from '../api.js';
import { esc, SellbaseElement } from '../base.js';
import { getConfig } from '../config.js';
import { intlLocale, money, t } from '../i18n.js';
import { cart } from '../store.js';

function summary(o: OrderSummary) {
  const s = t();
  const f = (n: number) => money(n, o.currency);
  const when = (iso: string, tz: string) =>
    new Intl.DateTimeFormat(intlLocale(), {
      timeZone: tz,
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(new Date(iso));
  const status =
    o.status === 'cancelled'
      ? s.cancelled
      : o.fulfillment_status === 'unfulfilled'
        ? s.preparing
        : s.shipped;
  const due = o.total_amount - o.amount_paid;
  return `<div class="stack order">
    <p><strong>${esc(s.order(o.number))}</strong> · ${esc(status)}</p>
    <ul class="box">
      ${o.items.map((i) => `<li class="row"><span>${i.quantity > 1 ? `${i.quantity} × ` : ''}${esc(i.title)}${i.variant_title ? ` (${esc(i.variant_title)})` : ''}</span><span>${esc(f(i.total_amount))}</span></li>`).join('')}
      ${o.discount_amount > 0 ? `<li class="row success"><span>${esc(s.discount)}</span><span>−${esc(f(o.discount_amount))}</span></li>` : ''}
      ${o.shipping_amount > 0 ? `<li class="row"><span>${esc(s.shipping)}</span><span>${esc(f(o.shipping_amount))}</span></li>` : ''}
      <li class="row strong"><span>${esc(s.total)}</span><span>${esc(f(o.total_amount))}</span></li>
    </ul>
    ${due > 0 && o.status !== 'cancelled' ? `<p class="small">${esc(s.depositDue(f(o.amount_paid), f(due)))}</p>` : ''}
    ${o.bookings.map((b) => `<p class="small">${icons.calendar} <strong>${esc(b.title)}</strong>: ${esc(when(b.starts_at, b.timezone))}${b.meeting_url ? ` · <a href="${esc(b.meeting_url)}">${esc(s.sessionLink)}</a>` : ''}</p>`).join('')}
    ${o.shipments.map((sh) => `<p class="small">${icons.truck} ${esc(s.trackWith(sh.carrier, sh.tracking_number))}${sh.tracking_url ? ` · <a href="${esc(sh.tracking_url)}">${esc(s.track)}</a>` : ''}</p>`).join('')}
    ${o.has_downloads ? `<p class="small">${icons.download} ${esc(s.downloadsEmailed(o.email))}</p>` : ''}
  </div>`;
}

const summaryCss = `
  .box { list-style: none; margin: 0; padding: 0; border: 1px solid var(--sellbase-border, #e5e7eb); border-radius: var(--sellbase-radius, 10px); }
  .box li { padding: .7em 1em; border-bottom: 1px solid var(--sellbase-border, #e5e7eb); }
  .box li:last-child { border-bottom: 0; }
  .strong { font-weight: 700; }
  .order { text-align: left; }
  a { color: inherit; }
`;

/**
 * <sellbase-checkout-return></sellbase-checkout-return>: the page the buyer lands on after
 * paying (e.g. /gracias). Reads ?sellbase_checkout, shows "Confirmando tu pago…" until
 * the payment webhook arrives (it can come before or after the buyer), then the order,
 * and clears the cart. Attributes: `cart-url`, `home-url`, `heading`.
 */
export class SellbaseCheckoutReturn extends SellbaseElement {
  private checkoutId: string | null = null;
  private status: Awaited<ReturnType<typeof api.checkoutStatus>> | null = null;
  private failed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  protected override css = `${summaryCss} :host { text-align: center; } h1 { font-size: 1.6em; }
    .spin { display: inline-block; width: 1em; height: 1em; border: 2px solid var(--sellbase-border, #d4d4d8); border-top-color: var(--sellbase-primary, #111); border-radius: 50%; animation: s 1s linear infinite; vertical-align: -2px; }
    @keyframes s { to { transform: rotate(360deg); } } @media (prefers-reduced-motion: reduce) { .spin { animation: none; } }`;

  protected override async load() {
    this.checkoutId = new URLSearchParams(window.location.search).get('sellbase_checkout');
    if (this.checkoutId) await this.poll();
    else this.update();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    if (this.timer) clearTimeout(this.timer);
  }

  private async poll() {
    try {
      this.status = await api.checkoutStatus(this.checkoutId ?? '');
      if (this.status.status === 'paid') cart.clear();
      if (this.status.status === 'pending')
        this.timer = setTimeout(
          () => void this.poll(),
          Number(this.getAttribute('interval') ?? 2500),
        );
    } catch {
      this.failed = true;
    }
    this.update();
  }

  protected render() {
    const s = t();
    const heading = `<h1>${esc(this.getAttribute('heading') ?? s.thanks)}</h1>`;
    let body: string;
    if (!this.checkoutId || this.failed) body = `<p>${esc(s.checkEmail)}</p>`;
    else if (!this.status || this.status.status === 'pending')
      body = `<p role="status"><span class="spin" aria-hidden="true"></span> ${esc(s.confirming)}</p>`;
    else if (this.status.status === 'expired')
      body = `<p>${esc(s.expired)}</p><p><a href="${esc(this.getAttribute('cart-url') ?? getConfig().cartUrl ?? '/')}">${esc(s.backToCart)}</a></p>`;
    else
      body = `<p class="success"><strong>${esc(s.paid)}</strong></p>${this.status.order ? summary(this.status.order) : ''}<p><a href="${esc(this.getAttribute('home-url') ?? '/')}">${esc(s.continueShopping)}</a></p>`;
    return `<section aria-live="polite" class="stack">${heading}${body}</section>`;
  }
}

/** <sellbase-order-lookup></sellbase-order-lookup>: order number + email → status, items, tracking. */
export class SellbaseOrderLookup extends SellbaseElement {
  private number = '';
  private email = '';
  private order: OrderSummary | null = null;
  private error: string | null = null;
  private busy = false;
  protected override css = `${summaryCss} form { display: grid; gap: .75em; } @media (min-width: 640px) { form { grid-template-columns: 8em 1fr auto; align-items: end; } } h1 { font-size: 1.6em; }`;
  protected override onInput(el: HTMLInputElement) {
    if (el.name === 'number') this.number = el.value;
    if (el.name === 'email') this.email = el.value;
  }
  protected override async onSubmit() {
    this.busy = true;
    this.error = null;
    this.order = null;
    this.update();
    try {
      this.order = await api.lookup(Number(this.number.replace('#', '')), this.email);
    } catch (error) {
      this.error =
        (error as { code?: string }).code === 'RATE_LIMITED' ? t().tooMany : t().notFound;
    }
    this.busy = false;
    this.update();
  }
  protected render() {
    const s = t();
    return `<section class="stack"><h1>${esc(this.getAttribute('heading') ?? s.whereIsMyOrder)}</h1>
      <form>
        <label class="field" for="n">${esc(s.orderNumber)}<input class="input" part="input" id="n" name="number" required inputmode="numeric" placeholder="#1001" value="${esc(this.number)}"></label>
        <label class="field" for="e">${esc(s.purchaseEmail)}<input class="input" part="input" id="e" name="email" type="email" required autocomplete="email" value="${esc(this.email)}"></label>
        <button class="btn" part="button" type="submit" ${this.busy ? 'disabled' : ''}>${esc(s.search)}</button>
      </form>
      <div aria-live="polite">${this.error ? `<p class="danger" role="alert">${esc(this.error)}</p>` : ''}${this.order ? summary(this.order) : ''}</div>
    </section>`;
  }
}

/**
 * <sellbase-download></sellbase-download>: page for download links. Reads the token from
 * the `token` attribute or ?token=; set store setting download_page_url to
 * https://<site>/descargas?token={token} so emails link here.
 */
export class SellbaseDownload extends SellbaseElement {
  private info: DownloadInfo | null = null;
  private failed = false;
  protected override css = `:host { text-align: center; } h1 { font-size: 1.6em; }`;
  protected override async load() {
    const token =
      this.getAttribute('token') ?? new URLSearchParams(window.location.search).get('token');
    if (!token) {
      this.failed = true;
      this.update();
      return;
    }
    try {
      this.info = await api.download(token);
    } catch {
      this.failed = true;
    }
    this.update();
  }
  protected render() {
    const s = t();
    const d = this.info;
    const body = this.failed
      ? `<p role="alert">${esc(s.invalidLink)}</p>`
      : !d
        ? `<div class="skeleton" aria-busy="true"></div>`
        : `<p><strong>${esc(d.product_title)}</strong><br><span class="muted small">${esc(d.file_name)}</span></p>
           ${
             d.status === 'ready'
               ? `<p><a class="btn" part="button" href="${esc(d.download_url)}">${esc(s.download)}</a></p>
                  <p class="muted small">${d.download_limit !== null ? esc(s.downloadsLeft(d.download_limit - d.downloads_used, d.download_limit)) + ' ' : ''}${esc(s.availableUntil(new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'long', timeStyle: 'short' }).format(new Date(d.expires_at))))}</p>`
               : `<p role="alert">${esc(d.status === 'expired' ? s.expiredLink : s.usedLink)}</p>`
           }`;
    return `<section class="stack" aria-live="polite"><h1>${esc(this.getAttribute('heading') ?? s.yourDownload)}</h1>${body}</section>`;
  }
}
