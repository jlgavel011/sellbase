import type { StorefrontProduct } from '@sellbase/sdk';
import { api } from '../api.js';
import { esc, SellbaseElement } from '../base.js';
import { money, t, intlLocale } from '../i18n.js';
import { cart, setDrawer, state } from '../store.js';

type Variant = StorefrontProduct['variants'][number];
type Slots = Awaited<ReturnType<typeof api.availability>>;

/**
 * <sellbase-add-to-cart product="espadin"></sellbase-add-to-cart>
 * Price, options (Talla, Color…), quantity and the button, for one product (its slug).
 * Services show day and time chips in the store's time zone. Attributes: `product`
 * (slug, required), `variant` (preselect by id), `hide-price`, `hide-quantity`,
 * `label` (button text), `no-drawer` (do not open the cart after adding).
 * Styling: CSS variables (see base.ts) and ::part(button).
 */
export class SellbaseAddToCart extends SellbaseElement {
  static observedAttributes = ['product', 'variant'];
  private product: StorefrontProduct | null = null;
  private error = false;
  private selected: Record<string, string> = {};
  private quantity = 1;
  private slots: Slots | null = null;
  private day: string | null = null;
  private pickedSlot: string | null = null;
  private busy = false;
  private message: string | null = null;

  protected override css = `
    .price { font-size: 1.25em; font-weight: 600; }
    .price s { font-weight: 400; margin-left: .5em; }
    .qty { width: 5em; }
    .opt-label { font-size: .9em; margin-bottom: .35em; }
  `;

  attributeChangedCallback() {
    if (this.isConnected) void this.load();
  }

  protected override async load() {
    const slug = this.getAttribute('product');
    if (!slug) return;
    try {
      this.product = await api.product(slug);
      this.error = false;
      const pre = this.getAttribute('variant');
      const v =
        this.product.variants.find((x) => x.id === pre) ??
        (this.product.variants.length === 1 ? this.product.variants[0] : undefined);
      if (v) this.selected = { ...v.option_values };
      if (this.product.type === 'service' && this.variant()) await this.loadSlots();
    } catch {
      this.error = true;
    }
    this.update();
  }

  private variant(): Variant | null {
    const variants = this.product?.variants ?? [];
    if (variants.length === 1) return variants[0] ?? null;
    return (
      variants.find(
        (v) =>
          Object.entries(this.selected).length === (this.product?.options.length ?? 0) &&
          Object.entries(this.selected).every(([k, val]) => v.option_values[k] === val),
      ) ?? null
    );
  }

  private async loadSlots() {
    const v = this.variant();
    if (!v) return;
    this.slots = await api.availability(v.id).catch(() => null);
    this.day = null;
    this.pickedSlot = null;
  }

