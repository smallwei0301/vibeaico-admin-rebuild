// #1007：首頁 LINE 卡需 Access Token 與 Channel Secret 都設定才 CONNECTED。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hasLineCredentials, linePlatformStatusFromRow } from '@/server/line-connection';

const src = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

describe('linePlatformStatusFromRow (#1007)', () => {
  it('只有 token → NOT_CONFIGURED', () => {
    expect(linePlatformStatusFromRow({ line_channel_access_token_enc: 'tok', line_channel_secret_enc: '' }))
      .toBe('NOT_CONFIGURED');
  });
  it('只有 secret → NOT_CONFIGURED', () => {
    expect(linePlatformStatusFromRow({ line_channel_access_token_enc: '', line_channel_secret_enc: 'sec' }))
      .toBe('NOT_CONFIGURED');
  });
  it('兩者皆有 → CONNECTED', () => {
    expect(linePlatformStatusFromRow({ line_channel_access_token_enc: 'tok', line_channel_secret_enc: 'sec' }))
      .toBe('CONNECTED');
  });
  it('空字串／null／undefined／非字串 → NOT_CONFIGURED', () => {
    expect(linePlatformStatusFromRow({ line_channel_access_token_enc: '', line_channel_secret_enc: '' })).toBe('NOT_CONFIGURED');
    expect(linePlatformStatusFromRow(null)).toBe('NOT_CONFIGURED');
    expect(linePlatformStatusFromRow(undefined)).toBe('NOT_CONFIGURED');
    expect(hasLineCredentials({ line_channel_access_token_enc: 1, line_channel_secret_enc: true })).toBe(false);
  });
});

describe('route 接線 (#1007)', () => {
  it('dashboard route 同時 select 兩個欄位並使用純函式', () => {
    const s = src('src/app/api/reports/dashboard/route.ts');
    expect(s).toContain("select('line_channel_access_token_enc, line_channel_secret_enc')");
    expect(s).toContain('linePlatformStatusFromRow(settingsRow)');
  });
  it('setup-status route 同樣使用兩個欄位', () => {
    const s = src('src/app/api/settings/setup-status/route.ts');
    expect(s).toContain('line_channel_secret_enc');
    expect(s).toContain('hasLineCredentials(settingsRow)');
  });
});
