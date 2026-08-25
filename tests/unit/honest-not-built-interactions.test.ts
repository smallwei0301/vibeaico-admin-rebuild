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
  /*
   * ⚠️ 前提變更（GitHub issue #17 / 補齊-2，2026-08-25）
   * ---------------------------------------------------------------------------
   * 本區塊原本釘的是「加購後端不存在，所以畫面只准說『尚未生效』」。issue #17
   * 把後端補齊了：migration 0020 `booking_addons` + `/api/bookings/:id/addons`
   * （GET/POST）與 `/api/bookings/:id/addons/:addonId`（DELETE）+
   * `src/services/bookings.ts` 的 listBookingAddons／createBookingAddon／
   * deleteBookingAddon。**前提真的變了**，所以斷言重新釘，不是把它放寬。
   *
   * 重新釘之後守的東西**沒有變少**——原本擋的是「沒有後端卻報成功」，
   * 現在擋的是「有後端但沒呼叫，或呼叫了卻宣稱比實際更多的事」：
   *   - 仍不准有假延遲（setTimeout）
   *   - 成功訊息只准出現在 `await` 真的成功之後（submit 內、catch 之外）
   *   - **不准把「已通知顧客」寫死**：訊息必須依 API 回來的 `notified` 分支，
   *     六種結果各自一句（這是舊實作最主要的那個謊）
   *   - 刪除必須真的呼叫 DELETE，不准只關視窗
   */
  describe('bookings 加購 modal（已接上真實後端，且不得宣稱超出實際發生的事）', () => {
    const code = withoutComments(src(PAGES.bookings));

    it('送出加購真的呼叫 createBookingAddon，沒有假延遲，成功訊息在 await 之後', () => {
      const modal = section(code, 'function AddonModal(', 'function ApplyCouponModal(');
      expect(modal).not.toContain('setTimeout');
      expect(modal).toContain('await createBookingAddon(booking.id, {');
      // 送出結果整包往上傳（金額／時段／notified 都由 API 決定，不在前端拼湊）
      expect(modal).toContain('onSubmitted(r)');
      // 失敗走 setError，不會有成功 toast
      expect(modal).toContain('t.messages.addonFailed');
    });

    it('失敗但可能已寫入（額度 409）不會留下過期畫面：關窗＋重新載入，只有 REQ_001 留在視窗', () => {
      /*
       * 額度用完時 API 回 409，但加購已經寫入且金額已生效。若照一般作法把錯誤
       * 留在視窗裡，店家會對著舊金額再按一次「加入」而重複加購——那同樣是拿
       * 過期畫面當現況。只有伺服器保證沒寫入的 REQ_001 才留在視窗就地修改。
       */
      const modal = section(code, 'function AddonModal(', 'function ApplyCouponModal(');
      expect(modal).toContain("e.code === 'REQ_001'");
      expect(modal).toContain('onFailed(message)');
      // 結束點要用程式碼，不能用註解——withoutComments 已經把註解拿掉了
      const wiring = section(code, '<AddonModal', '<ApplyCouponModal');
      expect(wiring).toContain('onFailed={(message) => {');
      expect(wiring).toContain('setAddonsVersion((v) => v + 1);');
      expect(wiring).toContain('void load();');
    });

    it('成功訊息依 API 回來的 notified 分支，六種結果都各自對應一句', () => {
      // 頁面把「實際結果 → 文案」集中在 addonAddedMessage()，逐一比對
      const mapper = section(code, 'const addonAddedMessage =', 'const copyPayLink');
      for (const [outcome, key] of [
        ['LINE', 'addonAddedNotified'],
        ['NO_LINE', 'addonAddedNoLine'],
        ['NOT_CONFIGURED', 'addonAddedLineNotConfigured'],
        ['FAILED', 'addonAddedNotifyFailed'],
      ] as const) {
        expect(mapper).toContain(`notified === '${outcome}'`);
        expect(mapper).toContain(`m.${key}(amount)`);
        expect(Object.keys(bookingsPage.messages)).toContain(key);
      }
      // 'NONE'（沒要求通知／mock 模式）走不提通知的那一句
      expect(mapper).toContain('m.addonAdded(amount)');
      // 'QUOTA_EXCEEDED' 不會走到這裡：API 以 409 回應（訊息本身說明加購已寫入）
      expect(mapper).not.toContain('QUOTA_EXCEEDED');
    });

    it('沒有任何一句加購文案無條件宣稱「顧客會收到」', () => {
      for (const text of allStrings(bookingsPage.messages)) {
        expect(text).not.toMatch(/顧客將收到|顧客已收到/);
      }
      for (const text of allStrings(bookingsPage.addonModal)) {
        expect(text).not.toMatch(/顧客將收到|顧客已收到/);
      }
      // 只有 LINE 真的送出去的那一句才敢說「已送給顧客」
      expect(bookingsPage.messages.addonAddedNotified('$100')).toContain('已用 LINE 送給顧客');
      expect(bookingsPage.messages.addonAdded('$100')).not.toMatch(/LINE|通知/);
    });

    it('移除加購真的呼叫 deleteBookingAddon，確認視窗寫出會扣回的金額', () => {
      expect(code).toContain('await deleteBookingAddon(booking.id, addon.id, {');
      expect(code).toContain('t.confirmMessages.removeAddon(');
      expect(code).toContain('t.messages.addonRemoved(formatCurrency(r.revertedAmount))');
      const confirmText = bookingsPage.confirmMessages.removeAddon('深層護髮', '$800', 30);
      expect(confirmText).toContain('$800');
      expect(confirmText).toContain('30 分鐘');
    });

    it('通知勾選框是真的可勾（不是 readOnly disabled 的裝飾）', () => {
      const modal = section(code, 'function AddonModal(', 'function ApplyCouponModal(');
      expect(modal).not.toMatch(/type="checkbox" checked=\{false\} readOnly disabled/);
      expect(modal).toContain('checked={notify}');
      expect(modal).toContain('onChange={(ev) => setNotify(ev.target.checked)}');
      expect(modal).toContain('notify,');   // 真的送進 payload
    });

    it('明細載入中不得顯示「無資料」——那是把「還不知道」畫成「已知為空」', () => {
      /*
       * 2026-08-25 Playwright 實測抓到的：明細還在向 API 取的那 1〜5 秒，
       * 金額欄位已經是加購後的數字、明細區卻寫「無資料」，讀起來像明細不見了。
       * 三態的順序必須是 載入中 → 失敗 → 空，缺第一態就會退回那個假的已知。
       */
      const detail = section(code, 'function BookingDetailModal(', 'function AdjustPriceModal(');
      expect(detail).toContain('addonsLoading ? (');
      expect(detail).toContain('{d.addonLoading}');
      // 「無資料」只能在 addonsLoading 為 false 之後才輪到
      const branch = section(detail, '{addonsLoading ? (', 'ul className');
      expect(branch.indexOf('d.addonLoading'))
        .toBeLessThan(branch.indexOf('t.labels.noData'));
      expect(bookingsPage.detailModal.addonLoading).toContain('載入中');
    });

    it('「尚未建置」那組誠實化文案已整組移除（後端存在後再說一次就是假的）', () => {
      expect(Object.keys(bookingsPage)).not.toContain('addonNotBuilt');
      expect(code).not.toContain('addonNotBuilt');
      for (const text of allStrings(bookingsPage.addonModal)) {
        expect(text).not.toContain('尚未建置');
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
  /**
   * ⚠️ **前提變更（主導者，2026-08-25，issue #16）——不是把斷言放寬。**
   *
   * 這一段原本斷言「這兩頁**不准**有 QR」。那在 issue #3 誠實化時是對的：當時兩頁
   * 按了下載鈕只會 toast 成功、沒有任何檔案產生，所以正確的狀態是**停用＋說明**。
   *
   * issue #16 依擁有者裁決（14 分冊 §8.2）安裝 `qrcode` 套件把功能補齊，
   * 前提因此反轉——現在兩頁**必須**有真的 QR。
   *
   * 但原本那三條斷言裡**綁了兩件不同的事**，這次拆開處理：
   *   (a) 「不准自寫 QR 編碼器」——**永久有效**，是 §8.2 裁決的核心。
   *       自寫編碼器的典型失敗是「看起來像 QR、掃不出來」，外觀正常、沒有錯誤訊息、
   *       單元測試也會綠，要拿手機掃了才知道。這一條從「不准出現圖像資料」
   *       改寫成**正向斷言必須走 `qrcode` 套件**——比原本更精確，因為它擋的是
   *       「有人自己刻一個」而不是「有人產生了圖」。
   *   (b) 「本 issue 不做這件事」——已由 #16 反轉，移除。
   *
   * 強度沒有下降：原本是 3 條否定式；現在是「內容必須解得出且逐字相符」的
   * 端到端驗證（`tests/unit/qr-lib.test.ts`）＋ 接線正向斷言（`qr-wiring.test.ts`）
   * ＋ 下面這一組防回歸。**下載到一張圖不代表它指向對的網址**，那才是真正要防的。
   */
  describe('promote／line-settings 的 QR 下載（issue #16 補齊後）', () => {
    const promoteCode = withoutComments(src(PAGES.promote));
    const lineCode = withoutComments(src(PAGES.lineSettings));

    it('兩頁都走 src/lib/qr.ts，不准自己刻 QR 編碼器（§8.2 裁決，永久有效）', () => {
      for (const code of [promoteCode, lineCode]) {
        expect(code).toMatch(/from '@\/lib\/qr'/);
        expect(code).toContain('generateQrDataUrl');
      }
      const lib = withoutComments(src('src/lib/qr.ts'));
      // 真的用套件，而不是自己實作 Reed–Solomon／版本矩陣
      expect(lib).toMatch(/from 'qrcode'/);
      for (const banned of ['reedSolomon', 'galois', 'GF256', 'generatorPolynomial', 'alignmentPattern']) {
        expect(lib, `src/lib/qr.ts 出現 ${banned}——像是在自刻編碼器（§8.2 禁止）`)
          .not.toContain(banned);
      }
    });

    it('兩頁的下載鈕都真的接上 handler，且成功旗標不早於產生', () => {
      for (const code of [promoteCode, lineCode]) {
        expect(code).toContain('onClick={downloadQr}');
        expect(code).toContain('triggerDataUrlDownload');
        // 沒有 dataURL 時擋下，不會產生一個空檔案還說成功
        expect(code).toMatch(/if \(!qrDataUrl\) return;/);
      }
    });

    it('QR 方框顯示真的圖，不再是「不能掃描」的佔位圖示', () => {
      for (const code of [promoteCode, lineCode]) {
        expect(code).toMatch(/<img src=\{qrDataUrl\}/);
      }
      // 舊的佔位文案已從字典移除（留著會變成沒人渲染的死字串）
      expect(Object.keys(promotePage.notBuilt)).not.toContain('qrPlaceholder');
      expect(Object.keys(promotePage.notBuilt)).not.toContain('downloadDisabledHint');
    });

    it('下載檔名不是兩頁共用一個——各自有自己的名字', () => {
      expect(promotePage.qr.filename).toBeTruthy();
      expect(lineSettingsPage.botInfo.qrFilename).toBeTruthy();
      expect(promotePage.qr.filename).not.toBe(lineSettingsPage.botInfo.qrFilename);
    });

    it('產生失敗時不謊報成功（有 qrError 分支，且失敗時鈕是停用的）', () => {
      for (const code of [promoteCode, lineCode]) {
        expect(code).toContain('qrError');
        expect(code).toMatch(/disabled=\{!qrDataUrl/);
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
     * 本案例原本寫成「settings 頁剛好有 1 個 setTimeout，且位於變更密碼區塊」——
     * 因為那個 480ms 假延遲屬 issue #4 的範圍，本 issue（修復-1B）不得改動，
     * 該斷言是用來證明沒有越界動到別人的區域。
     * issue #4 已完成（commit 5526ed2），把它換成真的 changePassword() service 呼叫，
     * 所以 settings 頁的 setTimeout 數量成為 0，期望值隨之從 1 改為 0。
     * 前提改變後的新斷言比舊的更嚴格：六頁一律不得有任何 setTimeout 假延遲。
     */
    for (const key of [
      'bookings',
      'calendarSync',
      'promote',
      'lineSettings',
      'richMenuDesign',
      'settings',
    ] as const) {
      expect(src(PAGES[key]), PAGES[key]).not.toContain('setTimeout');
    }
    const settings = withoutComments(src(PAGES.settings));
    const panel = section(settings, "tab === 'calendarSync'", "tab === 'security'");
    expect(panel).not.toContain('setTimeout');
    expect((settings.match(/setTimeout/g) ?? []).length).toBe(0);
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
