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

    it('六格文字取自 MODE_PRESETS.richMenuCells，與頁面的「每格設定」無關', () => {
      expect(route).toContain('MODE_PRESETS[businessType].richMenuCells[i].label');
      expect(route).toContain('MODE_PRESETS[businessType].richMenuCells[i].text');
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
      // Flex 分頁的「發布」沒有呼叫任何端點，使用說明不得宣稱按了就儲存生效
      expect(t.intro.flexMenuSteps[4]).not.toContain('儲存生效');
      expect(t.intro.flexMenuSteps[4]).toContain('尚未接上儲存');
    });

    it('佈局區常駐告示：選了也不會改變顧客看到的選單', () => {
      expect(t.layout.publishFixedNote).toContain('只影響本頁預覽');
      expect(t.layout.publishFixedNote).toContain('3×2 六格');
      expect(code).toContain('{t.layout.publishFixedNote}');
    });

    it('背景圖區：不再宣稱系統會疊加圖示與文字，也說明網址不會隨發布送出', () => {
      // 只准以否定句出現（「系統不會在圖上疊加…」），不准再宣稱系統會疊加
      expect(t.background.help).not.toMatch(/(?<!不)會在(上面|圖上)疊加/);
      expect(t.background.help).toContain('系統不會在圖上疊加');
      expect(t.background.help).toContain('推送到 LINE 的是底圖原圖');
      expect(t.background.notSentOnPublish).toContain('不會隨「發布到 LINE」送出');
      expect(code).toContain('{t.background.notSentOnPublish}');
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

    it('FlexMenuTab（issue #6，假成功刻意留著）未被本輪動到', () => {
      expect(code).toContain('function FlexMenuTab(');
      expect(code).toContain("toast.show(subscribed ? t.flex.saved : t.feature.flexFreeFallback, subscribed ? 'success' : 'warning')");
      expect(t.flex.saved).toBe('主選單已儲存！顧客下次開啟聊天時會看到新樣式');
    });

    it('背景圖「上傳圖片」按鈕的接線留給 issue #7（本輪只加說明）', () => {
      expect(code).toContain('<Button variant="outline"><Upload size={14} />{t.background.uploadImage}</Button>');
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
