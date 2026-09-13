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

  /**
   * ⚠️ **前提改變，不是把斷言放寬。**
   *
   * 這一條原本釘住 `const notImplemented = !drivenElsewhere;`——當時那是對的：
   * 除了生日／喚回，其餘類型後端**完全沒有觸發點**。issue #176 第 2、3 項落地後，
   * `NEW_CUSTOMER` / `SPENDING_THRESHOLD` / `LIMITED_TIME` 三型真的會發放票券與
   * 點數（`src/server/campaign-rewards.ts` ＋ migration `0091`，執行證據在
   * `tests/integration/api/campaign-rewards.176.test.ts`）。
   *
   * 繼續對那三型顯示「不會自動執行」，就從「誠實標示」變成「錯誤標示」——
   * 店家會以為設了也沒用而不去用。所以這裡改成**逐型斷言**：只剩真的沒有觸發點的
   * 類型顯示那則提示，會發的類型顯示的是說清楚何時發的另一則。斷言變多不是變少。
   */
  it('只有真的沒有觸發點的類型才顯示「不會自動執行」', () => {
    expect(page).toContain('const notImplemented = !drivenElsewhere && !rewardActive;');
    expect(page).toContain('t.truthNotice.notImplemented');
    // 唯一真的會執行的是 LINE 關鍵字回覆（src/server/line-events.ts）
    expect(t.truthNotice.notImplemented).toContain('活動關鍵字');
    // REFERRAL（推薦活動）是 issue #24 的整塊功能，本輪沒做，提示必須留著
    expect(page).toContain("const REWARD_ACTIVE_TYPES: CampaignType[] = ['NEW_CUSTOMER', 'SPENDING_THRESHOLD', 'LIMITED_TIME']");
  });

  it('會發放的三型改說「何時發」，而且逐型都有自己的說明', () => {
    expect(page).toContain('t.truthNotice.rewardActive[type]');
    for (const type of ['NEW_CUSTOMER', 'SPENDING_THRESHOLD', 'LIMITED_TIME']) {
      const text = t.truthNotice.rewardActive[type];
      expect(text, `${type} 缺少說明`).toBeTruthy();
      // 空泛的「發布後就會生效」不算——必須說出觸發時機
      expect(text.length).toBeGreaterThan(20);
    }
    expect(t.truthNotice.rewardActive.NEW_CUSTOMER).toContain('第一筆');
    expect(t.truthNotice.rewardActive.SPENDING_THRESHOLD).toContain('門檻');
    expect(t.truthNotice.rewardActive.LIMITED_TIME).toContain('關鍵字');
  });

  it('冪等是產品決定，必須寫在畫面上而不是只寫在程式註解裡', () => {
    expect(page).toContain('t.truthNotice.rewardOncePerCustomer');
    expect(t.truthNotice.rewardOncePerCustomer).toContain('只會發放一次');
  });

  it('沒有觸發點的類型，發券／送點數欄位仍標明不會自動發放', () => {
    expect(page).toContain('t.truthNotice.rewardsInert');
    expect(t.truthNotice.rewardsInert).toContain('不會自動發放');
  });

  /**
   * 本輪**沒有**做推播。三型的 notImplemented 提示消失之後，表單上唯一提到推播的
   * 只剩 `form.pushMessageHelp`（「發布時會透過 LINE 推播通知給所有追蹤者」），
   * 而那句話是錯的——`publish` route 從頭到尾只有一次 status update。
   * 沒有這則獨立更正，本輪反而會讓一個既有的假承諾變得更顯眼。
   */
  it('推播訊息有獨立的「不會送出」更正', () => {
    expect(page).toContain('t.truthNotice.pushInert');
    expect(t.truthNotice.pushInert).toContain('不會');
    expect(t.truthNotice.pushInert).toContain('推播');
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
