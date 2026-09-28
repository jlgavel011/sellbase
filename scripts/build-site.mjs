#!/usr/bin/env node
/**
 * Builds the public docs site (GitHub Pages) into site-dist/:
 * - index.html: the Sellbase landing;
 * - llms.txt, llms-full.txt and every linked Markdown file at the paths llms.txt uses,
 *   so agents can read the raw docs;
 * - an HTML page per guide, skill and the API reference.
 *   node scripts/build-site.mjs   (run `pnpm docs:build` first)
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { marked } from 'marked';

const repo = resolve(import.meta.dirname, '..');
const out = join(repo, 'site-dist');
const SITE = 'https://jlgavel011.github.io/sellbase';
const REPO = 'https://github.com/jlgavel011/sellbase';
const version = JSON.parse(readFileSync(join(repo, 'packages/cli/package.json'), 'utf8')).version;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const write = (path, content) => {
  mkdirSync(dirname(join(out, path)), { recursive: true });
  writeFileSync(join(out, path), content);
};
const esc = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ── Raw docs for agents (same relative paths as llms.txt) ──────────────────────
const pages = [
  { md: 'README.md', from: 'README.md', title: 'README' },
  ...readdirSync(join(repo, 'docs/guides')).map((f) => ({
    md: `guides/${f}`,
    from: `docs/guides/${f}`,
  })),
  ...readdirSync(join(repo, 'skills'))
    .filter((d) => existsSync(join(repo, 'skills', d, 'SKILL.md')))
    .map((d) => ({ md: `skills/${d}/SKILL.md`, from: `skills/${d}/SKILL.md` })),
  { md: 'reference/api.md', from: 'docs/reference/api.md', title: 'API reference' },
];
write('llms.txt', readFileSync(join(repo, 'docs/llms.txt'), 'utf8'));
write('llms-full.txt', readFileSync(join(repo, 'docs/llms-full.txt'), 'utf8'));
cpSync(join(repo, 'docs/images'), join(out, 'images'), { recursive: true });
write('.nojekyll', '');

const MARK = readFileSync(join(repo, 'docs/images/sellbase-mark.svg'), 'utf8');
const favicon = `data:image/svg+xml,${encodeURIComponent(MARK.replace(/\n\s*/g, ''))}`;

const css = `
:root { --ink:#0d0c1d; --ink2:#17152f; --text:#2b2d42; --strong:#0f1024; --muted:#6b6f86; --line:#e6e8f0; --bg:#f5f6fa;
  --brand:#5b4bff; --grad:linear-gradient(135deg,#8b7bff 0%,#5b4bff 48%,#1fb8e6 100%); }
* { box-sizing: border-box; }
body { margin:0; font:16px/1.6 "Inter var","Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; color:var(--text); background:#fff; -webkit-font-smoothing:antialiased; }
a { color: var(--brand); }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em; }
.nav { position:sticky; top:0; z-index:10; display:flex; align-items:center; gap:24px; padding:14px 24px; background:rgba(13,12,29,.92); backdrop-filter:blur(10px); }
.nav a { color:#c8c6e0; text-decoration:none; font-weight:500; font-size:15px; }
.nav a:hover { color:#fff; }
.logo { display:flex; align-items:center; gap:10px; color:#fff !important; font-weight:700; font-size:19px; letter-spacing:-.04em; margin-right:auto; }
.logo svg { width:30px; height:30px; }
.btn { display:inline-flex; align-items:center; gap:8px; padding:11px 18px; border-radius:12px; font-weight:600; text-decoration:none; }
.btn-primary { background:var(--grad); color:#fff !important; box-shadow:0 10px 30px -10px rgba(91,75,255,.7); }
.btn-ghost { color:#fff !important; border:1px solid rgba(255,255,255,.2); }
.hero { position:relative; overflow:hidden; background:var(--ink); color:#fff; padding:96px 24px 110px; text-align:center; }
.hero::before { content:''; position:absolute; inset:0; background:radial-gradient(50% 60% at 15% 0%,rgba(124,107,255,.45),transparent 70%),radial-gradient(45% 55% at 90% 100%,rgba(31,184,230,.35),transparent 70%); }
.hero::after { content:''; position:absolute; inset:0; opacity:.07; background-image:linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px); background-size:36px 36px; }
.hero > * { position:relative; z-index:1; }
.pill { display:inline-block; padding:6px 14px; border-radius:999px; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.14); font-size:14px; color:#d9d7f2; }
h1 { font-size:clamp(38px,6vw,68px); line-height:1.05; letter-spacing:-.04em; margin:22px auto 18px; max-width:900px; }
.grad { background:var(--grad); -webkit-background-clip:text; background-clip:text; color:transparent; }
.lead { font-size:clamp(17px,2vw,21px); color:#bdbbd8; max-width:720px; margin:0 auto 34px; }
.cta { display:flex; gap:12px; justify-content:center; flex-wrap:wrap; }
.term { max-width:640px; margin:44px auto 0; text-align:left; background:#08071a; border:1px solid rgba(255,255,255,.12); border-radius:16px; overflow:hidden; box-shadow:0 30px 80px -30px rgba(91,75,255,.6); }
.term-bar { display:flex; gap:7px; padding:12px 14px; border-bottom:1px solid rgba(255,255,255,.08); }
.term-bar i { width:11px; height:11px; border-radius:50%; background:#2c2a47; }
.term pre { margin:0; padding:18px 20px; color:#e8e6ff; line-height:1.8; white-space:pre-wrap; }
.term .c { color:#7d7a9e; }
.term .ok { color:#5eead4; }
section.band { padding:88px 24px; max-width:1120px; margin:0 auto; }
section.band h2 { font-size:clamp(28px,3.6vw,40px); letter-spacing:-.03em; color:var(--strong); margin:0 0 12px; }
section.band p.sub { color:var(--muted); font-size:18px; max-width:680px; margin:0 0 40px; }
.grid { display:grid; gap:18px; grid-template-columns:repeat(auto-fit,minmax(250px,1fr)); }
.card { border:1px solid var(--line); border-radius:18px; padding:22px; background:#fff; }
.card h3 { margin:12px 0 6px; color:var(--strong); font-size:18px; }
.card p { margin:0; color:var(--muted); font-size:15px; }
.ico { display:grid; place-items:center; width:40px; height:40px; border-radius:12px; background:#efedff; color:var(--brand); font-weight:700; }
.shot { border-radius:18px; border:1px solid var(--line); box-shadow:0 30px 70px -30px rgba(15,16,36,.35); width:100%; display:block; }
.dark { background:var(--ink); color:#d9d7f2; }
.dark section.band h2 { color:#fff; }
.dark section.band p.sub { color:#a9a7c6; }
.dark .card { background:var(--ink2); border-color:rgba(255,255,255,.1); }
.dark .card h3 { color:#fff; }
.dark .card p { color:#a9a7c6; }
.dark pre.code { background:#08071a; border:1px solid rgba(255,255,255,.1); color:#e8e6ff; border-radius:14px; padding:16px 18px; overflow:auto; }
footer { padding:40px 24px; text-align:center; color:var(--muted); font-size:14px; border-top:1px solid var(--line); }
/* Docs pages */
.doc { display:grid; grid-template-columns:260px minmax(0,1fr); max-width:1200px; margin:0 auto; }
.doc aside { position:sticky; top:58px; align-self:start; height:calc(100vh - 58px); overflow:auto; padding:28px 20px; border-right:1px solid var(--line); font-size:14px; }
.doc aside h4 { margin:18px 0 6px; font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
.doc aside a { display:block; padding:4px 8px; border-radius:8px; color:var(--text); text-decoration:none; }
.doc aside a:hover, .doc aside a.on { background:#efedff; color:var(--brand); }
.doc article { padding:36px 48px 80px; min-width:0; }
.doc article h1 { font-size:36px; margin:0 0 20px; color:var(--strong); }
.doc article h2 { margin-top:36px; color:var(--strong); letter-spacing:-.02em; }
.doc article pre { background:#0f0e22; color:#e8e6ff; padding:16px; border-radius:12px; overflow:auto; }
.doc article :not(pre) > code { background:#f1f0fb; padding:2px 6px; border-radius:6px; }
.doc article table { border-collapse:collapse; width:100%; display:block; overflow:auto; }
.doc article th, .doc article td { border:1px solid var(--line); padding:8px 10px; text-align:left; }
.doc article img { max-width:100%; }
.raw { font-size:13px; color:var(--muted); }
@media (max-width: 820px) { .doc { grid-template-columns:1fr; } .doc aside { position:static; height:auto; border-right:0; border-bottom:1px solid var(--line); } .doc article { padding:24px 18px 60px; } .nav .hide-sm { display:none; } }
`;

const head = (title, description) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}">
<link rel="icon" href="${favicon}"><link rel="alternate" type="text/plain" title="llms.txt" href="${SITE}/llms.txt">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${SITE}/images/admin-home.png"><meta name="twitter:card" content="summary_large_image">
<style>${css}</style></head><body>`;
const nav = `<nav class="nav"><a class="logo" href="${SITE}/">${MARK.replace('<svg ', '<svg aria-hidden="true" ')}sellbase</a>
<a class="hide-sm" href="${SITE}/guides/getting-started.html">Docs</a><a class="hide-sm" href="${SITE}/reference/api.html">API</a>
<a class="hide-sm" href="${SITE}/llms.txt">llms.txt</a><a href="${REPO}">GitHub</a></nav>`;

// ── Docs pages ─────────────────────────────────────────────────────────────────
const titleOf = (md, fallback) => /^#\s+(.+)$/m.exec(md)?.[1]?.trim() ?? fallback;
const docs = pages.map((p) => {
  const md = readFileSync(join(repo, p.from), 'utf8');
  write(p.md, md);
  return { ...p, source: md, title: p.title ?? titleOf(md.replace(/^---[\s\S]*?---\n/, ''), p.md) };
});
const groups = [
  ['Guides', docs.filter((d) => d.md.startsWith('guides/'))],
  ['Agent skills', docs.filter((d) => d.md.startsWith('skills/'))],
  ['Reference', docs.filter((d) => d.md.startsWith('reference/'))],
];
for (const d of docs) {
  if (d.md === 'README.md') continue;
  const htmlPath = d.md.replace(/\.md$/, '.html');
  const body = marked
    .parse(d.source.replace(/^---[\s\S]*?---\n/, ''), { gfm: true })
    .replace(/href="(?!https?:|#|mailto:)([^"]+?)\.md(#[^"]*)?"/g, 'href="$1.html$2"');
  const side = groups
    .map(
      ([name, list]) =>
        `<h4>${name}</h4>${list.map((x) => `<a href="${SITE}/${x.md.replace(/\.md$/, '.html')}"${x === d ? ' class="on"' : ''}>${esc(x.title)}</a>`).join('')}`,
    )
    .join('');
  write(
    htmlPath,
    `${head(`${d.title} · Sellbase`, `Sellbase docs: ${d.title}`)}${nav}<div class="doc"><aside>${side}</aside><article>${body}<p class="raw">Raw Markdown for agents: <a href="${SITE}/${d.md}">${d.md}</a> · Edit on <a href="${REPO}/blob/main/${d.from}">GitHub</a></p></article></div></body></html>`,
  );
}

// ── Landing ────────────────────────────────────────────────────────────────────
const features = [
  [
    'AI',
    'Your agent runs the store',
    'Skills, an MCP server and errors with hints: Claude, Cursor or any agent installs Sellbase, creates products, connects Stripe and proves it with a test purchase.',
  ],
  [
    '$',
    'Yours, no platform fees',
    'Your repo, your Supabase, your Stripe account. MIT licensed. Money in integers, RLS on every table, secrets in Vault.',
  ],
  [
    '⌘',
    'An admin people love',
    'Products with drag and drop photos and variants, orders, inventory, abandoned carts, discounts, bookings and a command palette.',
  ],
  [
    '</>',
    'Any site',
    'React components for Next.js and Vite, or <sellbase-*> web components for plain HTML, WordPress, Webflow, Astro or Vue.',
  ],
  [
    '↻',
    'Recover sales',
    'Abandoned checkout emails that restore the cart, discount codes, manual orders from WhatsApp, and payment links.',
  ],
  [
    '✓',
    'Production ready',
    'Stripe live checks, signed outbound webhooks, packing slips, refunds, emails with your brand, and `sellbase upgrade` with backups.',
  ],
];
write(
  'index.html',
  `${head('Sellbase: open source commerce your AI can run', 'Turn any project into a store in minutes. Open source commerce on your own Supabase: catalog, Stripe checkout, orders, a beautiful admin, an API and an MCP server for your AI agent.')}${nav}
<header class="hero">
  <span class="pill">Open source · MIT · v${version}</span>
  <h1>Commerce your <span class="grad">AI agent</span> can install and run.</h1>
  <p class="lead">Turn any project into a store: catalog, Stripe checkout, orders, inventory and a beautiful admin, on your own Supabase. No platform fees. No lock-in.</p>
  <div class="cta"><a class="btn btn-primary" href="${SITE}/guides/getting-started.html">Get started</a><a class="btn btn-ghost" href="${REPO}">Star on GitHub</a></div>
  <div class="term"><div class="term-bar"><i></i><i></i><i></i></div><pre><span class="c"># in your project</span>
npx supabase start
npx sellbase init --yes
<span class="ok">✔ Store, admin at /admin, components, MCP server and agent skills</span>

<span class="c"># or in Claude Code</span>
/plugin marketplace add jlgavel011/sellbase
/plugin install sellbase@sellbase
/sellbase:setup I sell handmade candles, $250 MXN each</pre></div>
</header>
<section class="band">
  <h2>Everything a store needs. Nothing you don't own.</h2>
  <p class="sub">Sellbase installs inside your project and your Supabase. Your agent does the setup; you run the business from an admin built for store owners.</p>
  <div class="grid">${features.map(([i, t, p]) => `<div class="card"><span class="ico">${esc(i)}</span><h3>${esc(t)}</h3><p>${esc(p)}</p></div>`).join('')}</div>
</section>
<section class="band"><img class="shot" src="images/admin-home.png" alt="Sellbase admin home with setup guide, AI copilot and sales"></section>
<div class="dark"><section class="band">
  <h2>Built to be used by agents</h2>
  <p class="sub">Agents learn Sellbase from the docs, act through MCP tools with scoped tokens, and ask the owner before anything that moves money.</p>
  <div class="grid">
    <div class="card"><h3>MCP server</h3><p><code>npx sellbase mcp</code>, listed as <code>io.github.jlgavel011/sellbase</code>. Tools for products, orders, refunds, discounts, bookings, webhooks, docs search and <code>test_purchase</code>.</p></div>
    <div class="card"><h3>llms.txt</h3><p>Every guide, skill and API route in plain text: <a href="${SITE}/llms.txt">llms.txt</a> and <a href="${SITE}/llms-full.txt">llms-full.txt</a>.</p></div>
    <div class="card"><h3>Agents improve Sellbase</h3><p>When an agent hits a bug or builds an extension, it drafts a redacted report; the owner decides whether to share it.</p></div>
  </div>
  <pre class="code">Tell your agent:
"Quiero convertir mi landing en una tienda con Sellbase. Vendo [productos] a [precios].
 Instálalo, crea mis productos, conecta Stripe en modo prueba y haz una compra de prueba."</pre>
</section></div>
<section class="band"><div class="grid">
  <img class="shot" src="images/admin-product-editor.png" alt="Product editor with photos and variants">
  <img class="shot" src="images/admin-order.png" alt="Order page with timeline and packing slip">
</div></section>
<footer>Sellbase is open source under the MIT license · <a href="${REPO}">GitHub</a> · <a href="https://www.npmjs.com/package/sellbase">npm</a> · <a href="${SITE}/llms.txt">llms.txt</a></footer>
</body></html>`,
);

// Sitemap for search engines and agents.
const urls = [
  '',
  ...docs.filter((d) => d.md !== 'README.md').map((d) => d.md.replace(/\.md$/, '.html')),
];
write(
  'sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${SITE}/${u}</loc></url>`).join('')}</urlset>\n`,
);
write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
// ── shadcn-compatible registry: npx shadcn add https://…/r/<name>.json ─────────────
// Same files `sellbase add` copies. They need the Sellbase backend (`npx sellbase init`).
{
  const R = `${SITE}/r`;
  const registry = JSON.parse(
    readFileSync(join(repo, 'packages/registry/registry.json'), 'utf8'),
  ).components;
  const file = (from, target) => ({
    path: target,
    type: 'registry:file',
    target,
    content: readFileSync(join(repo, from), 'utf8'),
  });
  const docs =
    'Sellbase storefront components need the Sellbase backend in your Supabase: run `npx sellbase init --yes`. ' +
    'Wrap the app in SellbaseStoreProvider (components/sellbase/provider.tsx) and import components/sellbase/theme.css in your global CSS. ' +
    `Guide: ${SITE}/guides/nextjs-supabase-ecommerce.html`;
  const items = [
    ...registry.map((c) => ({
      name: c.name,
      type: 'registry:component',
      title: c.name,
      description: c.description,
      dependencies:
        c.dependencies ?? (c.name === 'theme' || c.name === 'icons' ? [] : ['@sellbase/react']),
      // Every component pulls in the provider, which carries the setup notes (printed once).
      registryDependencies: [
        ...(c.name === 'theme' || c.name === 'icons' ? [] : ['provider']),
        ...(c.registryDependencies ?? []),
      ].map((d) => `${R}/${d}.json`),
      files: c.files.map((f) => file(`packages/registry/${f}`, f)),
    })),
    {
      name: 'provider',
      type: 'registry:component',
      title: 'provider',
      description:
        'SellbaseStoreProvider: connects the storefront components to your Sellbase API.',
      dependencies: ['@sellbase/react'],
      registryDependencies: [`${R}/theme.json`],
      files: [file('templates/provider.tsx', 'components/sellbase/provider.tsx')],
      envVars: {
        NEXT_PUBLIC_SELLBASE_URL: 'http://127.0.0.1:54321/functions/v1/sellbase-api',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
      },
    },
    {
      name: 'store',
      type: 'registry:block',
      title: 'Sellbase store',
      description:
        'Everything for a storefront: provider, theme, product grid, carousel and detail, SEO, cart drawer and page, checkout and order status.',
      dependencies: ['@sellbase/react'],
      registryDependencies: [
        'provider',
        'theme',
        'product-grid',
        'product-carousel',
        'product-detail',
        'product-seo',
        'cart-drawer',
        'cart-page',
        'checkout',
        'order-status',
      ].map((d) => `${R}/${d}.json`),
      files: [],
    },
  ].map((item) => (item.name === 'provider' ? { ...item, docs } : item));
  for (const item of items)
    write(
      `r/${item.name}.json`,
      JSON.stringify(
        { $schema: 'https://ui.shadcn.com/schema/registry-item.json', ...item },
        null,
        2,
      ),
    );
  write(
    'r/registry.json',
    JSON.stringify(
      {
        $schema: 'https://ui.shadcn.com/schema/registry.json',
        name: 'sellbase',
        homepage: SITE,
        items: items.map(({ files, ...item }) => ({
          ...item,
          files: files.map(({ content: _content, ...f }) => f),
        })),
      },
      null,
      2,
    ),
  );
}

console.log(`Site built in site-dist/ (${docs.length} docs pages)`);
