/**
 * issue #27 ① — ai-settings 頁的端點歸屬與「嚴格模式」接線
 * -----------------------------------------------------------------------------
 * 修好前的病（14 分冊 §7.3）：`src/app/tenant/ai-settings/page.tsx` 呼叫的是
 * `saveLineSettings({ autoReplyEnabled: enabled, defaultReply: prompt })`，
 * 把店家寫給 **AI** 的提示詞寫進 `tenant_settings.line.defaultReply`。那個欄位是
 * webhook 分支 ⑥ 的「沒有 AI 時的靜態罐頭回覆」，於是提示詞被逐字推播給每一位
 * 傳訊息來的顧客；同時分支 ⑤ 讀的 `tenant_settings.ai.enabled` 永遠停在 false，
 * 畫面上那句「AI 客服設定已儲存（已啟用）」從頭到尾都是假的。
 *
 * 14 分冊 §8.1 裁決**分家**：
 *   - `line.autoReplyEnabled` / `line.defaultReply` → 只由 line-settings 頁寫
 *   - `tenant_settings.ai.*`                       → 只由 ai-settings 頁寫
 *
 * 本檔守的是**接線本身不可回歸**（跑起來不碰網路/DB，12 分冊 §3）；真的打端點、
 * 直查 DB、驗 mock LINE 收到什麼，在 tests/integration/api/ai-settings.27.test.ts。
 *
 * ⚠️ 為什麼是「讀原始碼」：本專案沒裝 @testing-library/react，單元測試在 node
 *    環境無法掛載元件——同 honest-not-built-interactions.test.ts 的既有作法。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { aiSettingsSchema } from '@/config/tenant-settings';
import { isLikelyChitchat } from '@/server/line-events';
import { aiSettingsPage } from '@/i18n/zh-TW/pages/ai-settings';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

/** 去掉註解：解釋「以前是這樣寫、現在不可以」的註解不該被當成違規程式碼 */
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const FILES = {
  page: 'src/app/tenant/ai-settings/page.tsx',
  service: 'src/services/settings.ts',
  route: 'src/app/api/ai-settings/route.ts',
  lineEvents: 'src/server/line-events.ts',
  lineSettingsPage: 'src/app/tenant/line-settings/page.tsx',
} as const;

