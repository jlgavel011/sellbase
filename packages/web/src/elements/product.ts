import type { StorefrontProduct } from '@sellbase/sdk';
import { api } from '../api.js';
import { esc, SellbaseElement } from '../base.js';
import { t } from '../i18n.js';

/**
 * <sellbase-product product="espadin"></sellbase-product>: a full product page block with
 * a photo gallery, title, description and the buy box (price, options, quantity, button).
 * Attributes: `product` (slug), or `slug-param` to read the slug from the URL query
 * (e.g. slug-param="p" on /producto.html?p=espadin). Also sets the page title.
 * Styling: CSS variables (see base.ts) and ::part(title), ::part(gallery).
 */
export class SellbaseProduct extends SellbaseElement {
  static observedAttributes = ['product', 'slug-param'];
  private product: StorefrontProduct | null = null;
  private error = false;
  private index = 0;

  protected override css = `
    .wrap { display: grid; gap: 2em; }
    @media (min-width: 760px) { .wrap { grid-template-columns: 1.1fr 1fr; align-items: start; } }
    .main { aspect-ratio: 1; width: 100%; object-fit: cover; border-radius: var(--sellbase-radius, 10px);
      background: var(--sellbase-surface, #f4f4f5); border: 1px solid var(--sellbase-border, #e5e7eb); }
    .thumbs { display: flex; gap: .5em; margin-top: .75em; flex-wrap: wrap; }
    .thumb { width: 4.5em; height: 4.5em; padding: 0; border: 2px solid transparent; border-radius: calc(var(--sellbase-radius, 10px) * .6);
      overflow: hidden; cursor: pointer; background: none; }
    .thumb[aria-current="true"] { border-color: var(--sellbase-primary, #111); }
    .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    h1 { font-size: clamp(1.8em, 3vw, 2.4em); line-height: 1.1; margin: 0 0 .4em; letter-spacing: -.02em; }
    .desc { margin: 0 0 1.5em; white-space: pre-line; }
  `;

  attributeChangedCallback() {
    if (this.isConnected) void this.load();
  }

  private slug() {
    const param = this.getAttribute('slug-param');
    if (param) return new URLSearchParams(window.location.search).get(param);
    return this.getAttribute('product');
  }

  protected override async load() {
    const slug = this.slug();
    if (!slug) return;
    // The buy box lives in the light DOM (slotted) so it keeps its state across re-renders.
    let buy = this.querySelector<HTMLElement>('sellbase-add-to-cart[slot="buy"]');
    if (!buy) {
      buy = document.createElement('sellbase-add-to-cart');
      buy.setAttribute('slot', 'buy');
      this.appendChild(buy);
    }
    buy.setAttribute('product', slug);
    try {
      this.product = await api.product(slug);
      this.error = false;
      this.index = 0;
      if (this.hasAttribute('slug-param'))
        document.title = this.product.seo.title ?? this.product.title;
    } catch {
      this.error = true;
    }
    this.update();
  }

  protected override onAction(action: string, el: HTMLElement) {
    if (action === 'image') {
      this.index = Number(el.dataset.index ?? 0);
      this.update();
    }
  }

  protected render() {
    if (this.error) return `<p class="danger" role="alert">${esc(t().unavailable)}</p>`;
    const p = this.product;
    if (!p)
      return `<div class="wrap"><div class="skeleton main"></div><div class="skeleton"></div></div>`;
    const images = p.media.filter((m) => m.kind === 'image');
    const main = images[this.index] ?? images[0];
    const gallery = main
      ? `<img class="main" part="gallery" src="${esc(main.url)}" alt="${esc(main.alt || p.title)}">
         ${
           images.length > 1
             ? `<div class="thumbs">${images
                 .map(
                   (m, i) =>
                     `<button type="button" class="thumb" data-action="image" data-index="${i}" aria-current="${i === this.index}" aria-label="${esc(m.alt || `${p.title} ${i + 1}`)}"><img src="${esc(m.url)}" alt=""></button>`,
                 )
                 .join('')}</div>`
             : ''
         }`
      : `<div class="main" part="gallery" aria-hidden="true"></div>`;
    return `<div class="wrap">
      <div>${gallery}</div>
      <div>
        <h1 part="title">${esc(p.title)}</h1>
        ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
        <slot name="buy"></slot>
      </div>
    </div>`;
  }
}
