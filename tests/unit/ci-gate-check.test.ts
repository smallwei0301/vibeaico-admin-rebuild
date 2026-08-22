/**
 * 暫時性測試 —— 驗證 CI 關卡真的會擋（12 分冊本冊驗收最後一項）：
 *   「故意寫一個必敗測試 → CI 紅 → 修好 → 綠（驗證關卡真的會擋）」
 *
 * 這個檔案會在驗證完成後立刻刪除。它存在的唯一目的是證明
 * .github/workflows/ci.yml 的 check job 會因為 `npm test` 失敗而讓整個
 * workflow 變紅 —— 也就是「紅燈不得 merge」這條規則有實際效力，而不是
 * 一個沒人驗證過的假設。
 */
import { describe, it, expect } from 'vitest';

describe('CI 關卡驗證（暫時性，驗證後刪除）', () => {
  it('故意失敗：若 CI 顯示綠燈，代表關卡沒有生效', () => {
    expect(1).toBe(2);
  });
});
