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

  it('訂閱狀態未知時用「無法確認訂閱狀態」文案，不假裝知道（CLAUDE.md 誠實原則）', () => {
    // featureActive 是三態：true / false / null（listFeatures 失敗＝不知道）
    expect(code).toMatch(/savedUnknownSubscription/);
    expect(code).toMatch(/savedDisabledUnknown/);
    expect(code).toMatch(/React\.useState<boolean \| null>/);
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
    for (const key of [
      'saved', 'savedNotActive', 'savedUnknownSubscription', 'savedDisabled',
      'savedDisabledUnknown', 'saveFailed', 'deleted', 'enabled', 'enabledNotActive',
      'disabled', 'systemGroupDisabled', 'systemGroupRestored',
    ] as const) {
      expect(keywordRepliesPage.messages[key], `messages.${key} 不存在`).toBeTruthy();
    }
    expect(keywordRepliesPage.custom.loadFailed).toBeTruthy();
    expect(keywordRepliesPage.system.loadFailed).toBeTruthy();
  });
});
