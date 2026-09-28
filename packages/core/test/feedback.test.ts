import { describe, expect, it } from 'vitest';
import { feedbackIssue, redact } from '../src/feedback.js';

describe('feedback', () => {
  it('redacts secrets and personal data', () => {
    const text = [
      'token sb_live_abc123XYZ and sk_live_51Habc and sk_test_4eC39',
      'whsec_1234567890abc re_AbCdEf123456 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig_part',
      'postgresql://postgres:secret@db.example.co:5432/postgres',
      'buyer ana.lopez@example.com phone +52 55 1234 5678 or 5512345678',
      'at 2026-09-28 09:20:57 order #1001',
    ].join('\n');
    const out = redact(text);
    for (const leak of [
      'abc123XYZ',
      '51Habc',
      '4eC39',
      '1234567890abc',
      'AbCdEf123456',
      'eyJhbGci',
      'secret@',
      'ana.lopez',
      '1234 5678',
      '5512345678',
    ])
      expect(out).not.toContain(leak);
    expect(out).toContain('2026-09-28 09:20:57');
    expect(out).toContain('#1001');
  });

  it('builds a prefilled GitHub issue link', () => {
    const issue = feedbackIssue({
      kind: 'bug',
      title: 'Checkout fails for ana@example.com',
      summary: 'VALIDATION_ERROR when paying',
      steps: '1. add to cart\n2. pay',
      details: 'code: VALIDATION_ERROR key sk_test_abc',
      context: { version: '0.3.0', project: 'web' },
    });
    const url = new URL(issue.url);
    expect(url.pathname).toBe('/jlgavel011/sellbase/issues/new');
    expect(url.searchParams.get('title')).toBe('[bug] Checkout fails for [email]');
    expect(url.searchParams.get('labels')).toContain('bug');
    const body = url.searchParams.get('body') ?? '';
    expect(body).toContain('### Steps to reproduce');
    expect(body).toContain('- Sellbase: 0.3.0');
    expect(body).not.toContain('sk_test_abc');
  });
});
