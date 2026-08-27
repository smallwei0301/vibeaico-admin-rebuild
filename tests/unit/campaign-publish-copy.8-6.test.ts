/**
 * 行銷活動「發布」的文案與實際行為必須一致（14 分冊 §8.6 + §11）
 * -----------------------------------------------------------------------------
 * 這一支釘的不是措辭潔癖，是本輪修的那個具體缺陷：
 *
 *   確認視窗（動作**前**的承諾）說「發布後將立即推送 LINE 訊息給所有追蹤者」，
 *   成功訊息（動作**後**的事實）卻說「顧客查得到了」而一個字都不提推播——
 *   同一個動作、兩句互相矛盾的事實主張。使用者無從判斷哪一句是真的，
 *   那比兩句都錯還糟。
 *
 * 根因是 §8.6 這條擁有者裁決被**反向執行**：裁決要的是「補實作、留文案」，
 * 實際做的是「刪文案、不補實作」，而且只刪了成功訊息那一處，同一份字典裡
 * 另外六處仍在宣稱推播。
 *
 * 所以本檔的斷言分三組：
 *   ① 確認視窗承諾的事，端點真的會做（承諾 → 行為）。
 *   ② 成功訊息只在推播真的送出時才宣稱「已發送」（行為 → 宣稱）。
 *   ③ 這一頁**沒有實作**的那些自動發放，文案不得再宣稱（本輪 grep 出來的其餘幾處）。
 *
 * 對照的實作：src/app/api/campaigns/[id]/publish/route.ts
 *            src/app/tenant/campaigns/page.tsx（runPending 的 publish 分支）
 * 端點行為由 tests/integration/api/campaign-publish-push.8-6.test.ts 釘。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { campaignsPage as t } from '@/i18n/zh-TW/pages/campaigns';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const publishRoute = withoutComments(src('src/app/api/campaigns/[id]/publish/route.ts'));
const page = withoutComments(src('src/app/tenant/campaigns/page.tsx'));

/* ========================================================================== */

describe('① 確認視窗承諾的事，端點真的會做', () => {
  it('confirm.publish 承諾「立即推送 LINE 訊息給所有追蹤者」→ 端點真的呼叫 lineMulticast', () => {
    expect(t.confirm.publish).toContain('立即推送 LINE 訊息給所有追蹤者');
    expect(publishRoute).toContain('lineMulticast(');
  });

  it('「所有追蹤者」＝ followed=true 的 line_users（端點解析收件人的方式與文案一致）', () => {
    expect(publishRoute).toContain("from('line_users')");
    expect(publishRoute).toContain("eq('followed', true)");
  });

  it('confirm.publish 承諾「計 1 則本月推播額度」→ 端點真的呼叫 consumePushQuota', () => {
    expect(t.confirm.publish).toContain('推播額度');
    expect(publishRoute).toContain('consumePushQuota(');
  });

  it('confirm.publish 承諾「額度不足時活動仍會發布、推播不會送出」→ 端點確實是這個順序與結果', () => {
    expect(t.confirm.publish).toContain('活動仍會發布，但推播不會送出');
    // 狀態轉換在最前、且沒有任何還原路徑（還原＝發布失敗，與承諾相反）
    expect(publishRoute).toContain("update({ status: 'PUBLISHED' })");
    expect(publishRoute).toContain("pushSkipReason: 'QUOTA_EXCEEDED'");
    // 額度不足那一支不得呼叫 LINE：QUOTA_EXCEEDED 的 return 在 lineMulticast 之前
    expect(publishRoute.indexOf("pushSkipReason: 'QUOTA_EXCEEDED'"))
      .toBeLessThan(publishRoute.indexOf('lineMulticast('));
  });

  it('confirm.publishAuto 承諾「不會在發布當下群發」→ 端點對 isAutoTrigger 直接略過推播', () => {
    expect(t.confirm.publishAuto).toContain('不會在發布當下群發');
    expect(publishRoute).toContain("content.isAutoTrigger === true");
    expect(publishRoute).toContain("pushSkipReason: 'AUTO_TRIGGER'");
  });

  it('confirm.publishAuto 不得再承諾「對應時機自動發送」——沒有任何排程讀 campaigns', () => {
    // 舊文案：「發布後會於對應時機（…）自動發送」
    expect(t.confirm.publishAuto).not.toContain('自動發送，不會在發布當下群發');
    expect(t.confirm.publishAuto).toContain('尚未接上');
  });
});

