/**
 * 「送去 LINE 的圖片格式限制要跟著 bucket 走」不可回歸測試
 * -----------------------------------------------------------------------------
 * 來由：2026-08-25 查證 LINE 圖片訊息規格時（06 分冊 §8）附帶發現的規格違反。
 *
 * LINE 的 image message 與 rich menu 圖片都只收 JPEG / PNG，但 /api/upload
 * 一律放行 WebP。店家傳一張 WebP 進 chat-images：上傳成功、chat_messages 有
 * 紀錄、畫面顯示已送出——顧客的 LINE 卻顯示不出來。後端每一步都成功，錯誤
 * 只發生在 LINE 那一端，我們這邊完全無感，是最難察覺的一種假成功。
 *
 * 這條測試同時鎖住**反方向**：不准為了修這個 bug 就全站禁 WebP。其餘四個
 * bucket 的圖只出現在自家網頁上，WebP 在那裡是更好的選擇。限制要跟著
 * 「這張圖最後會流到哪裡」走，不是跟著上傳端點走。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(process.cwd(), 'src/app/api/upload/route.ts'), 'utf8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const code = stripComments(src);

describe('/api/upload：LINE 去向的 bucket 只收 JPEG / PNG', () => {
  it('chat-images 與 richmenu-assets 被標記為 LINE 去向', () => {
    expect(code).toMatch(/LINE_BOUND_BUCKETS\s*=\s*new Set\(\[[^\]]*'chat-images'[^\]]*\]\)/);
    expect(code).toMatch(/LINE_BOUND_BUCKETS\s*=\s*new Set\(\[[^\]]*'richmenu-assets'[^\]]*\]\)/);
  });

  it('LINE 用的格式表不含 WebP', () => {
    const table = code.slice(code.indexOf('const LINE_TYPES'), code.indexOf('export const POST'));
    expect(table).toContain("'image/jpeg'");
    expect(table).toContain("'image/png'");
    expect(table).not.toContain('webp');
  });

  it('其餘 bucket 仍然收 WebP（不准為了修這個 bug 就全站砍掉）', () => {
    const table = code.slice(code.indexOf('const WEB_TYPES'), code.indexOf('const LINE_TYPES'));
    expect(table).toContain("'image/webp'");
  });

  it('副檔名的判定真的依 bucket 分流，不是兩張表擺著不用', () => {
    expect(code).toMatch(/const lineBound = LINE_BOUND_BUCKETS\.has\(bucket\)/);
    expect(code).toMatch(/\(lineBound \? LINE_TYPES : WEB_TYPES\)\[file\.type\]/);
  });

  it('被擋下來時的訊息說得出「為什麼」，不是只說格式不支援', () => {
    expect(src).toContain('LINE 只接受 JPEG 或 PNG 圖片');
  });
});
