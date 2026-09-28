# @sellbase/web

Sellbase web components for any site: plain HTML, WordPress, Webflow, Vue, Svelte, Astro or Angular. Shadow DOM, themed with CSS variables, 13 KB gzipped.

```html
<script>
  window.SellbaseConfig = {
    url: 'https://<project>.supabase.co/functions/v1/sellbase-api',
    anonKey: '<anon key>',
  };
</script>
<script type="module" src="https://unpkg.com/@sellbase/web/dist/sellbase.js"></script>

<sellbase-cart-button></sellbase-cart-button>
<sellbase-add-to-cart product="my-product-slug"></sellbase-add-to-cart>
<sellbase-cart-drawer></sellbase-cart-drawer>
<!-- on /checkout: -->
<sellbase-checkout></sellbase-checkout>
<!-- on /gracias: -->
<sellbase-checkout-return></sellbase-checkout-return>
```

Elements:

- `sellbase-add-to-cart`, `sellbase-price`, `sellbase-product-grid`;
- `sellbase-product`: a full product page (gallery, title, description and buy box). Use `product="<slug>"`, or `slug-param="p"` to read the slug from `?p=` so one `producto.html` serves every product (set `productUrl: '/producto.html?p={slug}'` in `SellbaseConfig`);
- `sellbase-cart-button`, `sellbase-cart-drawer`;
- `sellbase-checkout` (shows the consent checkbox the store requires), `sellbase-checkout-return`;
- `sellbase-order-lookup`, `sellbase-download`.

Theme them with `--sellbase-primary`, `--sellbase-text`, `--sellbase-border`, `--sellbase-radius`… and `::part()`.

---

Part of [Sellbase](https://github.com/jlgavel011/sellbase), open source commerce that lives inside your project. MIT licensed.
