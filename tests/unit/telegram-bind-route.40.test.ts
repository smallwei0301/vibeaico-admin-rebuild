import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const route = readFileSync('src/app/api/telegram/bind/route.ts', 'utf8');

describe('Telegram binding entry point (#40, 17 §4)', () => {
  it('requires a tenant manager and issues a one-time code rather than storing it in the route', () => {
    expect(route).toMatch(/requireTenant\('MANAGER'\)/);
    expect(route).toMatch(/issueTelegramBindCode\(/);
    expect(route).toMatch(/https:\/\/t\.me\/\$\{username\}\?start=\$\{code\}/);
    expect(route).not.toMatch(/\.insert\(/);
  });
});
