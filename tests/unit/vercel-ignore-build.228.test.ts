import { describe, expect, it } from 'vitest';
import {
  classifyVercelBranch,
  decideVercelBuild,
  runVercelIgnoreCommand,
} from '../../scripts/ci/vercel-ignore-build.mjs';

const SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('Issue #228 Vercel ignored-build exact-SHA Preview canary', () => {
  it('preserves main and explicit preview branch classification', () => {
    expect(classifyVercelBranch('main', SHA, 'production')).toBe('MAIN');
    expect(classifyVercelBranch('preview/acceptance-v1', SHA, 'preview')).toBe('EXPLICIT_PREVIEW');
  });

  it('allows only a full ref SHA that exactly matches the commit SHA in Preview', () => {
    expect(classifyVercelBranch(SHA, SHA, 'preview')).toBe('EXACT_SHA_PREVIEW');
    expect(classifyVercelBranch(SHA.toUpperCase(), SHA, 'PREVIEW')).toBe('EXACT_SHA_PREVIEW');

    expect(classifyVercelBranch(SHA, OTHER_SHA, 'preview')).toBe('BLOCKED');
    expect(classifyVercelBranch(SHA, SHA, 'production')).toBe('BLOCKED');
    expect(classifyVercelBranch(SHA, SHA, '')).toBe('BLOCKED');
    expect(classifyVercelBranch(SHA.slice(0, 7), SHA, 'preview')).toBe('BLOCKED');
    expect(classifyVercelBranch('feature/example', SHA, 'preview')).toBe('BLOCKED');
  });

  it('builds the exact-SHA Preview canary without needing a previous main SHA', () => {
    expect(runVercelIgnoreCommand({
      VERCEL_GIT_COMMIT_REF: SHA,
      VERCEL_GIT_COMMIT_SHA: SHA,
      VERCEL_TARGET_ENV: 'preview',
    })).toBe(1);
  });

  it('does not let a SHA-shaped Production deployment bypass the branch allowlist', () => {
    expect(runVercelIgnoreCommand({
      VERCEL_GIT_COMMIT_REF: SHA,
      VERCEL_GIT_COMMIT_SHA: SHA,
      VERCEL_TARGET_ENV: 'production',
    })).toBe(0);
  });

  it('keeps arbitrary Preview-environment branches blocked', () => {
    expect(runVercelIgnoreCommand({
      VERCEL_GIT_COMMIT_REF: 'feature/not-allowlisted',
      VERCEL_GIT_COMMIT_SHA: SHA,
      VERCEL_TARGET_ENV: 'preview',
    })).toBe(0);
  });

  it('keeps the pure decision helper fail-closed for mismatched SHA or target', () => {
    expect(decideVercelBuild({
      ref: SHA,
      currentSha: SHA,
      targetEnv: 'preview',
      comparable: false,
      runtimeChanged: false,
    })).toBe('BUILD');

    expect(decideVercelBuild({
      ref: SHA,
      currentSha: OTHER_SHA,
      targetEnv: 'preview',
      comparable: false,
      runtimeChanged: true,
    })).toBe('IGNORE');

    expect(decideVercelBuild({
      ref: SHA,
      currentSha: SHA,
      targetEnv: 'production',
      comparable: false,
      runtimeChanged: true,
    })).toBe('IGNORE');
  });
});
