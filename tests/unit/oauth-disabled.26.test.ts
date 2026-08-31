import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const page = readFileSync(
  resolve(process.cwd(), 'src/app/tenant/login/page.tsx'),
  'utf8',
);
const copy = readFileSync(
  resolve(process.cwd(), 'src/i18n/zh-TW/pages/login.ts'),
  'utf8',
);

describe('OAuth buttons (#26 first slice)', () => {
  it('keeps both provider buttons disabled until platform OAuth is configured', () => {
    expect(page).toContain('data-testid="oauth-line-disabled"');
    expect(page).toContain('data-testid="oauth-google-disabled"');
    expect(page.match(/data-testid="oauth-(?:line|google)-disabled"[\s\S]*?disabled/g)?.length).toBe(2);
    expect(page).not.toContain('href={OAUTH.line}');
    expect(page).not.toContain('href={OAUTH.google}');
    expect(page).not.toContain('/api/auth/oauth/line/authorize');
    expect(page).not.toContain('/api/auth/oauth/google/authorize');
  });

  it('uses honest not-configured and coming-soon i18n copy', () => {
    expect(copy).toContain("notConfigured: '第三方登入尚未完成設定，預計後續支援。'");
    expect(copy).toContain("comingSoon: '即將支援'");
  });
});
