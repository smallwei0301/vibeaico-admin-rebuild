import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tripCoverBlockedByListing } from '@/lib/trip-cover';
import { tripsPage } from '@/i18n/zh-TW/pages/trips';

describe('#42 已上架 Midao 行程封面不可直寫（Codex P1）', () => {
  it('helper 只在 LISTED 為 true', () => {
    expect(tripCoverBlockedByListing('LISTED')).toBe(true);
    for (const v of ['UNLISTED', 'REJECTED', 'PENDING', '', null, undefined]) {
      expect(tripCoverBlockedByListing(v as string | null | undefined)).toBe(false);
    }
  });
  it('頁面 handler 在上傳／移除前先早退，按鈕停用並顯示說明', () => {
    const src = readFileSync('src/app/tenant/trips/[id]/page.tsx', 'utf8');
    expect(src).toContain('tripCoverBlockedByListing(trip?.midaoListing)');
    expect(src).toMatch(/if \(!file \|\| !canEditCover \|\| coverListedBlocked \|\| coverBusy \|\| busy\) return;/);
    expect(src).toMatch(/if \(!canEditCover \|\| coverListedBlocked \|\| coverBusy \|\| busy\) return;/);
    expect(src.match(/disabled=\{!canEditCover \|\| coverListedBlocked \|\| coverBusy \|\| busy\}/g)).toHaveLength(2);
    expect(src).toContain('t.form.coverListedReadonly');
    expect(tripsPage.form.coverListedReadonly).toBeTruthy();
  });
  it('PUT route：僅含封面時帶 .neq LISTED 條件更新，0 列重讀後回 409／404', () => {
    const src = readFileSync('src/app/api/trips/[id]/route.ts', 'utf8');
    const put = src.slice(src.indexOf('export const PUT'), src.indexOf('export const DELETE'));
    expect(put).toContain("const coverTouched = 'cover_image_url' in patch;");
    expect(put).toContain("if (coverTouched) query = query.neq('midao_listing', 'LISTED');");
    expect(put).toContain('tripsPage.actions.coverListedBlocked');
    expect(put).toMatch(/if \(still\) return fail\(409/);
    expect(put).toMatch(/return fail\(404/);
    expect(put).toContain("error?.code === '23505'");
  });
});
