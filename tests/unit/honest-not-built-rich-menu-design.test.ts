/**
 * 「假成功誠實化」不可回歸測試（GitHub issue #3 / 修復-1D：選單設計頁掃描清零）
 * -----------------------------------------------------------------------------
 * 1A/1B/1C 是照「列舉清單」逐項修，每輪結束都再冒出同類殘留——因為列舉本身不完整。
 * 本輪改成掃描式：把 /tenant/rich-menu-design（頁面 + 字典）裡「宣稱了實際不會
 * 發生的事」一次全部找出來清乾淨。判定的唯一事實依據是
 * `src/app/api/settings/line/rich-menu/create/route.ts`——按下「發布到 LINE」
 * 真正會發生的事只有：
 *
 *   ① 請求只帶 { theme }（services/settings.ts 的 createRichMenu(theme)）
 *   ② 端點固定產生 2500×1686 的 3×2 六格，文字取 MODE_PRESETS[businessType]
 *      .richMenuCells——與頁面「每格設定」「佈局」無關
 *   ③ 底圖三選一：tenant_settings.line.richMenuBgImageUrl（「LINE 設定」頁存的）
 *      → richmenu-assets bucket 的 themes/{THEME} → 現生成純色 PNG
 *   ④ **直接用底圖原圖上傳**（route 檔頭：文字疊圖合成屬後期）→ 圖上沒有店名，
 *      也沒有六格文字
 *   ⑤ 設為預設選單、best-effort 刪舊選單、richMenuId + richMenuTheme 寫回
 *      tenant_settings
 *
 * 因此以下每一件事**都不會**在發布時發生，畫面不得宣稱它會：合成店名／六格文字、
 * 套用佈局、送出每格自訂、送出本頁的背景圖網址、儲存或套用 Flex 主選單、
 * 儲存預約步驟或功能頁面樣式、備份與還原。
 *
 * ⚠️ 為什麼是「讀原始碼」而不是 render 測試：本專案沒有 @testing-library/react，
 *    vitest 跑在 node 環境（vitest.config.mts），無法掛載 React 元件。這裡測的是
 *    「原始碼中不存在任何會謊報的路徑」——對不變條件的靜態證明。與
 *    honest-not-built-pages.test.ts（1A）／-interactions.test.ts（1B）／
 *    -residuals.test.ts（1C）同一層，刻意分檔避免衝突（那三檔一字未改）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { richMenuDesignPage } from '@/i18n/zh-TW/pages/rich-menu-design';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

const RICH_MENU_PAGE = 'src/app/tenant/rich-menu-design/page.tsx';
const CREATE_ROUTE = 'src/app/api/settings/line/rich-menu/create/route.ts';

/** 去掉註解，避免「解釋為什麼不能這樣寫」的註解被誤判成違規程式碼／文案 */
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 把字典裡所有字串（含樣板函式的產出）攤平，方便對文案下斷言 */
const allStrings = (dict: unknown): string[] => {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') { out.push(value); return; }
    if (typeof value === 'function') {
      try { walk((value as (a: unknown, b: unknown) => unknown)('X', 'Y')); } catch { /* 參數型別不合就跳過 */ }
      return;
    }
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (value && typeof value === 'object') { Object.values(value).forEach(walk); return; }
  };
  walk(dict);
  return out;
};

const t = richMenuDesignPage;
/** 字典裡「會被畫面讀到」的區塊。library 是 spec 原文清單（示範資料），不在文案掃描範圍 */
const COPY_SECTIONS = [
  t.intro, t.scene, t.quickTemplates, t.theme, t.layout,
  t.background, t.cells, t.preview, t.publish, t.feature,
  t.bookingSteps, t.featurePages,
] as const;

