/**
 * 「假成功誠實化」不可回歸測試（GitHub issue #3 / 修復-1B）
 * -----------------------------------------------------------------------------
 * 對象是六處**後端不存在、但畫面卻宣稱做完了**的互動：
 *   1. bookings 的加購 modal（AddonModal）—— 謊報「顧客將收到 LINE 消費明細」
 *   2. calendar-sync 整頁 —— ICS token「重新產生」是假的安全操作、外部行事曆假 CRUD
 *   3. settings 的 ICS 區塊 —— 用硬編碼陣列輪替假 token 假裝換發
 *   4. promote 的「下載 QR」—— 沒有任何檔案被下載
 *   5. line-settings 的「下載 QR Code」—— 同上
 *   6. rich-menu-design 的儲存草稿／還原前次發布／預約流程步驟開關／功能頁面樣式
 *
 * 這六處**都沒有**可呼叫的 service 或端點（見各頁 i18n 字典裡的 notBuilt 註解），
 * 依 CLAUDE.md「Never fabricate a known」與 00 分冊鐵則 12，畫面不得顯示成功訊息、
 * 不得宣稱撤銷了什麼、也不得宣稱對顧客做過任何對外動作。
 *
 * ⚠️ 為什麼是「讀原始碼」而不是 render 測試：
 *    本專案沒有安裝 @testing-library/react，vitest 單元測試跑在 node 環境
 *    （vitest.config.mts: environment: 'node'），無法掛載 React 元件。
 *    這裡測的是「原始碼中不存在任何會謊報成功的路徑」——對不變條件的靜態證明。
 *    與 honest-not-built-pages.test.ts（修復-1A）同一層，刻意分檔避免衝突。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { bookingsPage } from '@/i18n/zh-TW/pages/bookings';
import { calendarSyncPage } from '@/i18n/zh-TW/pages/calendar-sync';
import { settingsPage } from '@/i18n/zh-TW/pages/settings';
import { promotePage } from '@/i18n/zh-TW/pages/promote';
import { lineSettingsPage } from '@/i18n/zh-TW/pages/line-settings';
import { richMenuDesignPage } from '@/i18n/zh-TW/pages/rich-menu-design';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

const PAGES = {
  bookings: 'src/app/tenant/bookings/page.tsx',
  calendarSync: 'src/app/tenant/calendar-sync/page.tsx',
  settings: 'src/app/tenant/settings/page.tsx',
  promote: 'src/app/tenant/promote/page.tsx',
  lineSettings: 'src/app/tenant/line-settings/page.tsx',
  richMenuDesign: 'src/app/tenant/rich-menu-design/page.tsx',
} as const;

/** 去掉註解，避免「解釋為什麼不能這樣寫」的註解被誤判成違規程式碼 */
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 把字典裡所有字串（含樣板函式的產出）攤平，方便對文案下斷言 */
const allStrings = (dict: unknown): string[] => {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') { out.push(value); return; }
    if (typeof value === 'function') {
      for (const arg of [1, 'X'] as const) {
        try { walk((value as (a: unknown) => unknown)(arg)); } catch { /* 參數型別不合就跳過 */ }
      }
      return;
    }
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (value && typeof value === 'object') { Object.values(value).forEach(walk); }
  };
  walk(dict);
  return out;
};

/** 取出原始碼中的一段（用來把斷言限縮在該功能的區塊內） */
const section = (code: string, from: string, to: string): string => {
  const start = code.indexOf(from);
  expect(start, `找不到區塊起點：${from}`).toBeGreaterThan(-1);
  const end = code.indexOf(to, start + from.length);
  return code.slice(start, end === -1 ? undefined : end);
};

