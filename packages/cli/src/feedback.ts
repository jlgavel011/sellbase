import { feedbackIssue, type FeedbackKind } from '@sellbase/core';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { detectProject } from './project.js';
import { bold, cliError, log } from './util.js';
import { VERSION } from './version.js';

export interface FeedbackOptions {
  kind: string;
  title?: string;
  summary?: string;
  steps?: string;
  expected?: string;
  workaround?: string;
  detailsFile?: string;
  area?: string;
  agent?: string;
  open: boolean;
}

/**
 * `sellbase feedback`: drafts a GitHub issue for the Sellbase maintainers (bug, idea, or
 * something the agent built on top of Sellbase). Secrets and personal data are redacted,
 * the draft is printed, and the owner submits it in the browser. Nothing is sent from here.
 */
export async function feedback(cwd: string, options: FeedbackOptions) {
  const kind = options.kind as FeedbackKind;
  if (!['bug', 'idea', 'extension'].includes(kind))
    throw cliError(
      '--kind must be bug, idea or extension.',
      'Example: sellbase feedback --kind bug …',
    );
  if (!options.title || !options.summary)
    throw cliError(
      'A title and a summary are required.',
      'Example: sellbase feedback --kind bug --title "Checkout 400 with consent" --summary "…"',
    );
  const project = await detectProject(cwd).catch(() => null);
  const issue = feedbackIssue({
    kind,
    title: options.title,
    summary: options.summary,
    steps: options.steps,
    expected: options.expected,
    workaround: options.workaround,
    details: options.detailsFile ? await readFile(options.detailsFile, 'utf8') : undefined,
    area: options.area,
    context: {
      version: VERSION,
      project: project?.framework ?? 'unknown',
      node: process.version,
      ...(options.agent ? { agent: options.agent } : {}),
    },
  });
  console.log(bold(`\nDraft for the Sellbase maintainers (redacted):\n`));
  console.log(`[${kind}] ${issue.title}\n\n${issue.body}`);
  console.log(bold('Review it, then submit it on GitHub:'));
  console.log(issue.url);
  if (options.open) {
    const opener =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    try {
      spawn(opener, [issue.url], {
        stdio: 'ignore',
        detached: true,
        shell: process.platform === 'win32',
      }).unref();
      log.info('Opened the prefilled issue in your browser. Nothing is sent until you submit it.');
    } catch {
      log.info('Open the link above to submit it.');
    }
  }
}
