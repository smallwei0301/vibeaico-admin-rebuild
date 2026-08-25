/**
 * 關鍵字回覆頁的接線不可回歸測試（GitHub issue #5 「修復-3」第 ① 項驗收）
 * -----------------------------------------------------------------------------
 * 修改前（14 分冊 §1 根因 A）：整頁 CRUD 都是本地 state ——
 *   const save = async () => { … setRows((list) => [...list, {…}]); toast.show('已儲存'); };
 *   const remove = () => { setRows((l) => l.filter(…)); toast.show('已刪除'); };
 *   const toggleRow = (row) => { setRows(…); toast.show('已啟用'); };
 *   const confirmSystemDisable = () => { setSystemEnabled(…); toast.show('已停用…'); };
 * 清單讀的是頁內的 `MOCK_KEYWORD_REPLIES` 常數，整頁只 import 了 `listFeatures`。
 * 端點（GET/POST /api/settings/line/keyword-replies、PUT/DELETE /[id]）與 webhook
 * 分支 ②（src/server/line-events.ts）明明都在跑 —— 店家設好關鍵字、看到「已儲存」，
 * 顧客在 LINE 打那個字**永遠不會有任何回應**。
 *
 * ⚠️ 為什麼是「讀原始碼」而不是 render 測試：本專案沒有安裝
 *    @testing-library/react，vitest 單元測試跑在 node 環境
 *    （vitest.config.mts: environment: 'node'），無法掛載 React 元件。
 *    這裡測的是靜態不變條件；「頁面存了關鍵字 → webhook 就認得」那條真鏈路由
 *    tests/integration/api/keyword-replies.05.test.ts 負責。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { keywordRepliesPage } from '@/i18n/zh-TW/pages/keyword-replies';
import { fromApiRow, toApiPayload } from '@/services/keyword-replies';

const PAGE = 'src/app/tenant/keyword-replies/page.tsx';
const SERVICE = 'src/services/keyword-replies.ts';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

/** 去掉註解，避免「解釋為什麼不能這樣寫」的說明被誤判成違規程式碼 */
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 取出某個 const 箭頭函式的函式體（到下一個頂層 `  const ` 為止） */
function handlerBody(code: string, name: string): string {
  const start = code.indexOf(`const ${name} =`);
  expect(start, `頁面找不到 handler：${name}`).toBeGreaterThan(-1);
  const rest = code.slice(start + 1);
  const end = rest.indexOf('\n  const ');
  return rest.slice(0, end === -1 ? undefined : end);
}

