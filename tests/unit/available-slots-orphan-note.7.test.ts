import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** 遞迴列出目錄下所有 .ts/.tsx，不依賴 grep 的退出碼語意（無 match 時 grep 回 1）。 */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = resolve(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });
}

/**
 * #7 的人工介入點：`/api/bookings/available-slots` 是「刻意孤兒」——已實作、已測試、
 * 刻意尚未接進任何頁面（14 分冊 §8.8 的 Owner 裁決：標記 Phase 8b 再用）。
 *
 * 14 分冊 §10.1 判定「刻意孤兒」的條件是「程式碼或分冊裡有誠實標註，且必須指出
 * 標註寫在哪一行」，並點名這一支的標註只在分冊、route 檔本身沒有。
 *
 * 這份測試鎖的是那段標註本身。沒有它，標註會在下一次重構時被無聲刪掉，而端點會
 * 退回成一個「看起來只是還沒接」的孤兒——那正是它一開始能被漏掉這麼久的原因。
 */
const routePath = resolve(process.cwd(), 'src/app/api/bookings/available-slots/route.ts');
const source = readFileSync(routePath, 'utf8');

describe('#7 available-slots 刻意孤兒標註', () => {
  it('route 檔自己說明它是刻意孤兒，而不是漏接線', () => {
    expect(source).toContain('刻意孤兒');
    expect(source).toContain('沒有任何頁面呼叫它');
    expect(source).toContain('這不是漏接線，也不是假成功');
  });

  it('標註指向可查證的裁決出處，而不是只寫「之後再說」', () => {
    expect(source).toContain('docs/integration/14-GAP-AUDIT.md §8.8');
    expect(source).toContain('Phase 8b');
  });

  it('標註寫明接線前的前置條件（團次時段尚未排除）', () => {
    // 少了這一段，未來的人會以為「接上去就好」，然後給出已被團次佔用的時段。
    expect(source).toContain('排除團次時段');
  });

  it('標註在檔案開頭，不是埋在幾百行演算法後面', () => {
    // 下一個人讀到演算法之前就該看到它。
    expect(source.indexOf('刻意孤兒')).toBeLessThan(source.indexOf('演算法'));
  });

  it('這支端點確實仍然沒有被任何頁面或 service 呼叫（標註仍屬實）', () => {
    // 標註若與現實脫節就是新的謊。等到真的接線時，這條會轉紅，
    // 提醒實作者把標註一併移除，而不是留著一句過期的「尚未使用」。
    const callers = [
      resolve(process.cwd(), 'src/services'),
      resolve(process.cwd(), 'src/app/tenant'),
    ].flatMap((dir) => walk(dir).filter((f) => readFileSync(f, 'utf8').includes('available-slots')));
    expect(callers).toEqual([]);
  });
});
