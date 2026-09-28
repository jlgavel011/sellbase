// dist/standalone/: index.html + admin.js + styles.css + config.example.js, a static admin.
import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('dist/standalone', { recursive: true });
await build({
  entryPoints: ['standalone/main.tsx'],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  jsx: 'automatic',
  minify: true,
  sourcemap: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  outfile: 'dist/standalone/admin.js',
  legalComments: 'none',
});
await copyFile('standalone/index.html', 'dist/standalone/index.html');
await copyFile('standalone/config.example.js', 'dist/standalone/config.example.js');
await copyFile('dist/styles.css', 'dist/standalone/styles.css');
console.log('built dist/standalone');
