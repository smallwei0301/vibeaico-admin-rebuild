import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { campaignsPage as t } from '../../src/i18n/zh-TW/pages/campaigns';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const page = read('src/app/tenant/campaigns/page.tsx');
const publishRoute = read('src/app/api/campaigns/[id]/publish/route.ts');

/**
 * issue #176：活動頁與「通知設定」頁對生日祝福／顧客喚回有兩套 UI，但只有
 * 通知設定那一套會執行。本組測試鎖住「畫面說了實話」這件事。
 */
describe('issue #176: 活動頁不得讓店家以為這裡的設定會生效', () => {
  it('生日／喚回一律顯示「這裡的訊息不會被發送」，不是只在缺前提時才顯示', () => {
    expect(page).toContain("const drivenElsewhere = type === 'BIRTHDAY' || type === 'RECALL';");
    expect(page).toContain('{drivenElsewhere && prereq ? (');
    expect(page).toContain('t.truthNotice.drivenElsewhere(prereq.switchName)');
  });

  it('那句話指向真正生效的頁面（通知設定），不是只說「不會生效」就算了', () => {
    expect(page).toContain('href="/tenant/settings"');
    expect(t.truthNotice.goSettingsCta).toContain('通知設定');
    expect(t.truthNotice.drivenElsewhere('自動推播生日祝福')).toContain('通知設定');
  });

  it('沒有後端觸發點的類型顯示「不會自動執行」，且說明唯一真的會發生的事', () => {
    expect(page).toContain('const notImplemented = !drivenElsewhere;');
    expect(page).toContain('t.truthNotice.notImplemented');
    // 唯一真的會執行的是 LINE 關鍵字回覆（src/server/line-events.ts）
    expect(t.truthNotice.notImplemented).toContain('活動關鍵字');
  });

  it('發券／送點數欄位標明目前不會自動發放', () => {
    expect(page).toContain('t.truthNotice.rewardsInert');
    expect(t.truthNotice.rewardsInert).toContain('不會自動發放');
  });

  it('移除了「補齊條件後就會開始自動發送」這句不實承諾', () => {
    expect(t.prereq.tail).not.toContain('就會開始自動發送');
    expect(page).not.toContain('補齊上面的條件後就會開始自動發送');
  });

  /**
   * 「復原而非取消」（DELIVERY-CHAIN §5）：這一輪只加誠實標示，
   * **不准順手把欄位刪掉**——它們是未來要實作的產品意圖。
   */
  it('欄位一個都沒有被移除', () => {
    for (const field of [
      'campaignCouponId', 'campaignBonusPoints', 'campaignThreshold',
      'campaignRecallDays', 'campaignAutoTrigger',
    ]) {
      expect(page).toContain(field);
    }
  });

  it('沒有硬編中文字串進頁面——文案全部走 i18n', () => {
    // 新增的三段文字都必須以 t.truthNotice.* 引用
    expect(page).not.toContain('這裡的訊息內容不會被發送出去');
    expect(page).not.toContain('這個活動類型目前不會自動執行');
  });

  it('publish 端點確實只改狀態（本 issue 描述的現況未被本輪誤改）', () => {
    expect(publishRoute).toContain("status: 'PUBLISHED'");
    for (const verb of ['push', 'sendLine', 'consumePushQuota']) {
      expect(publishRoute).not.toContain(verb);
    }
  });
});
