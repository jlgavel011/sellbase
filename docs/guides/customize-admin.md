# Customize the admin

The admin is a package (`@sellbase/admin`), not code copied into your project, so updates never overwrite your changes. Customize it through its `config`: theme, logo, texts, named slots and extra pages.

```tsx
// app/admin/[[...path]]/page.tsx (Next.js) or src/sellbase/admin-page.tsx (Vite)
<SellbaseAdmin
  config={{
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    locale: 'es', // or 'en'
    theme: { primary: '#7c3aed', radius: '0.625rem', fontFamily: 'Inter, sans-serif' },
    logo: { src: '/logo.svg', alt: 'My store' }, // defaults to the logo from Settings → General
    texts: { nav: { orders: 'Ventas' } }, // override any label
    slots: {
      'home.top': ({ sellbase }) => <MyAnnouncement />,
      'order.detail.sidebar': ({ orderId }) => <InvoiceButton orderId={orderId} />,
    },
    pages: [{ path: 'reportes', label: 'Reportes', icon: 'chart', render: () => <MyReports /> }],
  }}
/>
```

On sites without React, the same options go in `admin/config.js` (`window.SellbaseAdminConfig`). Only values can be set there: no slots or pages.

## Slots

| Slot                      | Where                                              |
| ------------------------- | -------------------------------------------------- |
| `home.top`, `home.bottom` | Home, above and below the setup guide and metrics  |
| `orders.list.top`         | Orders list                                        |
| `order.detail.sidebar`    | Order page, right column (receives `orderId`)      |
| `products.list.top`       | Products list                                      |
| `product.form.bottom`     | Product editor (receives `productId` when editing) |
| `settings.bottom`         | Settings → General                                 |
| `sidebar.bottom`          | Side menu, above Settings                          |

Every slot receives `sellbase` (the typed API client with the signed-in staff session) and `navigate(path)`.

## Extra pages

Each entry in `pages` adds an item to the side menu and a route under the admin.

- `icon`: one of the admin icon names (`chart`, `store`, `mail`, `users`, `tag`, `file`, …) or a short text.
- `render`: receives the same context as slots.

## Theme

- `theme.primary` colors the primary buttons.
- The rest of the admin uses Sellbase's neutral design tokens, so any brand color looks right.
- The admin's styles are scoped to `.sb-admin` and never touch your site's CSS.

## Going further

Sellbase is open source (MIT). If you need something the config cannot do, open an issue or a pull request, since other stores probably need it too. Forking `@sellbase/admin` works, but you lose automatic updates.
