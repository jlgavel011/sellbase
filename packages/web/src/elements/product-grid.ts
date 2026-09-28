import type { StorefrontProductSummary } from '@sellbase/sdk';
import { api } from '../api.js';
import { esc, SellbaseElement } from '../base.js';
import { productHref } from '../config.js';
import { money, t } from '../i18n.js';

/**
 * <sellbase-product-grid collection="lo-mas-vendido" limit="12"></sellbase-product-grid>
 * Active products as linked cards. Links use config.productUrl (default /products/{slug}).
 */
export class SellbaseProductGrid extends SellbaseElement {
  static observedAttributes = ['collection', 'limit'];
  private products: StorefrontProductSummary[] | null = null;
  private failed = false;
  protected override css = `
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 1em; grid-template-columns: repeat(auto-fill, minmax(min(100%, 12em), 1fr)); }
    a { display: flex; flex-direction: column; color: inherit; text-decoration: none; border: 1px solid var(--sellbase-border, #e5e7eb); border-radius: var(--sellbase-radius, 10px); overflow: hidden; background: var(--sellbase-surface, transparent); }
    .img { aspect-ratio: 1; background: var(--sellbase-border, #e5e7eb); }
    .img img { width: 100%; height: 100%; object-fit: cover; }
    .txt { padding: .8em 1em; display: flex; flex-direction: column; gap: .2em; }
  `;
  attributeChangedCallback() {
    if (this.isConnected) void this.load();
  }
  protected override async load() {
    try {
      const collection = this.getAttribute('collection');
      this.products = (
        await api.products({
          ...(collection ? { collection } : {}),
          limit: Number(this.getAttribute('limit') ?? 24),
        })
      ).data;
    } catch {
      this.failed = true;
    }
    this.update();
  }
  protected render() {
    if (this.failed) return `<p class="danger" role="alert">${esc(t().loadError)}</p>`;
    if (!this.products)
      return `<div class="skeleton" aria-busy="true" style="min-height:12em"></div>`;
    return `<ul>${this.products
      .map((p) => {
        const price =
          p.min_price_amount !== null && p.currency ? money(p.min_price_amount, p.currency) : '';
        return `<li><a href="${esc(productHref(p.slug))}"><div class="img">${p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.image_alt ?? p.title)}" loading="lazy">` : ''}</div><div class="txt"><strong>${esc(p.title)}</strong><span class="muted">${esc(price)}</span></div></a></li>`;
      })
      .join('')}</ul>`;
  }
}
