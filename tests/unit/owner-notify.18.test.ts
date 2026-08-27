/**
 * 老闆通知（owner-notify）— 推播文案的純函式測試 ＋ 儀表板接線的靜態鏈路
 * -----------------------------------------------------------------------------
 * issue #18 / 補齊-3。真的打端點、驗 mock LINE 收到幾則的部分在
 * `tests/integration/api/owner-notify.18.test.ts`；本檔守的是：
 *   ① 三種推播的內容（老闆看到的是不是他需要的資訊）
 *   ② 儀表板 → `src/services/settings.ts` → 端點 的接線真的存在
 *   ③ 那些規格逐字文案沒有被改掉、也沒有出現「說謊的宣稱」
 *
 * ⚠️ 為什麼是「讀原始碼」：本專案沒裝 @testing-library/react，單元測試跑 node
 *    環境無法掛載元件——同 notify-wiring.27 / honest-not-built-interactions
 *    的既有作法，這裡證明的是「原始碼中存在該接線」。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  buildOwnerNewBookingText, buildOwnerPointsLowText, buildOwnerSubscriptionExpiryText,
} from '@/server/owner-notify';
import { dashboardPage } from '@/i18n/zh-TW/pages/dashboard';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const FILES = {
  page: 'src/app/tenant/dashboard/page.tsx',
  service: 'src/services/settings.ts',
  server: 'src/server/owner-notify.ts',
  bookingsRoute: 'src/app/api/bookings/route.ts',
  cron: 'src/app/api/cron/owner-reminders/route.ts',
} as const;

/* ------------------------------------------------------------------ ① 文案 */

describe('推播文案（純函式）', () => {
  it('新預約通知含店名、單號、顧客、服務與時間', () => {
    const text = buildOwnerNewBookingText({
      shop: '測試沙龍', bookingNo: 'B2608260001', customer: '王小明',
      service: '精緻剪髮', time: '2026/08/27 14:00',
    });
    expect(text).toContain('【測試沙龍】收到新預約');
    expect(text).toContain('訂單編號：B2608260001');
    expect(text).toContain('顧客：王小明');
    expect(text).toContain('服務項目：精緻剪髮');
    expect(text).toContain('預約時間：2026/08/27 14:00');
  });

  it('訂閱到期提醒含功能名稱與台北時間的到期時刻', () => {
    const text = buildOwnerSubscriptionExpiryText({
      shop: '測試沙龍', featureName: '票券管理',
      expiresAt: '2026-09-01T02:00:00.000Z',      // 台北 10:00
    });
    expect(text).toContain('訂閱即將到期');
    expect(text).toContain('功能：票券管理');
    expect(text).toContain('2026/09/01 10:00');
  });

  it('儲值提醒同時說出「目前多少」與「需要多少」（只說一邊看不出差多少）', () => {
    const text = buildOwnerPointsLowText({ shop: '測試沙龍', balance: 12, needed: 49 });
    expect(text).toContain('點數不足');
    expect(text).toContain('目前點數：12 點');
    expect(text).toContain('即將到期的訂閱需要：49 點');
  });
});

/* -------------------------------------------------------------- ② 接線鏈路 */

