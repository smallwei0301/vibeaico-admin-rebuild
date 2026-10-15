// #1007：首頁 LINE 卡需 Channel ID、Access Token 與 Channel Secret 都設定才 CONNECTED。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hasLineCredentials, linePlatformStatusFromRow } from '@/server/line-connection';

const src = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

const L = { channelId: '1234567890' };

describe('linePlatformStatusFromRow (#1007)', () => {
  it('只有 token → NOT_CONFIGURED', () => {
    expect(linePlatformStatusFromRow({ line: L, line_channel_access_token_enc: 'tok', line_channel_secret_enc: '' }))
      .toBe('NOT_CONFIGURED');
  });
  it('只有 secret → NOT_CONFIGURED', () => {
    expect(linePlatformStatusFromRow({ line: L, line_channel_access_token_enc: '', line_channel_secret_enc: 'sec' }))
      .toBe('NOT_CONFIGURED');
  });
  it('token + secret 但 channelId 缺漏／空白 → NOT_CONFIGURED', () => {
    for (const line of [{}, { channelId: '' }, { channelId: '   ' }, { channelId: 123 }]) {
      expect(linePlatformStatusFromRow({ line, line_channel_access_token_enc: 'tok', line_channel_secret_enc: 'sec' }))
        .toBe('NOT_CONFIGURED');
    }
  });
  it('line 為 null／undefined／非物件 → NOT_CONFIGURED', () => {
    for (const line of [null, undefined, 'x']) {
      expect(linePlatformStatusFromRow({ line, line_channel_access_token_enc: 'tok', line_channel_secret_enc: 'sec' }))
        .toBe('NOT_CONFIGURED');
    }
  });
  it('三者皆有 → CONNECTED', () => {
    expect(linePlatformStatusFromRow({ line: L, line_channel_access_token_enc: 'tok', line_channel_secret_enc: 'sec' }))
      .toBe('CONNECTED');
  });
  it('空字串／null／undefined／非字串 → NOT_CONFIGURED', () => {
    expect(linePlatformStatusFromRow({ line: L, line_channel_access_token_enc: '', line_channel_secret_enc: '' })).toBe('NOT_CONFIGURED');
    expect(linePlatformStatusFromRow(null)).toBe('NOT_CONFIGURED');
    expect(linePlatformStatusFromRow(undefined)).toBe('NOT_CONFIGURED');
    expect(hasLineCredentials({ line: L, line_channel_access_token_enc: 1, line_channel_secret_enc: true })).toBe(false);
  });
});

describe('route 接線 (#1007)', () => {
  it('dashboard route select 三個欄位並使用純函式', () => {
    const s = src('src/app/api/reports/dashboard/route.ts');
    const sel = /from\('tenant_settings'\)\.select\('([^']*)'\)/.exec(s)?.[1] ?? '';
    for (const col of ['line', 'line_channel_access_token_enc', 'line_channel_secret_enc']) {
      expect(sel.split(',').map((c) => c.trim())).toContain(col);
    }
    expect(s).toContain('linePlatformStatusFromRow(settingsRow)');
  });
  it('setup-status route 同樣 select 三個欄位並使用純函式', () => {
    const s = src('src/app/api/settings/setup-status/route.ts');
    const sel = /from\('tenant_settings'\)\s*\.select\('([^']*)'\)/.exec(s)?.[1] ?? '';
    for (const col of ['line', 'line_channel_access_token_enc', 'line_channel_secret_enc']) {
      expect(sel.split(',').map((c) => c.trim())).toContain(col);
    }
    expect(s).toContain('hasLineCredentials(settingsRow)');
  });
});