describe('① ai-settings 走專用端點 PUT /api/ai-settings', () => {
  it('頁面呼叫 service 的 getAiSettings/saveAiSettings，而不是 saveLineSettings', () => {
    const code = withoutComments(src(FILES.page));

    expect(code).toMatch(/import\s*\{[^}]*getAiSettings[^}]*\}\s*from\s*'@\/services\/settings'/);
    expect(code).toMatch(/import\s*\{[^}]*saveAiSettings[^}]*\}\s*from\s*'@\/services\/settings'/);
    expect(code).toMatch(/await saveAiSettings\(/);
    expect(code).toMatch(/await getAiSettings\(\)/);

    // 修好前的那一行：只要它回來，這條就紅（變異測試的著力點）
    expect(code).not.toMatch(/saveLineSettings/);
    expect(code).not.toMatch(/getTenantSettings/);
  });

  it('頁面不再讀寫 line.* 的任何欄位（§8.1 分家）', () => {
    const code = withoutComments(src(FILES.page));
    expect(code).not.toMatch(/autoReplyEnabled/);
    expect(code).not.toMatch(/defaultReply/);
    expect(code).not.toMatch(/\.line\./);
  });

  it('頁面不得自行 fetch —— 唯一資料入口是 src/services/*（CLAUDE.md 硬規則）', () => {
    const code = withoutComments(src(FILES.page));
    expect(code).not.toMatch(/\bfetch\(/);
  });

  it('service 的兩支函式打的是 /api/ai-settings，PUT 用整包 body', () => {
    const code = withoutComments(src(FILES.service));
    expect(code).toMatch(/export const getAiSettings[\s\S]{0,400}?request<AiSettings>\('\/api\/ai-settings'\)/);
    expect(code).toMatch(
      /export const saveAiSettings[\s\S]{0,500}?request<void>\('\/api\/ai-settings',\s*\{\s*method:\s*'PUT'/,
    );
  });

  it('端點寫的是 tenant_settings.ai 欄位，且帶 MANAGER + AI_ASSISTANT 閘門（09 §7.1）', () => {
    const code = withoutComments(src(FILES.route));
    expect(code).toMatch(/requireTenant\('MANAGER'\)/);
    expect(code).toMatch(/requireFeature\(t\.tenantId,\s*'AI_ASSISTANT'\)/);
    expect(code).toMatch(/upsert\(\{\s*tenant_id:\s*t\.tenantId,\s*ai\s*\}/);
  });

  /**
   * 「兩頁不會互相覆蓋」的靜態證明：欄位所有權在原始碼層面就是互斥的。
   * （真的各存一次、互查對方欄位沒被動到，在整合測試
   *  ai-settings.27.test.ts:「line-settings 存罐頭回覆，不會動到 ai.*；反之亦然」）
   */
  it('欄位所有權互斥：只有 line-settings 寫 line.autoReplyEnabled/defaultReply', () => {
    const aiPage = withoutComments(src(FILES.page));
    const linePage = withoutComments(src(FILES.lineSettingsPage));

    // line-settings 這一側維持原樣（它才是 line.* 的擁有者）
    expect(linePage).toMatch(/saveLineSettings\(\{\s*autoReplyEnabled,\s*defaultReply\s*\}\)/);
    // line-settings 不碰 ai.*
    expect(linePage).not.toMatch(/saveAiSettings|\/api\/ai-settings/);
    // ai-settings 不碰 line.*（上面已驗，這裡把兩側擺在一起讓失敗訊息一眼看懂）
    expect(aiPage).not.toMatch(/saveLineSettings/);
  });
});

describe('① 嚴格模式 strictMode 真的存得進 tenant_settings.ai 並在 webhook 生效', () => {
  it('aiSettingsSchema 有 strictMode，老資料預設 false', () => {
    const parsed = aiSettingsSchema.parse({});
    expect(parsed.strictMode).toBe(false);
    expect(aiSettingsSchema.parse({ strictMode: true }).strictMode).toBe(true);
  });

  it('頁面把 strictMode 一起送進 saveAiSettings，並在載入時讀回來', () => {
    const code = withoutComments(src(FILES.page));
    // 純本地 state 的時代：只有 useState，送出的 payload 裡完全沒有它
    expect(code).toMatch(/setStrictMode\(ai\.strictMode\)/);
    expect(code).toMatch(/strictMode,/);
  });

  it('整包覆蓋不會洗掉 faq / handoffMessage（頁面沒有 UI 的兩個欄位要帶回去）', () => {
    const code = withoutComments(src(FILES.page));
    expect(code).toMatch(/faq:\s*base\?\.faq\s*\?\?\s*\[\]/);
    expect(code).toMatch(/handoffMessage:\s*base\?\.handoffMessage\s*\?\?\s*''/);
  });

  it('webhook 分支 ⑤ 在 strictMode 開啟且訊息明顯非詢問時不進 AI', () => {
    const code = withoutComments(src(FILES.lineEvents));
    expect(code).toMatch(/if \(ai\.enabled && !\(ai\.strictMode && isLikelyChitchat\(text\)\)\)/);
  });

  describe('isLikelyChitchat — 判準逐字對應開關的說明文字', () => {
    // 說明文字點名的四類：「純數字（如 1822）、亂碼、單字、符號」
    it.each(['1822', '0912-345-678', '１２３', '!@#$', '👍', '好', '1', 'a', 'ok', 'hi', '   '])(
      '「%s」→ 明顯非詢問，AI 不回',
      (text) => expect(isLikelyChitchat(text)).toBe(true),
    );

    // 說明文字承諾「正常詢問（價格/時間/地址）AI 仍會正常回答」
    it.each([
      '價格', '地址', '幾點開', '你們營業到幾點', '請問剪髮多少錢', '在哪裡',
      'How much is it?', '可以停車嗎',
    ])('「%s」→ 正常詢問，AI 照常回答', (text) =>
      expect(isLikelyChitchat(text)).toBe(false));
  });
});

describe('① 文案不得宣稱一件端點做不到的事', () => {
  /**
   * 未訂閱 AI_ASSISTANT 時 `PUT /api/ai-settings` 依 09 §7.1 回 403 FEAT_001，
   * 所以舊句「此頁設定可以儲存但不會生效」在接上專用端點之後就變成假的已知。
   */
  it('未訂閱提示不再說「可以儲存」', () => {
    expect(aiSettingsPage.feature.lockedTail).not.toMatch(/可以儲存/);
    expect(aiSettingsPage.feature.lockedTail).toMatch(/無法儲存/);
  });
});
