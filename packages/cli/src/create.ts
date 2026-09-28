import { cp, readdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { assetsDir, bold, cliError, log } from './util.js';

export const TEMPLATES = {
  nextjs: {
    folder: 'nextjs-store',
    label: 'Next.js store',
    steps: ['npm install', 'npm run setup', 'npm run dev'],
  },
  html: {
    folder: 'html-landing',
    label: 'HTML landing page',
    steps: [
      'npx supabase init && npx supabase start',
      'npx sellbase init --yes --seed cafeteria',
      'npx serve .',
    ],
  },
} as const;

export type TemplateName = keyof typeof TEMPLATES;

/** Copies an example into a new folder. npm drops .gitignore files, so assets ship them as _gitignore. */
export async function create(cwd: string, dir: string, options: { template: string }) {
  const template = TEMPLATES[options.template as TemplateName];
  if (!template)
    throw cliError(
      `Unknown template "${options.template}".`,
      `Use one of: ${Object.keys(TEMPLATES).join(', ')}.`,
    );
  const target = resolve(cwd, dir);
  if (existsSync(target) && (await readdir(target)).length > 0)
    throw cliError(`${dir} already exists and is not empty.`, 'Pick a new folder name.');

  await cp(join(assetsDir, 'examples', template.folder), target, { recursive: true });
  if (existsSync(join(target, '_gitignore')))
    await rename(join(target, '_gitignore'), join(target, '.gitignore'));

  log.step(`Created ${template.label} in ${relative(cwd, target) || '.'}`);
  console.log(`\n${bold('Next:')}\n  cd ${relative(cwd, target) || '.'}`);
  for (const step of template.steps) console.log(`  ${step}`);
  console.log(
    `\nThe admin is at /admin; the owner's email and password end up in .env.sellbase.\n`,
  );
}
