/**
 * 「閘門看動作的方向，不看對象」靜態鎖（14 分冊 §8.16 的延伸）
 * -----------------------------------------------------------------------------
 * 擁有者裁決 §8.16 的原則：**收費擋的是「多做一件事」，不是「少做一件事」。**
 *
 * 那一輪處理系統內建關鍵字。這裡是同一個原則套在**自訂**關鍵字上——
 * 執行者在 §8.16 收工時把這個情況當成「第三種、兩邊都沾」交上來，
 * 主導者判定原則本身就能解開：決定的是**動作的方向**，不是動作的**對象**。
 *
 * 修改前的實況（主導者已查證）：
 *   - webhook 分支 ② 讀 `keyword_replies` **完全沒有 feature 閘門** → 退訂後照樣回覆顧客
 *   - 但停用要走 PUT、刪除走 DELETE，兩支都無條件 requireFeature → 403
 *   ⇒ **店家退訂後，自己寫的話持續發給顧客，而他關不掉也刪不掉。**
 *
 * 那些內容可能是過期的優惠、舊價格、已停售的服務。比系統內建關鍵字更糟，
 * 因為它們是**店家自己的名義**發出去的。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf-8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const ROUTE = 'src/app/api/settings/line/keyword-replies/[id]/route.ts';
const code = stripComments(src(ROUTE));

describe('自訂關鍵字：閘門依動作方向而非對象', () => {
  it('PUT 不再無條件 requireFeature（那會讓退訂的店家關不掉自己的關鍵字）', () => {
    const put = code.slice(code.indexOf('export const PUT'), code.indexOf('export const DELETE'));
    // 舊寫法是進函式就擋；現在必須是有條件的
    expect(put).not.toMatch(/const t = await requireTenant\('MANAGER'\);\s*await requireFeature/);
    expect(put).toMatch(/if \(!onlyDeactivating\) await requireFeature\(/);
  });

  it('「單純停用」的判定必須排除所有內容欄位（否則夾帶就能繞過閘門）', () => {
    const put = code.slice(code.indexOf('export const PUT'), code.indexOf('export const DELETE'));
    const cond = put.slice(put.indexOf('const onlyDeactivating'), put.indexOf('if (!onlyDeactivating)'));
    expect(cond).toContain('b.active === false');
    for (const field of ['keywords', 'replyType', 'content', 'sortOrder']) {
      expect(cond, `夾帶 ${field} 時必須仍然擋——否則送 { active:false, ${field}:… } 可以繞過付費`)
        .toContain(`b.${field} === undefined`);
    }
  });

  it('重新啟用（active: true）仍然要擋——那是「多做一件事」', () => {
    const put = code.slice(code.indexOf('export const PUT'), code.indexOf('export const DELETE'));
    // 條件釘死在 === false，不能寫成 b.active !== undefined
    expect(put).not.toMatch(/const onlyDeactivating[\s\S]{0,80}b\.active !== undefined/);
  });

  it('DELETE 一律免閘門——刪除是讓 bot 少做一件事', () => {
    const del = code.slice(code.indexOf('export const DELETE'));
    expect(del).not.toContain('requireFeature');
  });

  it('新增（POST）仍然要擋——那是「多做一件事」，閘門沒被拆過頭', () => {
    const post = stripComments(src('src/app/api/settings/line/keyword-replies/route.ts'));
    expect(post).toContain("requireFeature");
    expect(post).toMatch(/requireFeature\([^)]*'KEYWORD_REPLY'\)/);
  });
});