describe('儀表板 → services → 端點 的接線（DoD 10 靜態鏈路）', () => {
  const page = withoutComments(src(FILES.page));
  const service = withoutComments(src(FILES.service));

  it('頁面從 @/services/settings 匯入四個動作，沒有自己 fetch', () => {
    expect(page).toMatch(
      /import\s*\{[\s\S]*?addOwnerNotifyRecipient[\s\S]*?bindOwnerNotify[\s\S]*?clearOwnerNotify[\s\S]*?getOwnerNotify[\s\S]*?\}\s*from\s*'@\/services\/settings'/,
    );
    expect(page).toMatch(/removeOwnerNotifyRecipient/);
    expect(page).toMatch(/listOwnerNotifyLineUsers/);
    // 「Pages never fetch」：頁面不得自己打 API
    expect(page).not.toMatch(/fetch\(\s*['"`]\/api\//);
  });

  it('四個 handler 都在端點回來之後才顯示成功訊息（不是先 toast 再說）', () => {
    // runOwnerNotify：await action() → await reloadOwnerNotify() → toast.show(...)
    const order = page.indexOf('await action();');
    const reload = page.indexOf('await reloadOwnerNotify();', order);
    const toast = page.indexOf('toast.show(successMessage)', reload);
    expect(order).toBeGreaterThan(-1);
    expect(reload).toBeGreaterThan(order);
    expect(toast).toBeGreaterThan(reload);
  });

  it('services 的六支各自打對端點（含 method）', () => {
    expect(service).toMatch(/request<OwnerNotifyState>\('\/api\/settings\/line\/owner-notify'\)/);
    expect(service).toMatch(/'\/api\/settings\/line\/owner-notify\/line-users'/);
    expect(service).toMatch(/'\/api\/settings\/line\/owner-notify\/bind',\s*\{[\s\S]*?method:\s*'POST'/);
    expect(service).toMatch(
      /`\/api\/settings\/line\/owner-notify\/recipients\/\$\{encodeURIComponent\(lineUserId\)\}`,\s*\n?\s*\{\s*method:\s*'POST'/,
    );
    expect(service).toMatch(
      /`\/api\/settings\/line\/owner-notify\/recipients\/\$\{encodeURIComponent\(lineUserId\)\}`,\s*\n?\s*\{\s*method:\s*'DELETE'/,
    );
    expect(service).toMatch(/'\/api\/settings\/line\/owner-notify',\s*\{\s*method:\s*'DELETE'\s*\}/);
  });

  it('示範分支不得編造一組已綁定的接收者（示範店家沒有 LINE 官方帳號）', () => {
    expect(service).toMatch(/status:\s*'NOT_CONFIGURED',\s*recipients:\s*\[\]/);
  });

  it('POST /api/bookings 以 fire-and-forget 觸發老闆通知（不 await）', () => {
    const code = withoutComments(src(FILES.bookingsRoute));
    expect(code).toMatch(
      /import\s*\{[^}]*notifyOwnerNewBooking[^}]*\}\s*from\s*'@\/server\/owner-notify'/,
    );
    expect(code).toMatch(/void\s+notifyOwnerNewBooking\(/);
    expect(code).not.toMatch(/await\s+notifyOwnerNewBooking/);
  });
});

/* ------------------------------------------------------ ③ 規格逐字與誠實性 */

describe('文案與行為的誠實性', () => {
  const server = withoutComments(src(FILES.server));
  const cron = withoutComments(src(FILES.cron));

  it('額度扣除量＝接收者人數（不是寫死 1），否則畫面那句「消耗 n 則」就是假的', () => {
    expect(server).toMatch(/consumePushQuota\(tenantId,\s*recipients\.length\)/);
    expect(server).not.toMatch(/consumePushQuota\(tenantId,\s*1\)/);
  });

  it('訂閱到期／儲值提醒只送給主要那一位', () => {
    expect(server).toMatch(/recipients\.find\(\(r\)\s*=>\s*r\.isPrimary\)/);
    expect(server).toMatch(/pushToRecipients\(tenantId,\s*\[primary\],\s*text\)/);
  });

  it('狀態判定真的問過 LINE，而不是「有 token 就說連得上」', () => {
    expect(server).toMatch(/lineGetRaw\(token,\s*'\/v2\/bot\/info'\)/);
    expect(server).toMatch(/res\.ok\s*\?\s*'ENABLED'\s*:\s*'DISCONNECTED'/);
  });

  it('cron 只有在推播真的送出去之後才寫去重紀錄', () => {
    // delivered 為 false（沒送出）時 continue，不寫 log —— 否則這次沒送到、下次也不會送
    expect(cron).toMatch(/if\s*\(!delivered\)\s*continue;/);
  });

  it('i18n 保留規格逐字文案（三態、n 位、主要提醒、三種移除確認）', () => {
    const on = dashboardPage.ownerNotify;
    expect(on.status.enabled).toBe('LINE 通知已開啟');
    expect(on.status.disconnected).toBe('LINE 通知已綁定（連線中斷）');
    expect(on.status.notConfigured).toBe('未設定 LINE');
    expect(on.fanout(3)).toBe('每次通知會同時發給 3 位（消耗 3 則推播額度）');
    expect(on.primaryHint).toBe('「主要」接收者另外會收到訂閱到期／儲值提醒（僅發給主要一位）。');
    expect(on.atLimit(3)).toBe('已達上限 3 位');
    expect(on.noBindableUsers).toBe('尚無可加入的 LINE 好友');
    expect(on.unnamed).toBe('(LINE 用戶)');
    expect(on.confirm.bindSelf).toBe('確認是您本人嗎？');
    expect(on.confirm.add).toBe('確認將此人加入通知名單？');
    expect(on.confirm.removeOther).toBe('確定將此人移出通知名單？其他接收者不受影響。');
    expect(on.confirm.removeLast)
      .toBe('這是最後一位接收者，移除後將不再收到 LINE 即時通知。確定移除？');
    expect(on.confirm.removePrimary('店長'))
      .toBe('此人是「主要」接收者。移除後「店長」將成為主要接收者（訂閱到期／儲值提醒改發給他）。確定移除？');
    expect(on.confirm.unbindAll(3))
      .toBe('確定解除全部 3 位接收者的綁定？之後不會再收到 LINE 即時通知。');
    expect(on.toast.bound).toBe('綁定成功！之後有新預約會即時通知綁定的 LINE。');
    expect(on.toast.removed).toBe('已移除接收者');
    expect(on.toast.unbound).toBe('已解除綁定');
  });

  it('名單為空時畫面不得說「已開啟」——有一個獨立的狀態說實話', () => {
    expect(dashboardPage.ownerNotify.status.noRecipients)
      .not.toBe(dashboardPage.ownerNotify.status.enabled);
    expect(dashboardPage.ownerNotify.noRecipientsHint).toContain('不會發出任何 LINE 通知');
  });
});

/* -------------------------------------------- ④ 作廢設計不得留下殘留 */

describe('原 issue 的「綁定碼」設計已作廢，不得有殘留', () => {
  it('owner-notify 相關原始碼沒有 bind-code / bindCode / 綁定碼', () => {
    for (const f of [FILES.page, FILES.service, FILES.server, FILES.cron]) {
      const code = src(f);
      expect(code).not.toMatch(/bind-code|bindCode/);
      expect(code.replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain('綁定碼');
    }
  });
});
