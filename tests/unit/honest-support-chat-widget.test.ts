/**
 * 「假成功誠實化」不可回歸測試（GitHub issue #15 / 修復-7 第 ④ 項）
 * -----------------------------------------------------------------------------
 * 對象：全站右下角常駐的 AI 客服 widget（src/components/layout/SupportChatWidget.tsx）。
 *
 * 修改前：`send()` 只把使用者輸入 push 進本地 `messages` 陣列，**零 API 呼叫**，
 * 永遠不會有回覆；面板一開啟還會先講一句「我可以幫您查 LINE 狀態、推播額度、
 * 最近異常日誌…」的能力宣稱，而畫面上沒有任何「尚未建置」字樣。原站的四支端點
 * （/api/support-chat/{new-session,status,history,message}，見
 * docs/specs/reports.json 的 jsApiCalls）在本專案都還不存在。
 *
 * 依 CLAUDE.md「Never fabricate a known」與 00 分冊鐵則 12，本輪不接後端，
 * 只移除欺騙：輸入區停用、面板內常駐說明尚未建置且訊息不會送出。
 *
 * ⚠️ 為什麼是「讀原始碼」而不是 render 測試：本專案沒有安裝
 *    @testing-library/react，vitest 單元測試跑在 node 環境
 *    （vitest.config.mts: environment: 'node'），無法掛載 React 元件。
 *    這裡測的是「原始碼中不存在任何會謊報成功的路徑」——對不變條件的靜態證明，
 *    與 tests/unit/honest-not-built-*.test.ts 同一層，刻意分檔避免衝突。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { common } from '@/i18n/zh-TW/common';

const WIDGET = 'src/components/layout/SupportChatWidget.tsx';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

/** 去掉註解，避免「解釋為什麼不能這樣寫」的註解被誤判成違規程式碼 */
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('SupportChatWidget：送出不會顯示成功（issue #15 第 ④ 項）', () => {
  const code = withoutComments(src(WIDGET));

  it('沒有任何「把輸入塞進訊息陣列」的假送出路徑', () => {
    // 修改前的樣子：const send = () => { … setMessages((m) => [...m, { role: 'user', … }]) }
    expect(code).not.toMatch(/setMessages/);
    expect(code).not.toMatch(/const\s+send\s*=/);
    expect(code).not.toMatch(/role:\s*'user'/);
  });

  it('沒有 toast／成功字樣，也沒有假的助理回覆', () => {
    expect(code).not.toMatch(/useToast|toast\.show/);
    expect(code).not.toMatch(/已送出|已傳送|送出成功/);
    expect(code).not.toMatch(/role:\s*'assistant'/);
  });

  it('輸入框與送出鍵都是停用狀態（按不下去就不可能謊報已送出）', () => {
    const composer = code.slice(code.indexOf('<Input'));
    expect(composer).toMatch(/<Input[\s\S]*?disabled[\s\S]*?\/>/);
    expect(composer).toMatch(/<Button[^>]*disabled/);
  });

  it('面板內有「尚未建置」的常駐說明，且說明取自 i18n 字典（無中文字面量）', () => {
    expect(code).toMatch(/common\.supportChat\.notBuiltTitle/);
    expect(code).toMatch(/common\.supportChat\.notBuiltBody/);
    expect(code).toMatch(/<Alert[^>]*tone="warning"/);
    // 元件本身不得出現中文字面量（鐵則：零硬編碼文案）
    expect(code).not.toMatch(/['"`][^'"`]*[一-鿿][^'"`]*['"`]/);
  });

  it('字典文案本身明說後端尚未建置、訊息不會送出也不會有回覆', () => {
    expect(common.supportChat.notBuiltTitle).toContain('尚未');
    expect(common.supportChat.notBuiltBody).toContain('尚未建置');
    expect(common.supportChat.notBuiltBody).toContain('不會');
    expect(common.supportChat.disabledPlaceholder).toContain('尚未建置');
  });

  it('先前那句宣稱「可以幫您查 LINE 狀態／推播額度」的假招呼已移除', () => {
    expect(Object.keys(common.supportChat)).not.toContain('greeting');
    expect(JSON.stringify(common.supportChat)).not.toContain('推播額度');
  });
});
