import { createSellbase } from '@sellbase/sdk';
import { bold, dim, green, red, yellow } from './util.js';

/** Prints the /doctor checklist; returns whether nothing failed. */
export async function printDoctor(
  creds: { url: string; token: string; anonKey?: string | undefined },
  options: { json?: boolean; exitOnFail?: boolean } = {},
) {
  const sellbase = createSellbase({
    url: creds.url,
    token: creds.token,
    ...(creds.anonKey ? { anonKey: creds.anonKey } : {}),
  });
  const doctor = await sellbase.admin.doctor();
  if (options.json) {
    console.log(JSON.stringify(doctor, null, 2));
  } else {
    console.log(bold('Setup checklist'));
    for (const check of doctor.checks) {
      const mark =
        check.status === 'ok' ? green('✔') : check.status === 'warn' ? yellow('▲') : red('✖');
      console.log(`  ${mark} ${check.label} ${dim(check.message)}`);
      if (check.hint && check.status !== 'ok') console.log(`    ${dim('→ ' + check.hint)}`);
    }
  }
  if (!doctor.ok && options.exitOnFail) process.exitCode = 1;
  return doctor.ok;
}
