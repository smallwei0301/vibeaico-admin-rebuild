// POST /api/campaigns/:id/publish — DRAFT→PUBLISHED（04 分冊 §B-5，狀態機同票券）
// ＋ **真的把活動推播給追蹤者**（14 分冊 §8.6 擁有者裁決）。
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { consumePushQuota, getLineCredentials, lineMulticast } from '@/server/line';

/**
 * 為什麼這裡會打 LINE —— 14 分冊 §8.6（**擁有者裁決**，原文）：
 *
 *   > 文案「活動已發布，LINE 推播已發送」保留，`POST /api/campaigns/:id/publish`
 *   > 要補上實際的推播與額度扣減。缺的是實作而不是文案。
 *
 * 這一條先前被**反向執行**了（issue #7 乙）：文案被刪掉並註明「禁止復原」，
 * 端點仍然只有一句 `.update({ status: 'PUBLISHED' })`。本檔補上缺的實作。
 *
 * ⚠️ **形狀刻意抄 `src/app/api/marketing/pushes/[id]/send/route.ts`**：條件式
 * update 佔位防連點 → 解析收件人 → `consumePushQuota(tenantId, 人數)` →
 * `lineMulticast` 每 500 人一批。同一件事寫兩種寫法，短期看起來一樣、長期一定分岔，
 * 而分岔那天沒有任何測試會紅（本專案反覆抓到的缺陷家族）。兩處要一起改。
 *
 * ── 推給誰（規格寫出來的，不是我們猜的）───────────────────────────
 * `campaigns` 表**沒有 audience 欄位**（0005 migration：id/tenant_id/name/keyword/
 * content/start_at/end_at/status/created_at），`docs/specs/campaigns.json` 全文
 * 也**沒有任何**「受眾／對象／audience」概念（統計：audience 0 次、對象 0 次）。
 * 原站唯一講收件人的地方一律寫「**所有追蹤者**」（說明卡、推播訊息 placeholder
 * 與 help、確認視窗四處）。所以收件人＝本店 `line_users` 中 `followed=true` 的全部，
 * 等同 marketing 的 ALL 受眾。不推給 followed=false（已封鎖）者，與 marketing 同規則。
 *
 * ── 「自動觸發」活動不在發布當下群發 ───────────────────────────────
 * 原站的確認視窗自己就分兩句（docs/specs/campaigns.json）：一般活動是
 * 「發布後將立即推送 LINE 訊息給所有追蹤者」，自動觸發活動是
 * 「**不會在發布當下群發**」。所以 `content.isAutoTrigger === true` → 不推播。
 * （那類活動承諾的「對應時機自動發送」仍然**沒有任何實作**：生日祝賀與顧客喚回
 * 兩支 cron 讀的是 `tenant_settings.notify`，從頭到尾不看 campaigns 表。
 * 文案已照實說明，見 src/i18n/zh-TW/pages/campaigns.ts。）
 *
 * ── 額度不足時：**活動照發，推播不送**（設計決定，理由寫在這裡）──────
 * marketing 的 send 在額度不足時回 409 且還原狀態——那是對的，因為那一頁的動作
 * 「就是」發推播，推不出去就等於什麼都沒做。**發布活動不一樣**：
 *
 *   1. 「發布」本身有獨立且不計費的效果——`src/server/line-events.ts` 只把
 *      `status='PUBLISHED'` 的活動回給顧客（關鍵字命中與內建「活動」指令）。
 *      推播額度是每月會用完的計量資源，活動可見度不是。
 *   2. 綁在一起的代價不對稱：額度用完的店家會變成**整個月一個活動都發不出去**，
 *      而它想要的可見度其實一分錢都不用花。
 *   3. 反過來也走得通——沒推到的活動，店家隨時可以到「行銷推播」手動補送；
 *      沒發成的活動則是卡死。
 *
 * 代價是「發布成功」與「推播送出」變成兩件會分開發生的事，所以端點**回報實際結果**
 * （`pushed` / `sentCount` / `pushSkipReason`），頁面依它顯示不同的成功訊息——
 * 畫面不准在沒送出的時候說「已發送」（CLAUDE.md：成功 toast 是一項事實主張）。
 *
 * ── 沒有中間態 ─────────────────────────────────────────────────────
 * - 「發布失敗但額度已扣」：不可能。狀態的條件式 update 是**第一步**且成功後
 *   永不還原；扣額度全部發生在那之後。
 * - 「額度扣了但沒送出」：憑證在扣額度**之前**取（沒設定 LINE 就根本不扣）。
 *   剩下的唯一情形是 LINE 平台在扣完之後回錯——與 marketing 相同**不退額度**：
 *   多批次時前面幾批可能已經送達，退了就會讓店家超額送出。這一次真的送到幾人
 *   由 `sentCount` 照實回報，畫面也照實說。
 * - 重複發布：條件式 update 帶 `.eq('status','DRAFT')`，第二次點不到列 → 409，
 *   不會再扣一次額度、也不會再推一次。
 *
 * ── 不送圖片 ───────────────────────────────────────────────────────
 * `content.imageUrl` 目前**沒有任何寫入路徑**（活動圖片上傳尚未接上，見
 * campaigns.ts 的 imageUploadNotWired），而 LINE 的 image message 還要處理
 * previewImageUrl 的 1 MB 上限（14 分冊 §8.15）。所以這裡只送 text；
 * 頁面文案也沒有任何一句宣稱圖片會隨推播送出。
 */

