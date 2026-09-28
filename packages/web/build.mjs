// One file for <script type="module" src="sellbase.js">: registers every element.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/browser.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  minify: true,
  sourcemap: true,
  outfile: 'dist/sellbase.js',
  legalComments: 'none',
});
console.log('built dist/sellbase.js');
