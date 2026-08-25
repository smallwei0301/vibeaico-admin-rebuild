/**
 * 「假成功誠實化」不可回歸測試（GitHub issue #3 / 修復-1C 收尾補丁）
 * -----------------------------------------------------------------------------
 * 修復-1A（b85bfb4）與 1B（742f33d）收尾時，還有五處假宣稱留在當時的禁區裡，
 * 本輪逐項處理。它們的共同點是：**畫面陳述了一件系統從來沒做過的事**。
 *
 *   1. rich-menu-design `publish.published`——發布成功訊息宣稱「主選單樣式 +
 *      預約步驟 + 功能頁面樣式皆已儲存」，但發布只呼叫 createRichMenu(theme)，
 *      那三項的後端根本尚未建置（同一頁還自己貼著「尚未建置」告示）。
 *   2. rich-menu-design `scene.publishConfirmTail`——「✅ 系統會自動備份你目前的
 *      設計，發布後可隨時一鍵還原」，但沒有備份／還原端點，還原按鈕已停用。
 *   3. line-settings `promotion.items`——教店家「下載上方 QR Code」，但那顆按鈕
 *      已在 1B 停用（本站沒有任何 QR 圖檔）。
 *   4. bookings `adjustPriceModal.bullets[2]`——推薦改用「加購」才會延長時段、
 *      記師父業績、通知顧客，但加購後端（Phase 8b）尚未建置。
 *   5. rich-menu-design 快速套用範本——onConfirm 只 setHasBackup(true) + toast
 *      「已套用並暫存！Flex 主選單已上線」，實際上一個 state 都沒動。
 *
 * ⚠️ 為什麼是「讀原始碼」而不是 render 測試：本專案沒有 @testing-library/react，
 *    vitest 跑在 node 環境（vitest.config.mts），無法掛載 React 元件。這裡測的是
 *    「原始碼中不存在任何會謊報的路徑」——對不變條件的靜態證明。與
 *    honest-not-built-pages.test.ts（1A）／honest-not-built-interactions.test.ts（1B）
 *    同一層，刻意分檔避免衝突。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { bookingsPage } from '@/i18n/zh-TW/pages/bookings';
import { lineSettingsPage } from '@/i18n/zh-TW/pages/line-settings';
import { richMenuDesignPage } from '@/i18n/zh-TW/pages/rich-menu-design';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

const RICH_MENU_PAGE = 'src/app/tenant/rich-menu-design/page.tsx';

/** 去掉註解，避免「解釋為什麼不能這樣寫」的註解被誤判成違規程式碼／文案 */
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 把字典裡所有字串（含樣板函式的產出）攤平，方便對文案下斷言 */
const allStrings = (dict: unknown): string[] => {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') { out.push(value); return; }
    if (typeof value === 'function') {
      try { walk((value as (a: unknown) => unknown)('X')); } catch { /* 參數型別不合就跳過 */ }
      return;
    }
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (value && typeof value === 'object') { Object.values(value).forEach(walk); return; }
  };
  walk(dict);
  return out;
};