describe('② 成功訊息只在推播真的送出時才宣稱「已發送」', () => {
  it('published 復原了 §8.6 指名保留的原句，且帶出真的送給幾位', () => {
    // §8.6 原文：文案「活動已發布，LINE 推播已發送」保留
    expect(t.messages.published(2)).toContain('活動已發布，LINE 推播已發送');
    expect(t.messages.published(2)).toContain('2 位追蹤者');
  });

  it('「已發送」這句話只出現在 published，其餘四種沒送出的情形都不含它', () => {
    for (const s of [
      t.messages.publishedNoPush,
      t.messages.noPushNoRecipients,
      t.messages.noPushQuota,
      t.messages.noPushLineNotConfigured,
      t.messages.noPushNoMessage,
      t.messages.publishedAuto,
    ]) {
      expect(s).not.toContain('推播已發送');
    }
  });

  it('沒送出的四句都明講「沒有送出推播」，不是含糊帶過', () => {
    expect(t.messages.noPushNoRecipients).toContain('沒有送出推播');
    expect(t.messages.noPushQuota).toContain('沒有送出');
    expect(t.messages.noPushLineNotConfigured).toContain('沒有送出推播');
    expect(t.messages.noPushNoMessage).toContain('沒有送出推播');
  });

  it('publishedPushFailed 同時報告「已發布」與「推播失敗」，並帶 LINE 的原文', () => {
    const s = t.messages.publishedPushFailed('LINE API 錯誤（500）');
    expect(s).toContain('活動已發布');
    expect(s).toContain('LINE 推播送出失敗');
    expect(s).toContain('LINE API 錯誤（500）');
  });

  it('頁面依端點回的 pushed 分流，不是一律顯示 published（假成功的來源）', () => {
    expect(page).toContain('const r = await publishCampaign(campaign.id);');
    expect(page).toContain('if (r.pushed) {');
    expect(page).toContain('t.messages.published(r.sentCount)');
    expect(page).toContain("r.pushSkipReason === 'LINE_ERROR'");
    // 推播失敗那一句要用 danger，不可混進綠色成功訊息
    expect(page).toContain("t.messages.publishedPushFailed(r.pushErrorMessage ?? ''), 'danger'");
  });

  it('端點回的六種 pushSkipReason，頁面每一種都有對應的話可說', () => {
    const reasons = [...publishRoute.matchAll(/pushSkipReason: '([A-Z_]+)'/g)]
      .map((m) => m[1]);
    expect(new Set(reasons)).toEqual(new Set([
      'AUTO_TRIGGER', 'NO_MESSAGE', 'NO_RECIPIENTS',
      'LINE_NOT_CONFIGURED', 'QUOTA_EXCEEDED', 'LINE_ERROR',
    ]));
    // AUTO_TRIGGER → publishedAuto、LINE_ERROR → publishedPushFailed，其餘四種查表
    for (const r of ['NO_MESSAGE', 'NO_RECIPIENTS', 'LINE_NOT_CONFIGURED', 'QUOTA_EXCEEDED'])
      expect(page).toContain(`${r}:`);
  });
});

describe('③ 沒有實作的自動發放，文案不得再宣稱（本輪 grep 出的其餘各處）', () => {
  it('說明卡不再說「自動發放獎勵」——發布不發券也不給點', () => {
    expect(t.intro.leadTail).not.toContain('並自動發放獎勵');
    expect(t.intro.leadTail).toContain('還沒有接上自動發放');
    // 但推播那半句現在是真的，必須留著
    expect(t.intro.leadTail).toContain('推播 LINE 訊息給所有追蹤者');
  });

  it('關聯票券的說明不再說「發布時自動發放票券給追蹤者」', () => {
    expect(t.form.couponHelp).not.toContain('自動發放票券');
    expect(t.form.couponHelp).toContain('不會自動發券');
  });

  it('贈送點數的說明不再說「排程觸發時自動贈送點數」', () => {
    expect(t.form.bonusPointsHelp).not.toContain('自動贈送點數');
    expect(t.form.bonusPointsHelp).toContain('尚未接上');
  });

  it('「啟用排程自動觸發」的說明不再說「系統會依排程自動發送獎勵」', () => {
    expect(t.form.isAutoTriggerHelp).not.toContain('系統會依排程自動發送獎勵');
    expect(t.form.isAutoTriggerHelp).toContain('尚未接上');
  });

  it('活動卡片的自動觸發提示不再說「自動發送票券/點數」', () => {
    expect(t.autoTriggerHint.BIRTHDAY).not.toContain('自動發送票券');
    expect(t.autoTriggerHint.RECALL).not.toContain('自動發送票券');
    expect(t.autoTriggerHint.BIRTHDAY).toContain('尚未接上');
    expect(t.autoTriggerHint.RECALL).toContain('尚未接上');
  });

  it('前提檢查的結語不再說「補齊條件後就會開始自動發送」（會發送的是 notify 那則文字推播）', () => {
    expect(t.prereq.tail).not.toContain('補齊上面的條件後就會開始自動發送');
    expect(t.prereq.tail).toContain('不是這個活動綁定的票券與點數');
  });

  it('推播訊息的 help 補上「自動觸發活動不在發布當下群發」，與端點分支一致', () => {
    expect(t.form.pushMessageHelp).toContain('不會在發布當下群發');
  });
});
