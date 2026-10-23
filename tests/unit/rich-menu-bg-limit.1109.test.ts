import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { LINE_RICH_MENU_MAX_BYTES } from '@/lib/line-image-limits';
import { LINE_MAX_BYTES, composeRichMenuImage } from '@/server/rich-menu-image';
import { ApiHttpError } from '@/server/http';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('#1109 LINE 圖文選單十進位 1MB 上限（#1110 Codex P2）', () => {
  it('共用常數為 1,000,000，rich-menu-image 的 LINE_MAX_BYTES 與之相等', () => {
    expect(LINE_RICH_MENU_MAX_BYTES).toBe(1_000_000);
    expect(LINE_MAX_BYTES).toBe(LINE_RICH_MENU_MAX_BYTES);
  });

  it('upload-bg-image route 與 settings service 皆引用共用常數，不再有 1024 * 1024', () => {
    const route = read('src/app/api/settings/line/rich-menu/upload-bg-image/route.ts');
    const svc = read('src/services/settings.ts');
    expect(route).toContain('LINE_RICH_MENU_MAX_BYTES');
    expect(route).not.toMatch(/1024\s*\*\s*1024/);
    expect(svc).toContain('LINE_RICH_MENU_MAX_BYTES');
    expect(svc).not.toMatch(/RICH_MENU_BG_MAX_BYTES\s*=\s*1024/);
  });

  it('noOverlay：達到上限丟 400，未達上限原圖回傳', async () => {
    const big = Buffer.alloc(LINE_MAX_BYTES + 1, 1);
    await expect(composeRichMenuImage({ bytes: big, contentType: 'image/png', noOverlay: true }))
      .rejects.toSatisfy((e: unknown) => e instanceof ApiHttpError && (e as ApiHttpError).status === 400);
    const exact = Buffer.alloc(LINE_MAX_BYTES, 1);
    await expect(composeRichMenuImage({ bytes: exact, contentType: 'image/png', noOverlay: true })).rejects.toBeInstanceOf(ApiHttpError);
    const ok = Buffer.alloc(LINE_MAX_BYTES - 1, 1);
    const r = await composeRichMenuImage({ bytes: ok, contentType: 'image/png', noOverlay: true });
    expect(r.bytes.length).toBe(LINE_MAX_BYTES - 1);
    expect(r.contentType).toBe('image/png');
  });
});