describe('keyword-replies 頁：四個動作真的打端點（issue #5 ①）', () => {
  const code = withoutComments(src(PAGE));

  it('頁內不再有 MOCK_KEYWORD_REPLIES（清單來源改為 listKeywordReplies）', () => {
    expect(code).not.toMatch(/MOCK_KEYWORD_REPLIES/);
    expect(code).toMatch(/import\s*\{[^}]*listKeywordReplies[^}]*\}\s*from\s*'@\/services\/keyword-replies'/s);
  });

  it.each([
    ['save（新增）', 'save', 'createKeywordReply'],
    ['save（編輯）', 'save', 'updateKeywordReply'],
    ['remove（刪除）', 'remove', 'deleteKeywordReply'],
    ['toggleRow（啟停）', 'toggleRow', 'setKeywordReplyActive'],
  ])('%s 呼叫 %s → %s', (_label, handler, fn) => {
    expect(handlerBody(code, handler), `${handler} 沒有呼叫 ${fn}`).toMatch(
      new RegExp(`await ${fn}\\(`),
    );
  });

  it('系統關鍵字停用/恢復落到後端（saveLineSettings 寫 systemKeywordGroupsDisabled）', () => {
    // 儲存位置：tenant_settings.line jsonb 的 systemKeywordGroupsDisabled
    // （src/config/tenant-settings.ts），webhook 分支 ④ 讀的就是這個鍵。
    const body = handlerBody(code, 'persistSystemDisabled');
    expect(body).toMatch(/await saveLineSettings\(\{\s*systemKeywordGroupsDisabled/);
    for (const handler of ['requestSystemToggle', 'confirmSystemDisable']) {
      expect(handlerBody(code, handler), `${handler} 沒有走 persistSystemDisabled`)
        .toMatch(/persistSystemDisabled\(/);
    }
  });

  it('載入時讀後端的停用清單（getTenantSettings），不是每次都預設全開', () => {
    expect(code).toMatch(/getTenantSettings\(\)/);
    expect(code).toMatch(/systemKeywordGroupsDisabled/);
  });
});

describe('keyword-replies 頁：成功訊息只在副作用成功後才顯示（00 鐵則 12）', () => {
  const code = withoutComments(src(PAGE));

  it('沒有 setTimeout 假延遲（假成功的典型手法）', () => {
    expect(code).not.toMatch(/setTimeout/);
  });

  it.each(['save', 'remove', 'toggleRow', 'persistSystemDisabled'])(
    '%s 的 toast 位在 await 之後，且 catch 分支顯示失敗訊息',
    (handler) => {
      const body = handlerBody(code, handler);
      const awaitAt = body.search(/await (createKeywordReply|updateKeywordReply|deleteKeywordReply|setKeywordReplyActive|saveLineSettings)\(/);
      const toastAt = body.indexOf('toast.show');
      expect(awaitAt, `${handler} 沒有任何 service 呼叫`).toBeGreaterThan(-1);
      expect(toastAt, `${handler} 沒有 toast`).toBeGreaterThan(-1);
      expect(toastAt, `${handler} 的成功 toast 出現在 await 之前`).toBeGreaterThan(awaitAt);
      expect(body, `${handler} 沒有 catch`).toMatch(/catch/);
    },
  );

  /**
   * ⚠️ 前提變更，不是標準放寬（14 分冊 §8.16 擁有者裁決）。
   *
   * 原案例名：「訂閱狀態未知時用『無法確認訂閱狀態』文案，不假裝知道」
   * 原斷言：頁面必須出現 `savedUnknownSubscription` 與 `savedDisabledUnknown`
   *         兩個鍵，也就是**強制**頁面在存檔成功後再掛一句「無法確認是否生效」。
   *
   * 為什麼那個斷言現在必須反過來：
   * 1. 停用系統關鍵字 → §8.16 把 webhook 的閘門拆了，一律生效。「是否生效」
   *    不再有未知狀態可言。
   * 2. 自訂關鍵字 → 寫入端點帶 requireFeature('KEYWORD_REPLY')，未訂閱一律
   *    403（tests/integration/api/keyword-replies.05.test.ts「自訂關鍵字寫入端點
   *    回 403…」）。**能走到成功 toast 就代表端點回了 200 ＝ 訂閱有效**——
   *    200 這件事本身就是量測結果。再說一次「無法確認訂閱狀態」是**捏造的不確定
   *    性**，與捏造確定性同樣是假的已知。
   *
   * 新斷言的強度**高於**舊的，不是放寬：舊案例只要求「這兩個鍵有出現」（一個
   * 存在性檢查）；新案例改成**禁止**這五個鍵與整批「尚未生效／無法確認」字串
   * 出現在頁面與字典裡（否定式白名單，涵蓋的字面量更多、也擋得住日後有人把
   * 舊文案抄回來）。三態 useState 的斷言原樣保留——featureActive 仍需要 null
   * 來決定「不知道就不上鎖」。
   */
  it('成功 toast 不得再宣稱「尚未生效／無法確認訂閱狀態」（§8.16 後那是捏造的不確定性）', () => {
    for (const dead of [
      'savedNotActive', 'savedUnknownSubscription',
      'savedDisabled', 'savedDisabledUnknown', 'enabledNotActive',
    ]) {
      expect(code, `頁面又用回被 §8.16 廢掉的文案鍵 ${dead}`)
        .not.toMatch(new RegExp(dead));
      expect(
        (keywordRepliesPage.messages as Record<string, unknown>)[dead],
        `字典又長回被 §8.16 廢掉的文案鍵 messages.${dead}`,
      ).toBeUndefined();
    }
    // 字典裡任何一句都不准再出現這兩種說法（連新加的鍵也一起擋）
    const dictionary = src('src/i18n/zh-TW/pages/keyword-replies.ts');
    const strings = withoutComments(dictionary);
    expect(strings, '字典又出現「尚未生效」').not.toMatch(/尚未生效/);
    expect(strings, '字典又出現「無法確認訂閱狀態」').not.toMatch(/無法確認訂閱狀態/);
    // featureActive 仍是三態（null＝不知道 → 不上鎖，交給端點回真答案）
    expect(code).toMatch(/React\.useState<boolean \| null>/);
  });

  /**
   * §8.16 的另一半：**畫面上的鎖只能鎖自訂關鍵字，不准鎖停用開關**。
   * 一旦有人把 featureLocked 加進那顆 SwitchField 的 disabled，未訂閱的店家
   * 又會變成「後端肯關、前端不讓按」——閘門等於原地復活。
   *
   * 這裡把開關的三個 prop 連在一起比對（而不是抓整段 SwitchField 再搜字串）：
   * SwitchField 的 description 裡包著「覆蓋」用的關鍵字按鈕，那些**本來就該**
   * 帶 featureLocked（覆蓋＝自訂內容＝付費範圍），整段搜尋會誤判。
   */
  it('系統關鍵字停用開關的 disabled 只吃 systemSaving（§8.16：停用不該被付費閘門擋）', () => {
    expect(
      code,
      '停用開關的 disabled 不再是單純的 {systemSaving}——featureLocked 可能被加回去了',
    ).toMatch(
      /checked=\{!disabledGroups\.includes\(g\.key\)\}\s*\n\s*disabled=\{systemSaving\}\s*\n\s*onCheckedChange=\{\(v\) => requestSystemToggle\(g\.key, v\)\}/,
    );
  });

  /**
   * 反向：閘門不准拆過頭。「覆蓋」是點某個系統關鍵字 → 開新增視窗建一筆
   * keyword_replies（＝自訂內容，付費範圍），那顆按鈕**必須**還鎖著。
   */
  it('「覆蓋」用的關鍵字按鈕仍鎖在 featureLocked（自訂內容還是要付費）', () => {
    expect(code).toMatch(
      /disabled=\{featureLocked\}[\s\S]{0,200}?onClick=\{\(\) => openCreate\(\{ keyword: k, overridesSystem: k \}\)\}/,
    );
  });

  it('清單／系統設定載入失敗時顯示既有的失敗文案，不是靜靜顯示空清單', () => {
    expect(code).toMatch(/t\.custom\.loadFailed/);
    // 這句的原意就是「為避免誤覆寫你先前的停用設定，已暫停顯示開關」
    expect(code).toMatch(/t\.system\.loadFailed/);
  });
});

describe('service 層的欄位對應與 webhook 讀的鍵一致（issue #5 ①）', () => {
  const code = withoutComments(src(SERVICE));

  it.each([
    ['GET 清單', 'listKeywordReplies', "'/api/settings/line/keyword-replies'"],
    ['POST 新增', 'createKeywordReply', "'/api/settings/line/keyword-replies'"],
  ])('%s → %s 打 %s', (_l, fn, path) => {
    const body = handlerBody(code, fn);
    expect(body).toContain(path);
  });

  it.each(['updateKeywordReply', 'setKeywordReplyActive', 'deleteKeywordReply'])(
    '%s 打 /api/settings/line/keyword-replies/${id}',
    (fn) => {
      expect(handlerBody(code, fn)).toContain('/api/settings/line/keyword-replies/${id}');
    },
  );

  it('toApiPayload 把 replyText 放進 content.text —— webhook 的 keywordReplyMessage 讀的就是這個鍵', () => {
    const payload = toApiPayload({
      keyword: '停車', matchType: 'CONTAINS', actionType: 'REPLY_CONTENT',
      replyText: '巷口有停車場', imageUrl: '', linkUrl: 'https://example.com',
      linkLabel: '看地圖', enabled: true, overridesSystem: '',
    });
    expect(payload.keywords).toEqual(['停車']);
    expect(payload.content.text).toBe('巷口有停車場');
    expect(payload.content.matchType).toBe('CONTAINS');
    expect(payload.content.linkUrl).toBe('https://example.com');
    expect(payload.active).toBe(true);
  });

  it('fromApiRow ↔ toApiPayload 來回一趟不掉欄位（頁面編輯既有列會用到）', () => {
    const row = {
      keyword: '價格', matchType: 'EXACT' as const, actionType: 'REPLY_CONTENT' as const,
      replyText: '剪髮 600 起', imageUrl: '', linkUrl: '', linkLabel: '',
      enabled: false, overridesSystem: '會員',
    };
    const back = fromApiRow({
      id: 'kw_x', keywords: toApiPayload(row).keywords, replyType: 'TEXT',
      content: toApiPayload(row).content, active: toApiPayload(row).active, sortOrder: 0,
    });
    expect(back).toEqual({ id: 'kw_x', ...row });
  });

  it('舊列相容：content 只有 replyText（沒有 text）時仍讀得回來', () => {
    const back = fromApiRow({
      id: 'kw_old', keywords: ['地址'], replyType: 'TEXT',
      content: { replyText: '台北市…' }, active: true, sortOrder: 0,
    });
    expect(back.replyText).toBe('台北市…');
    expect(back.matchType).toBe('CONTAINS'); // 沒有 matchType 的舊列 → 預設值
  });
});

describe('頁面文案沿用既有字典（鐵則 1：頁面元件零硬編碼中文）', () => {
  it('本輪用到的 messages 鍵都真的存在（引用不存在的鍵 = typecheck 才會抓到的假接線）', () => {
    // §8.16 之後這份清單少了五個鍵（savedNotActive / savedUnknownSubscription /
    // savedDisabled / savedDisabledUnknown / enabledNotActive）——它們被刪掉是因為
    // 描述的狀態不存在了，理由與「不得復活」的斷言寫在上面那個 it 裡。
    for (const key of [
      'saved', 'saveFailed', 'deleted', 'enabled',
      'disabled', 'systemGroupDisabled', 'systemGroupRestored',
    ] as const) {
      expect(keywordRepliesPage.messages[key], `messages.${key} 不存在`).toBeTruthy();
    }
    expect(keywordRepliesPage.custom.loadFailed).toBeTruthy();
    expect(keywordRepliesPage.system.loadFailed).toBeTruthy();
  });
});

/* ========================================================================== */
/* §8.16：停用系統內建關鍵字一律生效，付費閘門只擋「自訂內容」                    */
/* ========================================================================== */

/**
 * 14 分冊 §8.16（**擁有者裁決**，不是主導者複核，不可翻案）：
 *
 *   > 停用設定一律生效，付費閘門只擋「自訂內容」（店家自己編一組新的關鍵字回覆）。
 *
 * 修改前 `isSystemGroupDisabled` 的最後一行是
 * `return isFeatureActive(tenant.id, 'KEYWORD_REPLY')`——未訂閱的店家把開關關掉，
 * 顧客照樣收到自動回覆。畫面文案有講（所以不是假成功），但行為本身不對：
 * 「關掉某個東西」不該需要付費，診所業態甚至可能是合規問題。
 *
 * 這一組是**靜態鎖**（14 分冊 §7.2 的第四層判準）。真正證明 bot 閉嘴的是
 * tests/integration/api/keyword-replies.05.test.ts 那條打 webhook 的案例；
 * 這裡負責的是「有人手滑把閘門加回來，unit 就先紅」，不必等整合測試環境。
 */
describe('webhook 的系統關鍵字停用不得有付費閘門（14 分冊 §8.16 擁有者裁決）', () => {
  const LINE_EVENTS = 'src/server/line-events.ts';
  const code = withoutComments(src(LINE_EVENTS));

  /** 取出一個 `function name(...) {...}` 宣告的完整原始碼（到下一個頂層宣告為止） */
  function functionBody(source: string, name: string): string {
    const start = source.indexOf(`function ${name}(`);
    expect(start, `line-events.ts 找不到 function ${name}`).toBeGreaterThan(-1);
    const rest = source.slice(start + 1);
    const end = rest.search(/\n(async )?function /);
    return rest.slice(0, end === -1 ? undefined : end);
  }

  it('isSystemGroupDisabled 內零 isFeatureActive／零 requireFeature（閘門真的拆了）', () => {
    const body = functionBody(code, 'isSystemGroupDisabled');
    expect(body, 'isSystemGroupDisabled 又長回 isFeatureActive 閘門（§8.16 禁止）')
      .not.toMatch(/isFeatureActive/);
    expect(body).not.toMatch(/requireFeature/);
    expect(body).not.toMatch(/KEYWORD_REPLY/);
    // 只讀 tenant_settings.line 的那份清單，別的都不看
    expect(body).toMatch(/systemKeywordGroupsDisabled/);
  });

  it('呼叫端只看停用清單，不再帶 tenant 去查訂閱', () => {
    expect(code).toMatch(/isSystemGroupDisabled\(lineConfig, hit\.group\)/);
    expect(code, '呼叫端又把 tenant 傳進 isSystemGroupDisabled ＝ 準備查訂閱')
      .not.toMatch(/isSystemGroupDisabled\(\s*tenant/);
  });

  /**
   * 反向鎖：閘門**不准拆過頭**。KEYWORD_REPLY 擋的是「自訂內容」的寫入端點，
   * 那三支 route 一定要留著 requireFeature，否則就從「該收費的沒收」變成漏洞。
   */
  it('自訂關鍵字的寫入端點仍然 requireFeature(KEYWORD_REPLY)（閘門沒被拆過頭）', () => {
    const list = withoutComments(src('src/app/api/settings/line/keyword-replies/route.ts'));
    const one = withoutComments(src('src/app/api/settings/line/keyword-replies/[id]/route.ts'));
    expect(list, 'POST 少了 requireFeature').toMatch(/requireFeature\(t\.tenantId, 'KEYWORD_REPLY'\)/);
    // PUT 與 DELETE 各一次
    expect(one.match(/requireFeature\(t\.tenantId, 'KEYWORD_REPLY'\)/g) ?? []).toHaveLength(2);
  });

  /**
   * webhook 分支 ④ 的停用判斷是同步函式了；若有人改回 async 又忘了 await，
   * `if (Promise)` 恆為 truthy，會變成「所有內建關鍵字全部不回應」的大災難。
   */
  it('isSystemGroupDisabled 是同步函式（改成 async 而呼叫端沒 await 會全站靜音）', () => {
    expect(code).toMatch(/\nfunction isSystemGroupDisabled\(/);
    expect(code).not.toMatch(/async function isSystemGroupDisabled\(/);
  });
});
