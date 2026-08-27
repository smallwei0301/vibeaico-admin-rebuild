/**
 * 通知類文案不得宣稱「已通知顧客」（14 分冊 §8.10 全站通則，第三輪稽核三筆）
 * -----------------------------------------------------------------------------
 * §8.10 原文：凡是推播／簡訊／email 之後顯示的成功訊息，一律只能宣稱「已送出」，
 * 不得宣稱「已通知」「顧客已收到」。
 *
 * 理由有兩層，兩層都不是措辭潔癖：
 *   1. `notifyBookingStatus` 是 fire-and-forget（06 分冊 §5 明文要求不 await），
 *      失敗只寫 log，所以推播真的失敗時畫面仍顯示成功。
 *   2. 就算改成 await，LINE 回 200 也只代表 LINE 收下了，不代表顧客手機顯示出來。
 *      **沒有任何實作方式能讓「已通知顧客」為真。**
 *
 * 本輪三筆：
 *   ① calendar.ts messages.notified —— 與 issue #27 修好的 bookings 頁完全同型
 *   ② feature-store.ts messages.restoreSideEffectFailed —— 「已通知平台處理」是
 *      捏造的已知：restore/route.ts 當時零 email、零 notify、零平台告警
 *   ③ tour-orders.ts confirm.confirmPayment —— 未來式，但 `/api/tour-orders/**`
 *      整棵路由樹不存在，沒有任何推播實作可言
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { calendarPage } from '@/i18n/zh-TW/pages/calendar';
import { featureStorePage } from '@/i18n/zh-TW/pages/feature-store';
import { tourOrdersPage } from '@/i18n/zh-TW/pages/tour-orders';
import { bookingsPage } from '@/i18n/zh-TW/pages/bookings';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('① 行事曆取消預約的補述（14 §8.10）', () => {
  it('不再宣稱「已通知顧客」，改為只宣稱「已送出」', () => {
    // 修改前：'，已通知顧客'
    expect(calendarPage.messages.notified).not.toContain('已通知顧客');
    expect(calendarPage.messages.notified).toContain('已送出');
  });

  it('句式與 issue #27 修好的 bookings 頁一致（同樣標明哪些情況收不到）', () => {
    const caveat = '（未綁定 LINE 或已關閉此通知者不會收到）';
    expect(bookingsPage.messages.updated).toContain(caveat);
    expect(calendarPage.messages.notified).toContain(caveat);
  });

  it('取消成功的完整訊息＝「預約已取消」＋補述，整串不含「已通知」', () => {
    const full = `${calendarPage.messages.cancelled}${calendarPage.messages.notified}`;
    expect(full.startsWith('預約已取消')).toBe(true);
    expect(full).not.toMatch(/已通知/);
  });

  it('頁面仍是把 cancelled 與 notified 拼起來（接線沒被順手改掉）', () => {
    const page = withoutComments(src('src/app/tenant/calendar/page.tsx'));
    expect(page).toMatch(/`\$\{t\.messages\.cancelled\}\$\{t\.messages\.notified\}`/);
  });
});

describe('② 功能商店還原副作用失敗的文案（捏造的已知）', () => {
  it('不再宣稱「已通知平台處理」', () => {
    // 修改前：'…請到票券管理／商品管理手動恢復（已通知平台處理）'
    expect(featureStorePage.messages.restoreSideEffectFailed).not.toContain('已通知平台');
    expect(featureStorePage.messages.restoreSideEffectFailed).not.toMatch(/已通知/);
  });

  it('仍然告訴店家兩件必然為真的事：手動恢復、恢復不了就聯絡平台', () => {
    const msg = featureStorePage.messages.restoreSideEffectFailed;
    expect(msg).toContain('手動恢復');
    expect(msg).toContain('聯絡平台');
  });

  it('端點在這個分支真的寫一筆平台待處理紀錄（不再只有 console.error）', () => {
    const route = withoutComments(
      src('src/app/api/feature-store/[code]/restore/route.ts'),
    );
    // 失敗分支：先 log，再寫 bug_reports，才回 restoreSideEffectFailed
    expect(route).toMatch(/await recordPlatformIssue\(admin, t\.tenantId, t\.user\.email \?\? '', code, e\)/);
    expect(route).toMatch(/from\('bug_reports'\)\.insert\(\{/);
    // 這筆要看得出是系統自動產生，不是使用者回報
    expect(route).toMatch(/reporter: 'system'/);
    expect(route).toMatch(/category: 'SYSTEM_RESTORE_SIDE_EFFECT'/);
    // 寫入失敗不可讓恢復失敗，也不可往外丟
    expect(route).toMatch(/console\.error\('\[feature-store\] 無法寫入平台待處理紀錄/);
  });
});

describe('③ 旅遊訂單確認收款的確認視窗（未來式，但無推播實作）', () => {
  it('不再宣稱「旅客會收到 LINE 通知」', () => {
    const msg = tourOrdersPage.confirm.confirmPayment('T-0001');
    // 修改前：'確認後訂單成立，旅客會收到 LINE 通知。'
    expect(msg).not.toContain('會收到 LINE 通知');
    expect(msg).not.toMatch(/已通知|會收到/);
  });

  it('如實說明尚未建置，並要店家自行告知旅客', () => {
    const msg = tourOrdersPage.confirm.confirmPayment('T-0001');
    expect(msg).toContain('T-0001');
    expect(msg).toContain('尚未建置');
    expect(msg).toContain('自行告知旅客');
  });

  /**
   * ⚠️ 這一條的前提在 issue #8 改變了，斷言因此**重新釘位**（不是放寬）。
   *
   * 原本的寫法是 `existsSync('src/app/api/tour-orders') === false`，用「整棵
   * 路由樹不存在」當作「不會送通知」的代理。#8 建了 `/api/tour-orders/**`
   * （migration 0026 + 狀態動作端點），代理條件失效——但**文案宣稱的那件事
   * 本身沒有變**：confirm-payment 仍然沒有送出任何通知。
   *
   * 原註解寫「若哪天 issue #8 把推播做出來了，這個測試會紅」。#8 做的是
   * 端點，**不是推播**，所以那個觸發條件其實沒有發生；紅的是代理，不是事實。
   * 因此改成直接量測要保護的東西：**確認收款那支 route 檔裡沒有任何一行
   * 會送通知**。日後真的把推播接上去（旅客端 LINE / Email），這一條會紅，
   * 提醒同時把文案改回「已送出通知」句式（14 分冊 §8.10）。
   */
  it('這句話的前提仍成立：confirm-payment 端點沒有任何通知呼叫', () => {
    const { existsSync } = require('node:fs') as typeof import('node:fs');
    const dir = fileURLToPath(new URL('../../src/app/api/tour-orders', import.meta.url));
    // 路由樹現在存在了（#8）——存在本身不是問題，「有沒有送通知」才是
    expect(existsSync(dir)).toBe(true);

    const route = src('src/app/api/tour-orders/[id]/confirm-payment/route.ts');
    expect(route).not.toMatch(/notify|linePush|pushMessage|sendMail|resend/i);

    // line-notify 的事件種類也沒有任何 tour／departure 事件
    const notify = src('src/server/line-notify.ts');
    expect(notify).not.toMatch(/TOUR_ORDER|DEPARTURE/);
  });
});
