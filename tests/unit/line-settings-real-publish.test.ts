/**
 * 「LINE 設定頁的 Rich Menu 建立必須真的打到 LINE」不可回歸測試
 * -----------------------------------------------------------------------------
 * 這一條是第三輪才抓到的活體假成功——前兩輪稽核都漏了，因為它藏在一個**有真實
 * 端點呼叫**的函式裡：舊實作確實 `await saveLineSettings(...)`（真的寫了 DB），
 * 所以掃「本地 setTimeout 假成功」的規則抓不到它。但它寫進去的只是主題／底圖等
 * 外觀偏好，LINE 端一次都沒被呼叫過，畫面卻宣告「顧客現在可以看到快捷選單了」。
 *
 * 對照 CLAUDE.md：「成功 toast 是一項事實主張」。真正會發布的端點
 * `POST /api/settings/line/rich-menu/create` 一直存在（選單設計頁在用，且對
 * Midao 正式頻道實測過五項全綠），這一頁從來沒接上去。
 *
 * 稽核方法的教訓（一併記在 14 分冊 §5.2）：「有呼叫 service」不等於「呼叫對的
 * service」。下一輪掃描要問的是「這個成功訊息宣稱的事，是哪一支端點做的」。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const page = read('src/app/tenant/line-settings/page.tsx');
const dictRaw = read('src/i18n/zh-TW/pages/line-settings.ts');
/** 註解裡會為了說明「原本錯在哪」而引用舊字串，斷言必須只看程式碼本身。 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const dict = stripComments(dictRaw);
const service = stripComments(read('src/services/settings.ts'));

describe('LINE 設定頁：Rich Menu 建立接到真的發布端點', () => {
  it('頁面有匯入 services 的 createRichMenu（真的會打 /rich-menu/create）', () => {
    expect(page).toMatch(/createRichMenu as publishRichMenu[\s\S]{0,200}from '@\/services\/settings'/);
  });

  it('建立流程真的呼叫發布端點，而不是只存偏好就宣告成功', () => {
    const fn = page.slice(page.indexOf('const createRichMenu = async'));
    const body = fn.slice(0, fn.indexOf('const runTest'));
    expect(body).toContain('await publishRichMenu(');
    // 先存偏好、再發布：create 端點會回頭讀 tenant_settings 的 richMenuBgImageUrl
    expect(body.indexOf('await saveLineSettings(')).toBeLessThan(body.indexOf('await publishRichMenu('));
    // 成功旗標與成功 toast 都必須排在真正的發布呼叫之後
    expect(body.indexOf('await publishRichMenu(')).toBeLessThan(body.indexOf('setRichMenuPublished(true)'));
    expect(body.indexOf('await publishRichMenu(')).toBeLessThan(body.indexOf('toast.show(richMenuBgImageUrl'));
  });

  it('文案不再宣稱底圖上會疊加描邊文字（端點是原圖直傳，沒有任何合成）', () => {
    expect(dict).not.toContain('描邊文字');
    expect(dict).toContain('圖上不會疊加文字');
    // 疊圖分支的舊字串整個移除，避免日後被誤用回來
    expect(dict).not.toContain('createdNoOverlay');
    expect(page).not.toContain('createdNoOverlay');
    // 舊的 noOverlayHelp 反過來教使用者「取消勾選就會疊字」，也是同一個假宣稱
    expect(dict).not.toContain('取消勾選可讓系統在背景上疊加');
  });

  it('疊圖尚未建置，所以疊圖開關與文字顏色一律停用並附說明（不是刪除，見 #19）', () => {
    const block = page.slice(page.indexOf('richMenuNoOverlay}'), page.indexOf('loadingText={t.richMenu.creating}'));
    // 開關與五個顏色鈕都必須 disabled，且用 title 說明為什麼
    expect((block.match(/disabled/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((block.match(/t\.richMenu\.overlayNotBuiltHint/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // 常駐告示（不是一閃即逝的 toast）
    expect(block).toContain('t.richMenu.overlayNotBuilt}');
    expect(dict).toContain('overlayNotBuilt:');
    // 控制項本身保留（補齊優先於刪除）
    expect(page).toContain('TEXT_COLOR_PRESETS.map');
  });
});

describe('示範店家不得偽造 LINE 的連動狀態', () => {
  it('getTenantSettings 的示範分支不再硬塞 Channel ID／Token', () => {
    expect(service).not.toContain("'2005459361'");
    expect(service).not.toMatch(/s\.line\.channelSecret\s*=/);
    expect(service).not.toMatch(/s\.line\.channelAccessToken\s*=/);
  });

  it('示範店家改依當下 MOCK_MODE 解析，不是模組層凍住的 MOCK_TENANTS[0]', () => {
    // 模組層不得再有 `const current = MOCK_TENANTS[0]`
    expect(service).not.toMatch(/^const current = MOCK_TENANTS\[0\];$/m);
    expect(service).toContain('MOCK_TENANTS.find((t) => t.businessType === MOCK_MODE)');
    // 解析必須發生在 callback 內（函式形式），不是模組求值時
    expect(service).toMatch(/const demoTenant = \(\) =>/);
  });

  it('verifyLineSetup 的示範分支五項全 WARN，不編造綠燈也不編造紅字', () => {
    const fn = service.slice(service.indexOf('export const verifyLineSetup'));
    const body = fn.slice(0, fn.indexOf('export const getSetupStatus'));
    expect(body).not.toContain('Channel Access Token 有效');
    expect(body).not.toContain('自動回應訊息');
    expect(body).not.toMatch(/本月推播額度尚有 \d+ 則/);
    expect(body).toContain("severity: 'WARN'");
    expect(body).not.toMatch(/pass: true/);
  });

  it('測試連線與 Rich Menu 發布在示範模式下都不假裝成功', () => {
    expect(service).not.toContain("message: '連線正常'");
    expect(service).not.toContain("richMenuId: 'mock-rich-menu-id'");
    expect(service).toContain('demoLineUnavailable');
  });
});
