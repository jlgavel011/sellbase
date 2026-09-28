# @sellbase/admin

The Sellbase admin: products with photos and variants, inventory, orders, abandoned checkouts, customers, discounts, appointments and settings for payments, shipping, taxes, email, team, AI agents and webhooks.

```tsx
import { SellbaseAdmin } from '@sellbase/admin';
import '@sellbase/admin/styles.css';

export default function Admin() {
  return (
    <SellbaseAdmin
      config={{
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        basePath: '/admin',
      }}
    />
  );
}
```

Mount it on a catch-all route (`app/admin/[[...path]]/page.tsx`). Sites without React use the static build in `dist/standalone` (hash routes, no server rewrites), which `sellbase init` copies for you.

Customize it with `config`: theme, logo, texts, slots and extra pages. See the [guide](https://github.com/jlgavel011/sellbase/blob/main/docs/guides/customize-admin.md). Styles are scoped to `.sb-admin` and never touch your site.

---

Part of [Sellbase](https://github.com/jlgavel011/sellbase), open source commerce that lives inside your project. MIT licensed.
