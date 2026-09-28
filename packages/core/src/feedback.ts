import { BRAND } from './brand.js';

/**
 * Feedback to the Sellbase maintainers, drafted by an AI agent or the CLI. Nothing is sent
 * by this code: it builds a prefilled GitHub issue link that the store owner opens and
 * submits themselves, after reading it. Secrets and personal data are redacted first.
 */
export type FeedbackKind = 'bug' | 'idea' | 'extension';

export interface FeedbackInput {
  kind: FeedbackKind;
  title: string;
  /** What happened, or what the owner needed. */
  summary: string;
  steps?: string | undefined;
  expected?: string | undefined;
  /** For kind "extension": what the agent built on top of Sellbase for this store. */
  workaround?: string | undefined;
  /** Error code/message/hint, doctor output, logs. Redacted before use. */
  details?: string | undefined;
  area?: string | undefined;
  context?: { version?: string; project?: string; node?: string; agent?: string } | undefined;
}

const PATTERNS: [RegExp, string][] = [
  [/sb_live_[A-Za-z0-9_-]+/g, 'sb_live_[redacted]'],
  [/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]+/g, '$1_$2_[redacted]'],
  [/\bwhsec_[A-Za-z0-9]+/g, 'whsec_[redacted]'],
  [/\bre_[A-Za-z0-9_]{8,}/g, 're_[redacted]'],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt redacted]'],
  [/\bsb_(secret|publishable)_[A-Za-z0-9_-]+/g, 'sb_$1_[redacted]'],
  [/postgres(ql)?:\/\/[^\s"'`]+/g, 'postgresql://[redacted]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/\+\d[\d\s().-]{8,}\d/g, '[phone]'],
  [/\b\d{10}\b/g, '[phone]'],
];

/** Removes API keys, tokens, connection strings, emails and phone numbers. */
export function redact(text: string): string {
  return PATTERNS.reduce((out, [re, to]) => out.replace(re, to), text);
}

const LABELS: Record<FeedbackKind, string> = {
  bug: 'bug,from-agent',
  idea: 'enhancement,from-agent',
  extension: 'enhancement,extension,from-agent',
};

/** Max body length that still fits comfortably in a GitHub "new issue" URL. */
const MAX_BODY = 6000;

export function feedbackIssue(input: FeedbackInput) {
  const section = (title: string, value: string | undefined) =>
    value?.trim() ? `### ${title}\n\n${redact(value.trim())}\n\n` : '';
  const ctx = input.context ?? {};
  const env = [
    ctx.version && `- Sellbase: ${ctx.version}`,
    ctx.project && `- Project: ${ctx.project}`,
    ctx.node && `- Node: ${ctx.node}`,
    ctx.agent && `- Reported by: ${ctx.agent}`,
    input.area && `- Area: ${input.area}`,
  ]
    .filter(Boolean)
    .join('\n');
  let body =
    section(
      input.kind === 'bug'
        ? 'What happened'
        : input.kind === 'extension'
          ? 'What the store needed'
          : 'Idea',
      input.summary,
    ) +
    section('Steps to reproduce', input.steps) +
    section('Expected', input.expected) +
    section('What was built on top of Sellbase', input.workaround) +
    section('Details', input.details ? `\`\`\`\n${input.details}\n\`\`\`` : undefined) +
    (env ? `### Environment\n\n${env}\n\n` : '') +
    '_Drafted by an AI agent and reviewed by the store owner before sending. Secrets and personal data were redacted._\n';
  if (body.length > MAX_BODY) body = `${body.slice(0, MAX_BODY - 40)}\n\n… (truncated)\n`;
  const title = redact(input.title).slice(0, 200);
  const url = `https://github.com/${BRAND.repo}/issues/new?${new URLSearchParams({
    title: `[${input.kind}] ${title}`,
    labels: LABELS[input.kind],
    body,
  }).toString()}`;
  return { title, body, url };
}