describe('修復-1D：選單設計頁假宣稱掃描清零', () => {
  const code = withoutComments(src(RICH_MENU_PAGE));

  /* ================================================== 事實基準 */
  describe('0. 事實基準：發布端點真的只做這些事（判定假宣稱的依據）', () => {
    const route = src(CREATE_ROUTE);

    /*
     * ⚠️ 前提變更（issue #6）：這一條原本逐字比對
     * `MODE_PRESETS[businessType].richMenuCells[i].label` / `.text` 兩個字面值。
     * #6 把 action 的產生抽成 `richMenuCellAction()`（單一事實來源：FLEX_POPUP
     * 的格子要與「選單」走同一支組裝函式），那兩個字面值因此不再出現。
     *
     * 但**這一條要證的事沒有變**：六格文字來自 MODE_PRESETS，與頁面的「每格設定」
     * 無關。改成釘三件仍然成立、而且合起來比原本更嚴的事：
     *   ① 餵給 action 產生器的就是 MODE_PRESETS[businessType].richMenuCells[i]
     *   ② 端點的請求 body 只有 { theme }，沒有任何管道能從頁面帶 cells 進來
     *   ③ label/text 真的來自那個 cell —— 由 richMenuCellAction() 的單元測試
     *      （tests/unit/flex-menu.06.test.ts:「一般格子送出自己的文字；
     *      FLEX_POPUP 格子改送 FLEX_POPUP_TRIGGER_TEXT」）證明
     */
    it('六格文字取自 MODE_PRESETS.richMenuCells，與頁面的「每格設定」無關', () => {
      expect(route).toContain('richMenuCellAction(MODE_PRESETS[businessType].richMenuCells[i])');
      // 端點收得到的欄位只有 theme：頁面的 cells 沒有任何路徑進得來
      expect(route).toContain('const bodySchema = z.object({ theme:');
      expect(route).not.toMatch(/body\.cells|cells:\s*z\./);
    });

    it('版型固定 2500×1686 的 3×2 六格，與頁面的「佈局」無關', () => {
      expect(route).toContain('size: { width: 2500, height: 1686 }');
      expect(route.match(/\{ x: \d+, y: \d+, w: \d+, h: \d+ \}/g)).toHaveLength(6);
    });

    it('底圖直接原圖上傳，端點沒有任何文字／圖示合成', () => {
      expect(route).toContain('lineUploadRichMenuImage(token, richMenuId, image.bytes, image.contentType)');
      // route 檔頭自陳：疊圖合成屬後期，本端點用原圖
      expect(route).toContain('本端點直接用底圖原圖上傳');
      // 端點沒有引入任何繪圖／合成能力，唯一的圖片產生器是純色 PNG
      expect(route).toContain("import { solidColorPng } from '@/server/png'");
      expect(route).not.toMatch(/drawText|composite|overlay\(/i);
    });

    it('前端只送出 { theme } 一個欄位', () => {
      expect(withoutComments(src('src/services/settings.ts')))
        .toContain('body: JSON.stringify({ theme })');
      expect(code).toContain('await createRichMenu(pendingTheme)');
    });
  });

  /* ================================================== 1. 品牌大字帶入店名 */
  describe('1. 「品牌大字帶入店名」家族：預覽與實際推送物不一致', () => {
    it('字典任何一處都不再宣稱店名／品牌大字會被帶進圖裡', () => {
      for (const section of COPY_SECTIONS) {
        for (const text of allStrings(section)) {
          expect(text).not.toMatch(/品牌大字(自動)?帶入/);
          expect(text).not.toMatch(/(已|自動)帶入(你的)?店名/);
          expect(text).not.toMatch(/以你的店名產生/);
        }
      }
    });

    it('一頁式範本的開場白改說縮圖是版位示意、圖上不含店名與六格文字', () => {
      expect(t.scene.leadStrong).toContain('版位示意');
      expect(t.scene.leadTail).toContain('底圖原圖');
      expect(t.scene.leadTail).toContain('不會合成店名');
    });

    it('預覽區有常駐告示，說明實際推送的是底圖、文字只是點擊後送出的訊息', () => {
      const note = t.preview.notActualNote;
      expect(note).toContain('版位示意');
      expect(note).toContain('底圖原圖');
      expect(note).toContain('不會畫店名');
      expect(note).toContain('點擊後送出的訊息');
      // 右側預覽卡與範本卡片區都要有（店家是看著這兩處按下發布的）
      expect(code.match(/\{t\.preview\.notActualNote\}/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    });

    it('本輪不准為了讓預覽變成真的而去實作文字疊圖', () => {
      expect(code).not.toMatch(/canvas|toDataURL|drawImage|fillText/i);
    });
  });

  /* ================================================== 2. 同步套用 Flex／預約步驟 */
  describe('2. 「發布時同步套用 Flex／預約步驟卡」家族全數清除', () => {
    it('字典沒有任何「發布會一起套用／同步」Flex 或預約步驟的句子', () => {
      for (const section of COPY_SECTIONS) {
        for (const text of allStrings(section)) {
          expect(text).not.toMatch(/同步套用/);
          expect(text).not.toMatch(/整組(一起|視覺)/);
          expect(text).not.toMatch(/發布時.*(一起|同時)套用/);
        }
      }
    });

    it('scene.leadTail / bullets 改為明說 Flex 與預約步驟不會被一起套用', () => {
      expect(t.scene.leadTail).toContain('也不會一併套用聊天主選單（Flex）與預約步驟卡');
      const publishBullet = t.scene.bullets.find((b) => b.strong === '發布');
      expect(publishBullet?.text).toContain('不會覆蓋 Flex 主選單自訂');
      expect(publishBullet?.text).toContain('尚未建置');
    });

    it('previewSyncNote 不再宣稱自訂會同步進聊天主選單卡片', () => {
      expect(t.scene.previewSyncNote).not.toMatch(/會同步進/);
      expect(t.scene.previewSyncNote).toContain('不會隨發布送出');
      expect(t.scene.previewSyncNote).toContain('Flex）也不會一起更新');
    });

    it('整組不存在的「範本預覽產生器」假宣稱鍵全數刪除', () => {
      const keys = Object.keys(t.scene);
      for (const dead of [
        'previewCaption', 'previewGenerating', 'previewCells', 'previewBottom',
        'previewFlex', 'previewFlexNote', 'textOnlyNote', 'customizeBtn',
        'updatePreviewBtn', 'previewHeading', 'customHeading', 'labelBlankHint',
        'generating', 'generateFailed', 'previewFailed', 'previewFailedRetry',
        'flexPreviewFailed',
      ]) {
        expect(keys, dead).not.toContain(dead);
        expect(code, dead).not.toContain(`t.scene.${dead}`);
      }
    });

    it('發布確認視窗逐條列出「不會送出」的東西', () => {
      const tail = t.scene.publishConfirmTail;
      expect(tail).toContain('圖上不含店名');
      expect(tail).toContain('佈局、每格設定與本頁的背景圖網址都不會送出');
      expect(tail).toContain('Flex 主選單不會一起換');
    });
  });

  /* ================================================== 3. 範本卡「預覽」假互動 */
  describe('3. 一頁式範本卡的「預覽」鈕不再假裝有預覽', () => {
    it('按鈕改跳 warning 級的「沒有預覽可開」提示，而不是 info 級的說明文', () => {
      expect(code).toContain("toast.show(t.scene.previewNotBuilt, 'warning')");
      expect(code).not.toContain('t.scene.previewCaption');
      expect(code).not.toMatch(/toast\.show\(t\.scene\.\w+, 'info'\)/);
    });

    it('提示直說預覽後端尚未建置、縮圖只是示意', () => {
      const msg = t.scene.previewNotBuilt;
      expect(msg).toContain('沒有可開啟的預覽');
      expect(msg).toContain('尚未建置');
      expect(msg).toContain('版位示意');
    });

    it('沒有偷偷補一個預覽視窗（本輪只做誠實化）', () => {
      expect(code).not.toContain("confirm === 'preview'");
      expect(code).not.toMatch(/scenePreviewOpen|setPreviewOpen/);
    });
  });

  /* ================================================== 4. 自行掃出的同類項目 */
  describe('4. 同類殘留（自行掃描）', () => {
    it('使用說明的每一步都標明哪些只影響預覽、哪些才會真的送出', () => {
      const [themeStep, layoutStep, cellStep, popupStep, publishStep] = t.intro.richMenuSteps;
      expect(themeStep).toContain('只有這一項會隨發布送出');
      expect(layoutStep).toContain('只影響本頁預覽');
      expect(cellStep).toContain('只影響本頁預覽');
      expect(popupStep).toContain('尚未建置');
      expect(publishStep).not.toContain('即生效');
      /*
       * ⚠️ 前提變更（issue #6）：Flex 分頁的「發布」現在真的呼叫
       * POST /api/settings/line/flex-menu，所以「尚未接上儲存」那句已經不成立，
       * 留著反而變成新的謊（方向相反的那一種）。改釘仍然成立、而且更嚴格的事：
       * 使用說明的最後一步必須描述**真的會發生的事**——寫入店家設定、
       * 顧客輸入「選單」時收到——而不是 Rich Menu 那種「開啟聊天就看到」。
       */
      const flexPublishStep = t.intro.flexMenuSteps[t.intro.flexMenuSteps.length - 1];
      expect(flexPublishStep).not.toContain('尚未接上儲存');
      expect(flexPublishStep).toContain('發布 Flex 主選單到 LINE');
      expect(flexPublishStep).toContain('選單');
      // 使用說明不得再描述這個分頁沒有的欄位（Header 顏色／emoji／使用提示開關）
      const stepText = t.intro.flexMenuSteps.join('\n');
      for (const ghost of ['歡迎語', 'emoji', '使用提示']) {
        expect(stepText, `使用說明提到畫面上沒有的「${ghost}」`).not.toContain(ghost);
      }
    });

    it('佈局區常駐告示：選了也不會改變顧客看到的選單', () => {
      expect(t.layout.publishFixedNote).toContain('只影響本頁預覽');
      expect(t.layout.publishFixedNote).toContain('3×2 六格');
      expect(code).toContain('{t.layout.publishFixedNote}');
    });

    it('背景圖區：不再宣稱系統會疊加圖示與文字', () => {
      // 只准以否定句出現（「系統不會在圖上疊加…」），不准再宣稱系統會疊加
      expect(t.background.help).not.toMatch(/(?<!不)會在(上面|圖上)疊加/);
      expect(t.background.help).toContain('系統不會在圖上疊加');
      expect(t.background.help).toContain('推送到 LINE 的是底圖原圖');
    });

    /**
     * ⚠️ 前提變更（issue #7 (乙)）：底圖**真的接上了**，所以舊斷言
     * `t.background.notSentOnPublish` 要求的那句「不會隨『發布到 LINE』送出」
     * 已經不成立，留著就變成方向相反的謊——使用者會以為剛存的底圖不會生效。
     * 處理方式與正上方 issue #6 那次相同：不是放寬，是**改釘更嚴格的事**——
     * 那句話不准回來，而且鏈路的每一段都要在程式碼裡看得到。
     *
     * 這條在防的是：有人把上傳按鈕改回「只 setBgUrl 就 toast 成功」。
     * 那樣改完畫面一模一樣、發布也回 200，但顧客看到的仍是主題底圖——
     * 因為 `/api/settings/line/rich-menu/create` 的 loadBackgroundImage() 讀的是
     * tenant_settings.line.richMenuBgImageUrl，不是發布請求的 body。
     */
    it('背景圖上傳真的接上 /api/upload，且結果有寫進 tenant_settings（否則發布用不到）', () => {
      // 過期的「尚未接上／不會隨發布送出」文案必須整個消失，不能只是不引用
      expect(Object.keys(t.background)).not.toContain('notSentOnPublish');
      for (const text of allStrings(t.background)) {
        expect(text).not.toContain('不會隨「發布到 LINE」送出');
        expect(text).not.toContain('尚未接上上傳後端');
      }
      // ① 檔案 → /api/upload 的 richmenu-assets bucket
      expect(code).toContain("uploadImage(file, 'richmenu-assets')");
      // ② 上傳回來的網址寫進 tenant_settings.line.richMenuBgImageUrl —— 少了這一步，
      //    發布時讀到的仍是舊值，畫面卻已經 toast 成功
      expect(code).toContain('saveLineSettings({ richMenuBgImageUrl: url })');
      // ③ 成功 toast 只能在兩個 await 都回來之後
      const uploadFn = code.slice(
        code.indexOf('const uploadBackground'),
        code.indexOf('const saveBackgroundUrl'),
      );
      expect(uploadFn).not.toBe('');
      expect(uploadFn.indexOf('saveLineSettings'))
        .toBeLessThan(uploadFn.indexOf('toast.show(t.background.uploaded)'));
      // ④ 進頁面要把已存的底圖讀回來，否則欄位永遠空白＝畫面與事實不符
      expect(code).toContain('settings.line.richMenuBgImageUrl');
      // ⑤ 1MB 上限（LINE 對圖文選單圖片的硬限制）要在上傳前就擋，不能等發布才失敗
      expect(code).toContain('RICH_MENU_BG_MAX_BYTES');
      expect(t.background.tooLarge).toContain('1MB');
      // ⑥ 「還沒儲存」的警告只在草稿與已存值不同時出現，不是永遠掛著的紅字
      expect(code).toContain('bgUrlDraft !== bgUrl ? (');
      expect(code).toContain('{t.background.unsavedDraft}');
    });

    it('背景圖區不再有任何「已存到雲端／重整後會還原」的雲端保存宣稱', () => {
      const keys = Object.keys(t.background);
      for (const dead of ['savedToCloud', 'cloudFailed', 'localFallback']) {
        expect(keys, dead).not.toContain(dead);
      }
      for (const text of allStrings(t.background)) {
        expect(text).not.toMatch(/雲端/);
        expect(text).not.toMatch(/重整後也會還原/);
      }
    });

    it('格子圖示上傳：欄位一律停用並附說明，成功／雲端訊息已刪除', () => {
      const keys = Object.keys(t.cells);
      for (const dead of ['iconUploaded', 'iconNoneHint', 'iconCloudFailed']) {
        expect(keys, dead).not.toContain(dead);
      }
      expect(t.cells.iconUploadNotBuilt).toContain('尚未建置');
      expect(code).toContain('disabled title={t.cells.iconUploadNotBuilt}');
      expect(code).toContain('{t.cells.iconUploadNotBuilt}');
    });

    it('Flex 彈窗視窗按「儲存」改為誠實提示，不再 toast「已儲存」', () => {
      expect(Object.keys(t.flex)).not.toContain('popupSaved');
      expect(code).not.toContain('t.flex.popupSaved');
      expect(code).toContain("toast.show(t.cells.flexPopupNotEffective, 'warning')");
      expect(t.cells.flexPopupNotEffective).toContain('未儲存');
      expect(t.cells.flexPopupNotEffective).toContain('尚未建置');
    });

    it('付費升級文案不再暗示「訂閱後自訂就會出現在 LINE 上」', () => {
      expect(t.feature.barTail).toContain('訂閱不會讓上列修改出現在 LINE 選單上');
      expect(t.feature.freeFallbackNotice).toContain('尚未接上發布');
      expect(t.feature.freeFallbackNotice).not.toMatch(/要套用自訂請訂閱/);
      // 描述「不存在的訂閱閘門」的三個鍵已刪除
      const keys = Object.keys(t.feature);
      for (const dead of ['advancedNeeded', 'cellEditNeeded', 'downgradeHint']) {
        expect(keys, dead).not.toContain(dead);
      }
    });

    it('「進階」主題徽章旁說明它其實不擋發布', () => {
      expect(t.theme.advancedBadgeNote).toContain('不會被擋');
      expect(code).toContain('{t.theme.advancedBadgeNote}');
    });

    it('行業分類 Badge 不再偽裝成可點擊的篩選鈕', () => {
      expect(code).not.toContain('cursor-pointer hover:bg-neutral-250');
    });

    it('沒有任何區塊留著「上傳成功」訊息卻連上傳 UI 都沒有', () => {
      expect(Object.keys(t.bookingSteps)).not.toContain('stepImageUploaded');
      expect(Object.keys(t.featurePages)).not.toContain('imageUploaded');
    });
  });

  /* ================================================== 5. 全頁掃描收斂 */
  describe('5. 收斂：整份字典掃描不再出現同類措辭', () => {
    it('沒有「即時生效／自動儲存／已上線／已備份」這類未經證實的宣告', () => {
      for (const section of COPY_SECTIONS) {
        for (const text of allStrings(section)) {
          expect(text).not.toMatch(/即時生效/);
          expect(text).not.toMatch(/自動儲存/);
          expect(text).not.toMatch(/已上線/);
          expect(text).not.toMatch(/已備份|自動備份/);
          // 「無法一鍵還原」是 1C 的誠實化句子，只擋「可以一鍵還原／反悔」的承諾
          expect(text).not.toMatch(/(可|能|會)(隨時)?一鍵(還原|反悔)/);
        }
      }
    });

    it('頁面沒有任何「假成功」toast：非 danger 的成功訊息只出現在真的呼叫了端點之處', () => {
      // RichMenuTab 內唯一的 'success' toast 是發布成功（createRichMenu 已回傳）
      const richMenuTab = code.slice(code.indexOf('function RichMenuTab('), code.indexOf('function MenuPreview('));
      const successToasts = richMenuTab.match(/toast\.show\([^;]*'success'[^;]*\)/g) ?? [];
      expect(successToasts).toHaveLength(1);
      expect(successToasts[0]).toContain('t.publish.published');
      // 刪除成功的 toast 走預設 tone，同樣在 deleteRichMenu() 之後
      expect(richMenuTab).toContain('await deleteRichMenu();');
    });
  });

  /* ================================================== 禁區守門 */
  describe('禁區未被動到（本輪只准改文案與說明）', () => {
    it('Rich Menu 發布／刪除的程式邏輯一行未改', () => {
      expect(code).toContain('const result = await createRichMenu(pendingTheme);');
      expect(code).toContain('setRichMenuId(result.richMenuId);');
      expect(code).toContain('setTheme(pendingTheme);');
      expect(code).toContain('await deleteRichMenu();');
      expect(code).toContain("setRichMenuId('');");
      expect(code).toContain("confirm === 'publish'");
      expect(code).toContain("confirm === 'delete'");
      expect(code).toContain('e instanceof ApiError ? e.message : t.publish.publishFailed');
    });

    /*
     * ⚠️ **前提變更（2026-08-25，issue #6）。**
     *
     * 這一條原本釘的是「FlexMenuTab 的假成功**刻意留著**」——
     * issue #3 那一輪只做誠實化，把 Flex 分頁整個排給 #6，所以當時用
     * 「發布鈕仍是 toast.show(...)」與「t.flex.saved 逐字不變」兩句
     * 鎖住它別被順手動到。
     *
     * issue #6 就是來把它變真的那一輪，那個前提**在本輪失效**（體例比照
     * tests/unit/feature-store-restore-result.28.test.ts 的同型註解）。
     * 改寫規則：新斷言的強度不得低於舊的。舊斷言只證明「這裡還是假的」，
     * 新斷言證明的是更強的一件事——**這裡不可以再是假的**：
     *   ① 發布鈕真的 await 了 saveFlexMenu()（有端點被呼叫）
     *   ② 成功 toast 只出現在 await 之後，不在 catch 之前
     *   ③ 卡片是從 getTenantSettings() 載回來的，不是本地預設值
     *   ④ 字典裡不得再有 flexFreeFallback（那句話宣稱了不存在的免費降級版）
     * 這四條任何一條被改回去都會紅，比原本「逐字比對一句文案」更難繞過。
     */
    it('FlexMenuTab 已接上真後端：發布 = await saveFlexMenu()，成功訊息在其後', () => {
      const flexTab = code.slice(code.indexOf('function FlexMenuTab('));
      expect(flexTab).toContain('await saveFlexMenu({');
      expect(flexTab).toContain('flexCards: toPayload(cards),');
      expect(flexTab).toContain("toast.show(t.flex.saved, 'success');");
      // 成功 toast 必須排在 await 之後（順序反了就是「先報喜再送出」）
      expect(flexTab.indexOf('await saveFlexMenu({'))
        .toBeLessThan(flexTab.indexOf("toast.show(t.flex.saved, 'success');"));
      // 失敗有自己的分支，不會被成功訊息蓋掉
      expect(flexTab).toContain('t.flex.saveFailedPrefix');
    });

    it('FlexMenuTab 的卡片來自 getTenantSettings()，不是本地預設值', () => {
      const flexTab = code.slice(code.indexOf('function FlexMenuTab('));
      expect(flexTab).toContain('await getTenantSettings()');
      expect(flexTab).toContain('s.line.flexCards');
      // 「清除已發布」真的把空陣列存回去，不是只清畫面
      expect(flexTab).toContain('await saveFlexMenu({ flexCards: [] })');
    });

    it('字典不再宣稱有「免費的基本款氣泡主選單」（flexFreeFallback 已刪）', () => {
      expect(Object.keys(t.feature)).not.toContain('flexFreeFallback');
      expect(code).not.toContain('t.feature.flexFreeFallback');
    });

    /**
     * ⚠️ 前提變更（issue #7 (乙)）：這條原本釘的是「按鈕**必須**維持成沒有 onClick
     * 的死按鈕」，理由是接線留給 issue #7。issue #7 就是這一輪，接線已完成，
     * 所以繼續釘住那個字面 JSX 等於禁止本 issue 交付它要交付的東西。
     * 依 12 §2.4：不是放寬斷言，是**把它換成接線完成後才成立的更嚴格條件**——
     * 按鈕必須有 onClick，而且點下去要走到 uploadBackground()（真正的鏈路斷言
     * 在上方「背景圖上傳真的接上 /api/upload…」那一條）。
     */
    it('背景圖「上傳圖片」按鈕不再是死按鈕（issue #7 接線完成）', () => {
      expect(code).not.toContain('<Button variant="outline"><Upload size={14} />{t.background.uploadImage}</Button>');
      expect(code).toContain('bgFileRef.current?.click()');
      expect(code).toContain('if (file) void uploadBackground(file);');
      // 只收 LINE 允許的兩種格式（/api/upload 的 LINE_BOUND_BUCKETS 也會擋，
      // 這裡讓使用者在選檔對話框就看得到）
      expect(code).toContain('accept="image/jpeg,image/png"');
    });

    it('1A/1B/1C 的誠實化成果沒有被本輪回退', () => {
      expect(t.publish.published).toContain('尚未建置');
      expect(t.publish.draftNotEffective).toContain('尚未建置');
      expect(t.scene.noBackupBar).toContain('尚未建置');
      expect(t.quickTemplates.notBuiltBody).toContain('尚未建置');
      expect(t.bookingSteps.notBuiltBody).toContain('尚未建置');
      expect(t.featurePages.notBuiltBody).toContain('尚未建置');
    });
  });
});