  private dayKey(iso: string) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.slots?.timezone ?? 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso));
  }

  protected override onAction(action: string, el: HTMLElement) {
    if (action === 'option') {
      this.selected = { ...this.selected, [el.dataset.name ?? '']: el.dataset.value ?? '' };
      this.message = null;
      if (this.product?.type === 'service') void this.loadSlots().then(() => this.update());
      this.update();
    }
    if (action === 'day') {
      this.day = el.dataset.day ?? null;
      this.pickedSlot = null;
      this.update();
    }
    if (action === 'slot') {
      this.pickedSlot = el.dataset.slot ?? null;
      this.update();
    }
    if (action === 'add') void this.add();
  }

  protected override onInput(el: HTMLInputElement) {
    if (el.name === 'quantity') this.quantity = Math.max(1, Math.min(999, Number(el.value) || 1));
  }

  private async add() {
    const v = this.variant();
    if (!v) return;
    this.busy = true;
    this.message = null;
    this.update();
    try {
      const service = this.product?.type === 'service';
      await cart.add(
        v.id,
        service ? 1 : this.quantity,
        service && this.pickedSlot ? { starts_at: this.pickedSlot } : undefined,
      );
      this.dispatchEvent(
        new CustomEvent('sellbase:added', {
          bubbles: true,
          composed: true,
          detail: { variantId: v.id },
        }),
      );
      if (!this.hasAttribute('no-drawer')) setDrawer(true);
    } catch (error) {
      this.message = (error as Error).message;
    } finally {
      this.busy = false;
      this.update();
    }
  }

  protected render() {
    const s = t();
    const p = this.product;
    if (this.error) return `<p class="danger small" role="alert">${esc(s.unavailable)}</p>`;
    if (!p) return `<div class="skeleton" aria-busy="true" aria-label="${esc(s.loading)}"></div>`;
    const v = this.variant();
    const service = p.type === 'service';
    const price = v
      ? `${money(v.price_amount, v.currency)}${v.compare_at_amount ? `<s class="muted">${money(v.compare_at_amount, v.currency)}</s>` : ''}`
      : p.min_price_amount !== null && p.currency
        ? `${s.from} ${money(p.min_price_amount, p.currency)}`
        : '';
    const options = p.options
      .map((o) => {
        const id = `opt-${o.name}`;
        const chips = o.values
          .map((value) => {
            const wanted = { ...this.selected, [o.name]: value };
            const available = p.variants.some(
              (x) =>
                x.available &&
                Object.entries(wanted).every(([k, val]) => x.option_values[k] === val),
            );
            const on = this.selected[o.name] === value;
            return `<button type="button" class="chip ${available ? '' : 'chip--out'}" role="radio" aria-checked="${on}" data-action="option" data-name="${esc(o.name)}" data-value="${esc(value)}" aria-label="${esc(available ? value : `${value} (${s.soldOut.toLowerCase()})`)}">${esc(value)}</button>`;
          })
          .join('');
        return `<div><p class="opt-label" id="${esc(id)}">${esc(o.name)}</p><div class="chips" role="radiogroup" aria-labelledby="${esc(id)}">${chips}</div></div>`;
      })
      .join('');
    let booking = '';
    if (service && v) {
      const tz = this.slots?.timezone ?? 'UTC';
      const byDay = new Map<string, Slots['slots']>();
      for (const slot of this.slots?.slots ?? [])
        byDay.set(this.dayKey(slot.starts_at), [
          ...(byDay.get(this.dayKey(slot.starts_at)) ?? []),
          slot,
        ]);
      const day = this.day && byDay.has(this.day) ? this.day : ([...byDay.keys()][0] ?? null);
      const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
        new Intl.DateTimeFormat(intlLocale(), { timeZone: tz, ...opts }).format(new Date(iso));
      booking = !this.slots
        ? `<div class="skeleton" aria-busy="true"></div>`
        : byDay.size === 0
          ? `<p class="muted small">${esc(s.noTimes)}</p>`
          : `<div class="chips" role="tablist" aria-label="${esc(s.days)}">${[...byDay.keys()]
              .map(
                (k) =>
                  `<button type="button" role="tab" class="chip" aria-selected="${k === day}" data-action="day" data-day="${esc(k)}">${esc(fmt(byDay.get(k)?.[0]?.starts_at ?? '', { weekday: 'short', day: 'numeric', month: 'short' }))}</button>`,
              )
              .join('')}</div>
             <div class="chips" role="radiogroup" aria-label="${esc(s.times)}">${(
               byDay.get(day ?? '') ?? []
             )
               .map(
                 (slot) =>
                   `<button type="button" class="chip" role="radio" aria-checked="${this.pickedSlot === slot.starts_at}" data-action="slot" data-slot="${esc(slot.starts_at)}">${esc(fmt(slot.starts_at, { hour: 'numeric', minute: '2-digit' }))}</button>`,
               )
               .join('')}</div>
             <p class="muted small">${esc(s.timesIn(tz))}</p>`;
    }
    const label = !v
      ? s.chooseOption
      : !v.available
        ? s.soldOut
        : service && !this.pickedSlot
          ? s.chooseTime
          : this.busy || state.updating
            ? s.adding
            : (this.getAttribute('label') ?? s.addToCart);
    const disabled = !v || !v.available || (service && !this.pickedSlot) || this.busy;
    const qty =
      p.type === 'physical' && !this.hasAttribute('hide-quantity')
        ? `<label class="field">${esc(s.quantity)}<input class="input qty" id="qty" name="quantity" type="number" min="1" max="${v?.available_quantity ?? 999}" value="${this.quantity}"></label>`
        : '';
    return `<div class="stack">
      ${this.hasAttribute('hide-price') ? '' : `<p class="price" aria-live="polite">${price}</p>`}
      ${options}${booking}${qty}
      <button type="button" class="btn" part="button" data-action="add" ${disabled ? 'disabled' : ''}>${esc(label)}</button>
      ${this.message ? `<p class="danger small" role="alert">${esc(this.message)}</p>` : ''}
    </div>`;
  }
}

/** <sellbase-price product="espadin"></sellbase-price>: the price (or "Desde …"), inline. */
export class SellbasePrice extends SellbaseElement {
  private product: StorefrontProduct | null = null;
  protected override css = `:host { display: inline; }`;
  protected override async load() {
    const slug = this.getAttribute('product');
    if (slug) this.product = await api.product(slug).catch(() => null);
    this.update();
  }
  protected render() {
    const p = this.product;
    if (!p || p.min_price_amount === null || !p.currency) return '';
    return p.min_price_amount === p.max_price_amount
      ? esc(money(p.min_price_amount, p.currency))
      : `${esc(t().from)} ${esc(money(p.min_price_amount, p.currency))}`;
  }
}