const MULTICAST_LIMIT = 500;

/** 沒有送出推播時的原因；頁面用它挑該顯示哪一句成功訊息（都不是錯誤） */
type PushSkipReason =
  | 'AUTO_TRIGGER'          // 自動觸發活動，依原站規格不在發布當下群發
  | 'NO_MESSAGE'            // content.text 是空的，沒有可推的內容
  | 'NO_RECIPIENTS'         // 本店沒有任何 followed=true 的 line_users
  | 'LINE_NOT_CONFIGURED'   // 尚未設定 LINE Channel（扣額度之前就發現）
  | 'QUOTA_EXCEEDED'        // 本月推播額度不足 → 不呼叫 LINE
  | 'LINE_ERROR';           // 已扣額度但 LINE 平台回錯

type PublishResult = {
  pushed: boolean;
  /** 實際被 multicast 送出去的收件人數（LINE 中途失敗時是失敗前已送出的批次總和） */
  sentCount: number;
  pushSkipReason?: PushSkipReason;
  /** pushSkipReason==='LINE_ERROR' 時的原文訊息，畫面要原樣帶出來 */
  pushErrorMessage?: string;
};

export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;

  // ① 先把狀態佔住（DRAFT → PUBLISHED）。這一步成功之後**永不還原**：
  //    發布本身已經生效，後面推播的成敗不改變它。
  const { data, error } = await t.supabase.from('campaigns')
    .update({ status: 'PUBLISHED' })
    .eq('id', id).eq('tenant_id', t.tenantId).eq('status', 'DRAFT') // 僅草稿可發佈
    .select('id, content').maybeSingle();
  if (error) throw error;
  if (!data) {
    const { data: exists, error: e2 } = await t.supabase
      .from('campaigns').select('id')
      .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
    if (e2) throw e2;
    if (!exists) throw new ApiHttpError(404, '找不到此活動', ERR.NOT_FOUND);
    throw new ApiHttpError(409, '此活動狀態已變更，請重新整理', ERR.CONFLICT);
  }

  const done = (r: PublishResult) => ok(r);
  const content = (data.content ?? {}) as Record<string, unknown>;

  // ② 自動觸發活動：原站規格明說不在發布當下群發
  if (content.isAutoTrigger === true)
    return done({ pushed: false, sentCount: 0, pushSkipReason: 'AUTO_TRIGGER' });

  const text = typeof content.text === 'string' ? content.text.trim() : '';
  if (!text)
    return done({ pushed: false, sentCount: 0, pushSkipReason: 'NO_MESSAGE' });

  // ③ 收件人＝本店 followed=true 的 line_users（＝原站文案的「所有追蹤者」）
  const { data: followers, error: e3 } = await t.supabase
    .from('line_users')
    .select('line_user_id')
    .eq('tenant_id', t.tenantId)
    .eq('followed', true);
  if (e3) throw e3;
  const recipients = [...new Set((followers ?? []).map((r) => r.line_user_id as string))];
  if (recipients.length === 0)
    return done({ pushed: false, sentCount: 0, pushSkipReason: 'NO_RECIPIENTS' });

  // ④ 憑證在扣額度**之前**取：沒設定 LINE 的店家不該被扣掉 N 則額度
  let token: string;
  try {
    ({ token } = await getLineCredentials(t.tenantId));
  } catch (err) {
    if (err instanceof ApiHttpError && err.code === ERR.LINE_NOT_CONFIGURED)
      return done({ pushed: false, sentCount: 0, pushSkipReason: 'LINE_NOT_CONFIGURED' });
    throw err;
  }

  // ⑤ 額度不足 → 不呼叫 LINE（06 分冊 §2）。活動仍維持 PUBLISHED，見檔頭理由。
  if (!(await consumePushQuota(t.tenantId, recipients.length)))
    return done({ pushed: false, sentCount: 0, pushSkipReason: 'QUOTA_EXCEEDED' });

  // ⑥ 每 500 人一批（LINE multicast 上限），逐批累計真的送出去的人數
  const messages = [{ type: 'text', text }];
  let sentCount = 0;
  for (let i = 0; i < recipients.length; i += MULTICAST_LIMIT) {
    const batch = recipients.slice(i, i + MULTICAST_LIMIT);
    try {
      await lineMulticast(token, batch, messages);
    } catch (err) {
      return done({
        pushed: false,
        sentCount,
        pushSkipReason: 'LINE_ERROR',
        pushErrorMessage: err instanceof Error ? err.message : String(err),
      });
    }
    sentCount += batch.length;
  }

  return done({ pushed: true, sentCount });
});
