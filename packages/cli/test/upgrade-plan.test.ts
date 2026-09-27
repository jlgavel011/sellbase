import { describe, expect, it } from 'vitest';
import { pendingMigrations, planFile } from '../src/upgrade-plan.js';
import { sha256Hex } from '../src/util.js';

describe('pendingMigrations', () => {
  const files = [
    '0000_foundation.sql',
    '0007_webhooks.sql',
    '0008_webhooks_scope.sql',
    'README.md',
  ];
  it('lists only newer numbered migrations, in order', () => {
    expect(pendingMigrations('0007', files)).toEqual(['0008_webhooks_scope.sql']);
    expect(pendingMigrations('0008', files)).toEqual([]);
    expect(pendingMigrations(null, files)).toEqual([
      '0000_foundation.sql',
      '0007_webhooks.sql',
      '0008_webhooks_scope.sql',
    ]);
  });
});

describe('planFile', () => {
  const v1 = 'export const a = 1;\n';
  const v2 = 'export const a = 2;\n';
  const tracked = { source: 'registry/x.tsx', sha256: sha256Hex(v1) };

  it('updates files the owner did not touch', () => {
    expect(planFile({ path: 'x.tsx', tracked, current: v1, base: v1, upstream: v2 })).toEqual({
      path: 'x.tsx',
      action: 'update',
      content: v2,
    });
    expect(planFile({ path: 'x.tsx', tracked, current: v1, base: v1, upstream: v1 }).action).toBe(
      'current',
    );
  });

  it('never overwrites edits: hands over the upstream change as a diff', () => {
    const edited = 'export const a = 1; // mine\n';
    const plan = planFile({ path: 'x.tsx', tracked, current: edited, base: v1, upstream: v2 });
    expect(plan.action).toBe('diff');
    if (plan.action === 'diff') {
      expect(plan.diff).toContain('-export const a = 1;');
      expect(plan.diff).toContain('+export const a = 2;');
      expect(plan.diff).not.toContain('mine');
    }
  });

  it('keeps edited files alone when upstream did not change, and respects deletions', () => {
    expect(
      planFile({ path: 'x.tsx', tracked, current: 'mine\n', base: v1, upstream: v1 }).action,
    ).toBe('current');
    expect(planFile({ path: 'x.tsx', tracked, current: null, base: v1, upstream: v2 }).action).toBe(
      'missing',
    );
  });
});