describe('修復-1C：發布成功訊息與備份承諾等殘留假宣稱', () => {
  const code = withoutComments(src(RICH_MENU_PAGE));

  /* ============================================ 1. 發布成功訊息 */
  describe('1. Rich Menu 發布成功訊息只陳述真正發生的事', () => {
    it('不再宣稱主選單樣式／預約步驟／功能頁面樣式「皆已儲存」', () => {
      const published = richMenuDesignPage.publish.published;
      expect(published).not.toContain('皆已儲存');
      expect(published).not.toMatch(/主選單樣式 \+ 預約步驟/);
      expect(published).toContain('Rich Menu 已推送到 LINE');
      // 三項沒發生的事必須被點名，否則同頁的「尚未建置」告示與成功訊息互相矛盾
      expect(published).toContain('尚未建置');
    });

    it('刪掉從未使用、卻宣稱有「Flex 樣式儲存」這一步的失敗文案', () => {
      const keys = Object.keys(richMenuDesignPage.publish);
      expect(keys).not.toContain('publishedFlexFailed');
      expect(keys).not.toContain('publishedSceneFlexFailed');
      expect(code).not.toContain('publishedFlexFailed');
      expect(code).not.toContain('publishedSceneFlexFailed');
    });
  });

  /* ============================================ 2. 備份承諾 */
  describe('2. 一頁式範本／快速套用範本都不再承諾備份與還原', () => {
    it('發布確認視窗不再寫「系統會自動備份…可一鍵還原」', () => {
      const tail = richMenuDesignPage.scene.publishConfirmTail;
      expect(tail).not.toMatch(/自動備份/);
      expect(tail).not.toMatch(/一鍵還原/);
      expect(tail).toContain('不會備份');
      expect(tail).toContain('無法還原');
    });

    it('scene 字典整區沒有任何備份／還原承諾，假鍵也已刪除', () => {
      const keys = Object.keys(richMenuDesignPage.scene);
      expect(keys).not.toContain('backupBar');     // 「原設計已自動備份」
      expect(keys).not.toContain('restoreFailed'); // 沒有還原流程可失敗
      for (const text of allStrings(richMenuDesignPage.scene)) {
        expect(text).not.toMatch(/自動備份/);
        expect(text).not.toMatch(/可(隨時)?一鍵還原/);
      }
    });

    it('quickTemplates 字典整區沒有備份／還原承諾，相關假鍵全數刪除', () => {
      const keys = Object.keys(richMenuDesignPage.quickTemplates);
      for (const dead of [
        'applyConfirmLead', 'applyConfirmTail', 'appliedLead', 'appliedBackupNote',
        'appliedBackupTail', 'appliedDraft', 'appliedUnsubscribed', 'restoreBackup',
        'dismissBackup', 'backupFailed', 'restoreConfirmLead', 'restored',
      ]) expect(keys, dead).not.toContain(dead);
      for (const text of allStrings(richMenuDesignPage.quickTemplates)) {
        expect(text).not.toMatch(/會?自動備份/);
        expect(text).not.toMatch(/一鍵(還原|反悔)/);
      }
    });
  });

  /* ============================================ 3. line-settings 加入指引 */
  /**
   * ⚠️ **前提變更（主導者，2026-08-25，issue #16）——不是把斷言放寬。**
   *
   * 這一段原本要求「加好友指引改指 LINE 官方後台」，因為當時 QR 下載鈕是**停用的**
   * ——叫店家去按一顆按不下去的鈕才是不誠實。
   *
   * issue #16 把 QR 補齊成真的了（擁有者裁決 §8.2）。前提反轉之後，**繼續叫店家
   * 繞去 LINE 官方後台反而變成新的不誠實**：本站明明就能下載，卻教他去別的地方。
   *
   * 所以這一段改為守住反方向：指引必須指向**本站真的能用的那顆鈕**，
   * 且不得殘留「尚未建置」這類已經不成立的說法。
   * 「不得指向停用功能」這個**原始意圖沒有變**，變的只是哪一邊才是停用的。
   */
  describe('3. 「如何讓顧客加入」指向本站真的能用的下載鈕（issue #16 後）', () => {
    it('第 1 項指向本站的下載鈕，不再繞去 LINE 官方後台', () => {
      const [first] = lineSettingsPage.promotion.items;
      expect(first.desc).toContain('下載');
      expect(first.desc, 'QR 已補齊，再叫店家去別的地方下載就是新的不誠實')
        .not.toContain('LINE Official Account Manager');
    });

    it('整段指引沒有殘留「尚未建置」這類已不成立的說法', () => {
      for (const text of allStrings(lineSettingsPage.promotion)) {
        expect(text).not.toMatch(/尚未建置|無法下載|不能下載/);
      }
      // downloadDisabledHint 現在的語意是「Basic ID 還沒填」這種過渡態，
      // 不再是「功能不存在」——不得又退回宣稱功能沒建好
      expect(lineSettingsPage.botInfo.downloadDisabledHint).not.toContain('尚未建置');
      // 而且它只在「真的還不能下載」時當 title 用，不是無條件停用
      expect(withoutComments(src('src/app/tenant/line-settings/page.tsx')))
        .toMatch(/title=\{!qrDataUrl \? t\.botInfo\.downloadDisabledHint : undefined\}/);
    });
  });

  /* ============================================ 4. 調整金額 modal */
  describe('4. 調整金額 modal 不再推薦不存在的加購能力', () => {
    it('不再宣稱改用「加購」才會延長時段／記業績／通知顧客', () => {
      const bullets = bookingsPage.adjustPriceModal.bullets;
      const bullet = bullets[2];
      expect(bullet).not.toContain('請改用「加購」');
      expect(bullet).not.toMatch(/才會延長時段/);
      expect(bullet).toContain('尚未建置');
      // 加購本體的誠實告示（1B 的成果）仍在
      expect(bookingsPage.addonNotBuilt.submitNotEffective).toContain('未新增加購');
    });
  });

  /* ============================================ 5. 快速套用範本 */
  describe('5. 快速套用範本改為誠實提示（沒有任何後端也沒有任何副作用）', () => {
    it('點範本卡直接顯示「尚未生效」提示，不再開無副作用的確認視窗', () => {
      expect(code).toContain("toast.show(t.quickTemplates.applyNotEffective(q.name), 'warning')");
      expect(code).not.toContain("confirm === 'apply'");
      expect(code).not.toContain("setConfirm('apply')");
      expect(code).not.toContain('t.quickTemplates.appliedDraft');
      expect(code).not.toContain('t.quickTemplates.appliedUnsubscribed');
    });

    it('提示文案明說沒有任何設定被改動、LINE 端也沒有變化', () => {
      const msg = richMenuDesignPage.quickTemplates.applyNotEffective('海洋藍');
      expect(msg).toContain('未套用');
      expect(msg).toContain('尚未建置');
      expect(msg).toContain('LINE');
      expect(msg).not.toMatch(/已上線|已套用並暫存/);
    });

    it('範本卡片區有常駐告示（不是只有按下去才知道）', () => {
      expect(code).toContain('{t.quickTemplates.notBuiltBody}');
      expect(richMenuDesignPage.quickTemplates.notBuiltBody).toContain('尚未建置');
    });
  });

  /* ============================================ 禁區守門 */
  describe('禁區未被動到（本輪只准改文案）', () => {
    it('Rich Menu 發布／刪除仍是真的：service 呼叫、try/catch、狀態更新都在', () => {
      expect(code).toContain('const result = await createRichMenu(pendingTheme);');
      expect(code).toContain('setRichMenuId(result.richMenuId);');
      expect(code).toContain('await deleteRichMenu();');
      expect(code).toContain("setRichMenuId('');");
      expect(code).toContain("confirm === 'publish'");
      expect(code).toContain("confirm === 'delete'");
    });

    it('FlexMenuTab（issue #6）與背景圖上傳按鈕（issue #7）原樣保留', () => {
      expect(code).toContain('function FlexMenuTab(');
      expect(code).toContain('{t.background.uploadImage}');
    });
  });
});