describe('修復-1B：六處後端不存在的互動不得假成功', () => {
  /* ====================================================== 1. 加購 modal */
  describe('bookings 加購 modal（謊報已寫入＋謊報已通知顧客）', () => {
    const code = withoutComments(src(PAGES.bookings));

    it('送出加購只給「尚未生效」提示，沒有假延遲、也不宣稱寫入或通知', () => {
      /*
       * 舊實作：submit() 內 `await new Promise(r => setTimeout(r, 400))` 後
       * onAdded(notify, hasLine) → toast「加購已加入，顧客將收到 LINE 消費明細」。
       * 加購後端（Phase 8b）不存在：src/app/api/bookings 底下沒有 addons 路由、
       * src/services/bookings.ts 也沒有對應函式，所以資料與 LINE 訊息都不可能發生。
       */
      const modal = section(code, 'function AddonModal(', 'function ApplyCouponModal(');
      expect(modal).not.toContain('setTimeout');
      expect(modal).toContain('onSubmitted()');
      expect(code).toContain('toast.show(t.addonNotBuilt.submitNotEffective, \'warning\')');
      expect(bookingsPage.addonNotBuilt.submitNotEffective).toContain('尚未建置');
      expect(bookingsPage.addonNotBuilt.submitNotEffective).toContain('不會收到');
    });

    it('移除加購的確認與結果都明說沒有移除任何東西', () => {
      expect(code).toContain('message={t.addonNotBuilt.removeConfirm}');
      expect(code).toContain('toast.show(t.addonNotBuilt.removeNotEffective, \'warning\')');
      expect(bookingsPage.addonNotBuilt.removeNotEffective).toContain('未移除加購');
    });

    it('加購 modal 頂部有常駐的「尚未建置」Alert，通知選項停用', () => {
      const modal = section(code, 'function AddonModal(', 'function ApplyCouponModal(');
      expect(modal).toMatch(/<Alert[^>]*title=\{t\.addonNotBuilt\.modalTitle\}/);
      expect(modal).toContain('{t.addonNotBuilt.modalBody}');
      expect(modal).toMatch(/type="checkbox" checked=\{false\} readOnly disabled/);
      expect(bookingsPage.addonNotBuilt.notifyDisabled).toContain('不會送出任何 LINE 訊息');
    });

    it('舊的加購成功文案已從字典移除，無法再被引用', () => {
      for (const key of [
        'addonAdded', 'addonAddedSilent', 'addonAddedNoLine',
        'addonAddedRefreshFailed', 'addonRemoved', 'addonDowngradePaid',
      ]) {
        expect(Object.keys(bookingsPage.messages)).not.toContain(key);
      }
      expect(Object.keys(bookingsPage.confirmMessages)).not.toContain('removeAddon');
      for (const text of allStrings(bookingsPage.addonModal)) {
        expect(text).not.toMatch(/顧客已收到/);
      }
      for (const text of allStrings(bookingsPage.addonNotBuilt)) {
        expect(text).not.toMatch(/加購已加入|加購已移除/);
      }
    });
  });

  /* =================================================== 2. calendar-sync */
  describe('calendar-sync（假的安全操作：假裝撤銷了舊訂閱網址）', () => {
    const code = withoutComments(src(PAGES.calendarSync));

    it('頁面不再持有任何假 token，也不再組出看似可用的 ICS 網址', () => {
      /*
       * 舊實作：INITIAL_ICS_TOKEN + REGENERATED_TOKENS 三個硬編碼字串輪替，
       * 按「重新產生網址」就換下一個並 toast「已產生新網址」——
       * 店家會以為舊連結已失效（假的安全操作），實際上什麼都沒被撤銷，
       * 因為 /ics/{shopCode}/{token}.ics 這條路由根本不存在。
       */
      expect(code).not.toContain('REGENERATED_TOKENS');
      expect(code).not.toContain('INITIAL_ICS_TOKEN');
      expect(code).not.toContain('buildIcsUrl');
      expect(code).not.toContain('/ics/');
      expect(code).not.toMatch(/[a-f0-9]{16}/);
      expect(code).not.toContain('setIcsToken');
    });

    it('訂閱網址顯示「尚未開通」，複製／加入 Google／重新產生三顆按鈕全停用', () => {
      expect(code).toContain('value={t.notBuilt.urlUnavailable}');
      expect(calendarSyncPage.notBuilt.urlUnavailable).toBe('尚未開通');
      const disabled = code.match(/<Button[\s\S]*?disabled/g) ?? [];
      expect(disabled.length).toBeGreaterThanOrEqual(3);
      expect(code).not.toContain('t.subscribe.copied');
      expect(Object.keys(calendarSyncPage.subscribe)).not.toContain('regenerated');
      expect(Object.keys(calendarSyncPage.subscribe)).not.toContain('regenerateConfirm');
      expect(Object.keys(calendarSyncPage.subscribe)).not.toContain('regenerateFailed');
    });

    it('外部行事曆的新增／刪除／啟停都顯示尚未生效，舊成功文案已移除', () => {
      for (const key of ['externalAdded', 'externalDeleted', 'externalToggled'] as const) {
        expect(code).toContain(`toast.show(t.notBuilt.${key}, 'warning')`);
        expect(calendarSyncPage.notBuilt[key]).toContain('尚未建置');
      }
      expect(Object.keys(calendarSyncPage.external)).not.toContain('added');
      expect(Object.keys(calendarSyncPage.external)).not.toContain('deleted');
    });

    it('頁面頂部有常駐的「尚未建置」Alert（不是一閃即逝的 toast）', () => {
      expect(code).toMatch(/<Alert[^>]*title=\{t\.notBuilt\.title\}/);
      expect(code).toContain('{t.notBuilt.body}');
      expect(code).toContain('{t.notBuilt.securityBody}');
      expect(calendarSyncPage.notBuilt.securityBody).toContain('無從撤銷');
    });
  });

  /* ================================================= 3. settings ICS 區 */
  describe('settings 行事曆同步分頁（同一個假 token 輪替）', () => {
    const code = withoutComments(src(PAGES.settings));

    it('假 token 輪替陣列與換發流程整段移除', () => {
      expect(code).not.toContain('REGENERATED_ICS_TOKENS');
      expect(code).not.toContain('INITIAL_ICS_TOKEN');
      expect(code).not.toContain('regenerateIcs');
      expect(code).not.toContain('/ics/');
      expect(code).not.toMatch(/[a-f0-9]{16}/);
    });

    it('分頁內的網址欄位顯示「尚未開通」，三顆按鈕全停用且沒有 onClick', () => {
      const panel = section(code, "tab === 'calendarSync'", "tab === 'security'");
      expect(panel).toContain('value={t.calendarSync.notBuilt.urlUnavailable}');
      expect(panel).not.toContain('onClick');
      expect((panel.match(/disabled/g) ?? []).length).toBeGreaterThanOrEqual(4);
      expect(panel).toMatch(/<Alert[^>]*title=\{t\.calendarSync\.notBuilt\.title\}/);
      expect(settingsPage.calendarSync.notBuilt.title).toContain('尚未建置');
      expect(settingsPage.calendarSync.notBuilt.body).toContain('無從撤銷');
      for (const key of ['regenerated', 'regenerateFailed', 'regenerateConfirm', 'regenerateConfirmTitle', 'copied']) {
        expect(Object.keys(settingsPage.calendarSync)).not.toContain(key);
      }
    });
  });

  /* ==================================================== 4+5. 兩處 QR 下載 */
  describe('promote／line-settings 的「下載 QR」（按了卻沒有任何檔案）', () => {
    const promoteCode = withoutComments(src(PAGES.promote));
    const lineCode = withoutComments(src(PAGES.lineSettings));

    it('promote：下載按鈕停用並說明原因，QR 方框標示為不能掃描的版位示意', () => {
      /*
       * 查證結果：兩頁都沒有任何 QR 圖檔、dataURL 或產圖端點，方框裡畫的是
       * lucide 的 <QrCode> 圖示。沒有圖可下載，因此按鈕停用（不是自製 QR 編碼器）。
       */
      expect(promoteCode).not.toContain('downloadStarted');
      expect(promoteCode).not.toContain('QR_PLACEHOLDER_AVAILABLE');
      expect(promoteCode).not.toContain('qrConfirmOpen');
      expect(promoteCode).toMatch(/disabled title=\{t\.notBuilt\.downloadDisabledHint\}/);
      expect(promoteCode).toContain('{t.notBuilt.qrPlaceholder}');
      expect(promotePage.notBuilt.downloadDisabledHint).toContain('沒有可下載的 QR 圖檔');
      expect(promotePage.notBuilt.qrPlaceholder).toContain('不能掃描');
      expect(Object.keys(promotePage.messages)).not.toContain('downloadStarted');
      expect(Object.keys(promotePage.qr)).not.toContain('filename');
      expect(Object.keys(promotePage.qr)).not.toContain('confirmMessage');
    });

    it('line-settings：下載按鈕停用並指向 LINE 官方後台，「已下載」文案移除', () => {
      const card = section(lineCode, '{t.botInfo.downloadQr}', '</Card>');
      expect(lineCode).not.toContain('t.botInfo.downloaded');
      expect(Object.keys(lineSettingsPage.botInfo)).not.toContain('downloaded');
      const button = section(lineCode, '<Button\n                  variant="outline"\n                  disabled', '</Button>');
      expect(button).toContain('title={t.botInfo.downloadDisabledHint}');
      expect(button).not.toContain('onClick');
      expect(lineSettingsPage.botInfo.downloadDisabledHint).toContain('尚未建置');
      expect(card.length).toBeGreaterThan(0);
      for (const text of allStrings(lineSettingsPage.botInfo)) {
        expect(text).not.toMatch(/QR Code 已下載/);
      }
    });

    it('兩頁都沒有自製 QR 編碼器或新的圖像資料（本 issue 不做這件事）', () => {
      for (const code of [promoteCode, lineCode]) {
        expect(code).not.toContain('data:image');
        expect(code).not.toContain('toDataURL');
        expect(code).not.toContain('qrcode');
      }
    });
  });

  /* =============================================== 6. rich-menu-design */
  describe('rich-menu-design 四處本地假成功', () => {
    const code = withoutComments(src(PAGES.richMenuDesign));

    it('「儲存草稿」改為誠實提示（草稿沒有任何後端可存）', () => {
      expect(code).toContain("toast.show(t.publish.draftNotEffective, 'warning')");
      expect(Object.keys(richMenuDesignPage.publish)).not.toContain('draftSaved');
      expect(richMenuDesignPage.publish.draftNotEffective).toContain('尚未建置');
      expect(richMenuDesignPage.publish.draftNotEffective).toContain('未儲存草稿');
    });

    it('「還原發布前的設計」停用，且不再宣稱系統做過備份', () => {
      /*
       * 舊實作：onConfirm 只是 setHasBackup(false) + toast「已還原」，
       * LINE 端毫無變化；連帶「發布前系統自動備份」的說明也是假的。
       */
      expect(code).not.toContain("confirm === 'restore'");
      expect(code).not.toContain('t.scene.restoreDone');
      expect(code).not.toContain('t.scene.backupBar');
      expect(code).toContain('{t.scene.noBackupBar}');
      expect(code).toMatch(/disabled title=\{t\.scene\.restoreDisabledHint\}/);
      expect(Object.keys(richMenuDesignPage.scene)).not.toContain('restoreDone');
      expect(Object.keys(richMenuDesignPage.scene)).not.toContain('restoreConfirm');
      expect(richMenuDesignPage.scene.noBackupBar).toContain('不會備份');
      for (const text of allStrings(richMenuDesignPage.scene.bullets)) {
        expect(text).not.toMatch(/自動備份/);
      }
    });

    it('預約流程步驟開關顯示尚未生效，且不再宣稱「即時生效」', () => {
      expect(code).toContain("toast.show(t.bookingSteps.guideToggleNotEffective, 'warning')");
      expect(code).toContain('{t.bookingSteps.notBuiltBody}');
      expect(Object.keys(richMenuDesignPage.bookingSteps)).not.toContain('guideOn');
      expect(Object.keys(richMenuDesignPage.bookingSteps)).not.toContain('guideOff');
      expect(richMenuDesignPage.bookingSteps.guideHelp).not.toContain('即時生效');
      expect(richMenuDesignPage.bookingSteps.notBuiltBody).toContain('不會寫入資料庫');
    });

    it('功能頁面樣式自訂區明說尚未建置（該區從來沒有可編輯欄位）', () => {
      expect(code).toContain('{t.featurePages.notBuiltBody}');
      expect(richMenuDesignPage.featurePages.notBuiltBody).toContain('尚未建置');
    });

    it('禁區未被動到：Rich Menu 發布／刪除仍呼叫真的 service，FlexMenuTab 仍在', () => {
      /*
       * 這兩顆按鈕是最近才接成真的（createRichMenu / deleteRichMenu，已用真實
       * LINE 頻道驗證過），FlexMenuTab 的假成功則屬 issue #6 刻意保留。
       * 本測試順便守住「誠實化不得誤傷已修好的功能」。
       */
      expect(code).toContain('await createRichMenu(pendingTheme)');
      expect(code).toContain('await deleteRichMenu()');
      expect(code).toContain('function FlexMenuTab(');
    });
  });

  /* ============================================================ 全域規則 */
  it('六頁在本次負責的區塊內都沒有 setTimeout 假延遲', () => {
    /*
     * settings 仍有一個 setTimeout，位於「變更密碼」區塊——那是 issue #4 的範圍，
     * 本 issue 不得改動，因此這裡只斷言它不在行事曆同步區。
     */
    for (const key of ['bookings', 'calendarSync', 'promote', 'lineSettings', 'richMenuDesign'] as const) {
      expect(src(PAGES[key]), PAGES[key]).not.toContain('setTimeout');
    }
    const settings = withoutComments(src(PAGES.settings));
    const panel = section(settings, "tab === 'calendarSync'", "tab === 'security'");
    expect(panel).not.toContain('setTimeout');
    expect((settings.match(/setTimeout/g) ?? []).length).toBe(1);
    expect(section(settings, 'const submitPasswordChange', '};')).toContain('setTimeout');
  });

  it('六個頁面元件都沒有中文字面量文案（新文案一律進各頁 i18n 字典）', () => {
    /*
     * 唯一允許的例外是模組層 `const 大寫常數 = […]` 的示範資料區塊
     * （CLAUDE.md 明文允許 page-local mock，業務風味字串本來就必須是中文）。
     */
    const cjk = /[一-鿿]/;
    for (const [name, path] of Object.entries(PAGES)) {
      const lines = withoutComments(src(path)).split('\n');
      let inMock = false;
      const offenders: [number, string][] = [];
      lines.forEach((line, i) => {
        if (/^const [A-Z][A-Z0-9_]*[ :]/.test(line)) inMock = true;
        else if (inMock && /^(\]|\})/.test(line)) inMock = false;
        else if (!inMock && cjk.test(line)) offenders.push([i + 1, line]);
      });
      expect(offenders, `${name} 有非 i18n 的中文字面量`).toEqual([]);
    }
  });
});
