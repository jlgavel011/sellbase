// Serves this plain HTML site like any static host, plus what `sellbase init` would copy:
// /sellbase/sellbase.js, /sellbase/config.js and the static admin at /admin/.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';

const here = import.meta.dirname;
const repo = resolve(here, '../..');
const port = Number(process.env.PORT ?? 3200);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.json': 'application/json',
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let path = decodeURIComponent(url.pathname);
  if (path === '/sellbase/config.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    return res.end(
      `window.SellbaseConfig = { url: ${JSON.stringify(`${supabaseUrl}/functions/v1/sellbase-api`)}, anonKey: ${JSON.stringify(anonKey)}, productUrl: '/?p={slug}', checkoutUrl: '/checkout.html', successUrl: '/gracias.html' };`,
    );
  }
  if (path === '/admin/config.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    return res.end(
      `window.SellbaseAdminConfig = { supabaseUrl: ${JSON.stringify(supabaseUrl)}, supabaseAnonKey: ${JSON.stringify(anonKey)}, theme: { primary: '#181b3c' } };`,
    );
  }
  let file;
  if (path === '/sellbase/sellbase.js') file = join(repo, 'packages/web/dist/sellbase.js');
  else if (path.startsWith('/admin'))
    file = join(
      repo,
      'packages/admin/dist/standalone',
      path.replace(/^\/admin\/?/, '') || 'index.html',
    );
  else file = join(here, path === '/' ? 'index.html' : path);
  if (!existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`static site on http://localhost:${port}`));
