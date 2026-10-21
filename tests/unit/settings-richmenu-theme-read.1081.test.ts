import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { lineSettingsReadSchema, lineSettingsSchema } from '@/config/tenant-settings';

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('#1081 讀取容忍未知 richMenuTheme、寫入維持嚴格', () => {
  it.each(['BOUTIQUE', 'nonsense'])('讀取 schema 把 %s 回退為 LINE_GREEN，其他欄位不變', (theme) => {
    const r = lineSettingsReadSchema.parse({ richMenuTheme: theme, richMenuId: ' rm_1 ', richMenuTextColor: '#000000' });
    expect(r.richMenuTheme).toBe('LINE_GREEN');
    expect(r.richMenuId).toBe('rm_1');
    expect(r.richMenuTextColor).toBe('#000000');
  });

  it('合法主題原樣保留；缺值預設 LINE_GREEN', () => {
    expect(lineSettingsReadSchema.parse({ richMenuTheme: 'DARK' }).richMenuTheme).toBe('DARK');
    expect(lineSettingsReadSchema.parse({}).richMenuTheme).toBe('LINE_GREEN');
  });

  it('rich-menu/create 使用的 partial 讀取 schema 同樣容忍，且缺值維持 undefined', () => {
    const p = lineSettingsReadSchema.partial();
    expect(p.parse({ richMenuTheme: 'BOUTIQUE' }).richMenuTheme).toBe('LINE_GREEN');
    expect(p.parse({}).richMenuTheme).toBeUndefined();
  });

  it('寫入 schema 仍拒絕 BOUTIQUE', () => {
    expect(lineSettingsSchema.safeParse({ richMenuTheme: 'BOUTIQUE' }).success).toBe(false);
    expect(lineSettingsSchema.safeParse({ richMenuTheme: 'DARK' }).success).toBe(true);
  });

  it('create 路由用讀取 schema；設計頁不再提供 BOUTIQUE', () => {
    expect(src('src/app/api/settings/line/rich-menu/create/route.ts')).toMatch(/lineSettingsReadSchema\.partial\(\)\.parse/);
    expect(src('src/app/tenant/rich-menu-design/page.tsx')).not.toContain('BOUTIQUE');
    expect(src('src/i18n/zh-TW/pages/rich-menu-design.ts')).not.toContain('BOUTIQUE');
  });
});
