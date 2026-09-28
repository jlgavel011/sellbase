# Examples

| Example                        | Stack                                  | Deploy                                                                                                                                                                                                                                                                               |
| ------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`nextjs-store`](nextjs-store) | Next.js 16, Tailwind, React components | [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/jlgavel011/sellbase&root-directory=examples/nextjs-store&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,NEXT_PUBLIC_SELLBASE_URL,NEXT_PUBLIC_SITE_URL) |
| [`html-landing`](html-landing) | Plain HTML, web components             | [![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/jlgavel011/sellbase&base=examples/html-landing)                                                                                             |

Start from one with:

```bash
npx sellbase create my-store --template nextjs
npx sellbase create my-landing --template html
```

The components in `nextjs-store/components/sellbase/` are copied from `packages/registry` by `pnpm examples:sync`, and CI checks that they are up to date.
