import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const helper = readFileSync('tests/helpers/auth.ts', 'utf8');

describe('integration auth helper session contract', () => {
  it('preflights a fresh login and renews one invalidated test session before retrying', () => {
    expect(helper).toMatch(/await signIn\(\);\s*\/\/ A successful login[\s\S]*?await request\('\/api\/auth\/me'\)/);
    expect(helper).toMatch(/if \(response\.status === 401 && path !== '\/api\/auth\/me'\)[\s\S]*?await signIn\(\);[\s\S]*?response = await request\(path, init\)/);
  });
});
