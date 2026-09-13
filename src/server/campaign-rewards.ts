/**
 * src/server/campaign-rewards.ts — 行銷活動獎勵的唯一發放入口（issue #176 第 2、3 項）
 * =============================================================================
 * ## 這支檔案在補什麼洞
 *
 * `campaigns.content` 裡的 `couponId` / `bonusPoints` / `thresholdAmount` 從
 * `0005` 就存得進去，但**全站沒有任何程式讀它們**——`POST /api/campaigns/:id/publish`
 * 的完整內容是一次 `update({ status: 'PUBLISHED' })`。店家設好「滿額送 100 點」、
 * 按發布、看到成功訊息，實際上什麼都不會發生。這是 PB-027 的第四種形狀：
 * 欄位存在、UI 存在、狀態機存在，唯獨那件事不會發生。
 *
 * ## 觸發點（#176 第 2 項的三種類型）
 *
 * | 類型 | 觸發 | 條件 |
 * |---|---|---|
 * | `NEW_CUSTOMER` 新客首購 | 預約完成 | 這是該顧客的**第一筆** COMPLETED 預約 |
 * | `SPENDING_THRESHOLD` 滿額回饋 | 預約完成 | `final_price >= content.thresholdAmount` |
 * | `LIMITED_TIME` 限時優惠 | 顧客在 LINE 打出活動關鍵字 | 活動在 `start_at ~ end_at` 期間內 |
 *
 * `LIMITED_TIME` 刻意不是事件觸發型：它本來就是「一段時間內的限時優惠」，沒有
 * 「什麼事發生了」這種自然觸發點，只有「顧客來領」。webhook 的活動關鍵字分支
 * （`line-events.ts` 分支 ③）本來就會回覆，讓它同時完成領取是唯一不需要發明新
 * 互動的作法。
 *
 * `REFERRAL` 推薦活動**不在本檔範圍**：推薦碼配發與雙方獎勵是 issue #24 的整塊
 * 功能，這裡不預先實作一半。`BIRTHDAY` / `RECALL` 依 #176 第 1 項的 Owner 裁示 (b)
 * 已從活動頁移除並導向通知設定頁，那兩支 cron 本來就在跑，本檔不碰。
 *
 * ## 一位顧客每個活動只發一次
 *
 * `campaign_reward_grants` 的 `unique (tenant_id, campaign_id, customer_id)` 就是
 * 冪等鍵。**這是一個產品決定，不是技術限制**：活動頁沒有「可重複領取」的設定欄位，
 * 而點數等同金額，在沒有明確設定的情況下選會重複發放的那一邊，錯了就是真實損失。
 * 頁面上會明說「每位顧客每個活動只發放一次」。要改成「每筆滿額都送」需要先在
 * 活動頁加上該設定並由擁有者裁示，屆時改冪等鍵的組成即可。
 *
 * ## 為什麼發放是一支 RPC 而不是幾次寫入
 *
 * #218（PR #280 / migration 0090）剛因為「扣點、折價、帳本三步不在同一交易」出過事。
 * 發放是同一個形狀的鏡像：搶冪等鍵、加點數、寫帳本、發票券必須一起成功或一起不發生。
 * 任何一步失敗卻留下 grant 列，那位顧客就**永遠**領不到了——冪等鍵會擋住重試。
 * 所以四件事全在 `grant_campaign_reward()` 裡（`0091`），本檔只負責「挑出哪些活動
 * 該發」與「把結果記進 log」。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminSupabase } from './supabase';
import { isFeatureActive } from './features';
import { genCouponCode } from './coupon-code';

/** 發放的觸發來源，與 `campaign_reward_grants.trigger_kind` 逐字對應 */
export type CampaignTrigger = 'BOOKING_COMPLETED' | 'KEYWORD_CLAIM';

/** 本檔會處理的活動類型。其餘類型即使建了活動也不會被挑中。 */
export const REWARDABLE_TYPES = {
  BOOKING_COMPLETED: ['NEW_CUSTOMER', 'SPENDING_THRESHOLD'] as const,
  KEYWORD_CLAIM: ['LIMITED_TIME'] as const,
};

export type CampaignRewardOutcome = {
  campaignId: string;
  campaignName: string;
  /** true = 這次真的發了；false = 這位顧客已經領過（冪等命中），不是錯誤 */
  granted: boolean;
  bonusPoints: number;
  couponInstanceId: string | null;
  /** 發放失敗的原因代碼（COUPON_EXHAUSTED / CUSTOMER_NOT_FOUND …）。成功時為 null。 */
  error: string | null;
};

type CampaignRow = { id: string; name: string; content: Record<string, unknown> | null };

/** content.bonusPoints 的安全讀法（頁面存的是 number，但 jsonb 什麼都塞得進來） */
function readPoints(content: Record<string, unknown> | null): number {
  const n = Number((content ?? {}).bonusPoints);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function readCouponId(content: Record<string, unknown> | null): string | null {
  const v = (content ?? {}).couponId;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function readType(content: Record<string, unknown> | null): string {
  const v = (content ?? {}).type;
  return typeof v === 'string' ? v : '';
}

/**
 * `thresholdAmount` 未設定時**不視為 0**。
 *
 * 若把「沒填門檻」當成 0，一個店家隨手建的空白滿額活動就會對**每一筆**完成的
 * 預約發獎勵——那是最貴的一種預設值。沒填就是沒設定好，不發。
 */
function readThreshold(content: Record<string, unknown> | null): number | null {
  const n = Number((content ?? {}).thresholdAmount);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 活動此刻是否在有效期間內。
 *
 * `start_at` 為 null＝立即開始、`end_at` 為 null＝永久，與 campaigns 頁
 * `labels.immediately` / `labels.forever` 的語意一致。
 */
export function isWithinWindow(
  startAt: string | null,
  endAt: string | null,
  now: Date = new Date(),
): boolean {
  const t = now.getTime();
  if (startAt && new Date(startAt).getTime() > t) return false;
  if (endAt && new Date(endAt).getTime() < t) return false;
  return true;
}

/**
 * 挑出「此刻有效、類型相符、而且真的有東西可發」的活動。
 *
 * ⚠️ 期間判定刻意做在 JS 而不是 PostgREST 的 `.or()`：兩段 `or=(...)` 串接依賴
 * PostgREST 把多個 filter 以 AND 結合、以及它對 `.`／`,` 的切分規則，而 ISO 時間
 * 字串裡同時有 `.`（毫秒）和 `:`。把「獎勵發不發得出去」綁在那組語法細節上，
 * 是 PB-024 的同族錯誤（那次是 FK 名稱，這次會是查詢語法）——一旦解析結果不如
 * 預期，症狀是**靜默地一個活動都挑不到**，沒有任何東西會紅。
 * 單一租戶的活動數是個位數，多取幾列在記憶體過濾的成本可以忽略。
 */
async function activeCampaigns(
  admin: SupabaseClient,
  tenantId: string,
  types: readonly string[],
): Promise<CampaignRow[]> {
  const { data, error } = await admin
    .from('campaigns')
    .select('id, name, content, start_at, end_at')
    .eq('tenant_id', tenantId)
    .eq('status', 'PUBLISHED');

  // ⚠️ 查詢失敗不可以當成「沒有活動」（PB-023）。回空陣列會讓「查不到」與
  // 「查失敗」在呼叫端長得一模一樣，店家只會收到客訴說獎勵沒發。這裡記 log
  // 並往上拋，由呼叫端決定要不要吞（預約完成流程會吞，見該處註解）。
  if (error) {
    console.error('[campaign-rewards] 查詢 campaigns 失敗', tenantId, error);
    throw error;
  }

  return (data ?? []).filter((row: any) => {
    const content = (row.content ?? {}) as Record<string, unknown>;
    if (!types.includes(readType(content))) return false;
    if (!isWithinWindow(row.start_at ?? null, row.end_at ?? null)) return false;
    // 沒有點數也沒有票券的活動不必進發放流程——進去只會拿到 NOTHING_TO_GRANT，
    // 還會白白吃掉冪等鍵，讓店家日後補設定了也發不出來。
    return readPoints(content) > 0 || readCouponId(content) !== null;
  }) as CampaignRow[];
}

export type GrantInput = {
  tenantId: string;
  customerId: string;
  trigger: CampaignTrigger;
  /** 造成這次發放的來源（預約 id）；關鍵字領取時為 null */
  sourceId?: string | null;
  /** 預約完成時的實收金額，供 SPENDING_THRESHOLD 比對 */
  amount?: number | null;
  /** 這是否為該顧客的第一筆 COMPLETED 預約，供 NEW_CUSTOMER 判定 */
  isFirstCompletedBooking?: boolean;
  /** 只發這一個活動（LIMITED_TIME 由關鍵字命中，已經知道是哪一個） */
  onlyCampaignId?: string;
};

/**
 * 發放符合條件的活動獎勵，回傳逐個活動的結果。
 *
 * **本函式不 throw 業務錯誤**：單一活動發放失敗（票券售罄、票券被刪、顧客不存在）
 * 只記進該筆的 `error` 並繼續下一個活動——一個設壞的活動不該讓其他活動也發不出去。
 * 只有「連活動清單都查不到」會往上拋。
 */
export async function grantCampaignRewards(input: GrantInput): Promise<CampaignRewardOutcome[]> {
  const admin = createAdminSupabase();
  const types = REWARDABLE_TYPES[input.trigger];
  let campaigns = await activeCampaigns(admin, input.tenantId, types);

  if (input.onlyCampaignId) {
    campaigns = campaigns.filter((c) => c.id === input.onlyCampaignId);
  }

  // 逐型的額外條件
  campaigns = campaigns.filter((c) => {
    const type = readType(c.content);
    if (type === 'NEW_CUSTOMER') return input.isFirstCompletedBooking === true;
    if (type === 'SPENDING_THRESHOLD') {
      const threshold = readThreshold(c.content);
      return threshold !== null && Number(input.amount ?? 0) >= threshold;
    }
    return true;
  });

  if (!campaigns.length) return [];

  // 閘門一次查完（同一個租戶、同一次觸發，不必每個活動各查一次）
  const [pointsOn, couponsOn] = await Promise.all([
    isFeatureActive(input.tenantId, 'POINT_SYSTEM'),
    isFeatureActive(input.tenantId, 'COUPON_SYSTEM'),
  ]);

  const outcomes: CampaignRewardOutcome[] = [];

  for (const campaign of campaigns) {
    const bonusPoints = readPoints(campaign.content);
    const couponId = readCouponId(campaign.content);

    // ⚠️ 閘門不足時**整個活動跳過**，不是「發得出來的那一半照發」。
    // 發一半會吃掉冪等鍵，店家日後補訂閱了，那位顧客也永遠拿不到另一半。
    const missing =
      (bonusPoints > 0 && !pointsOn) ? 'POINT_SYSTEM'
      : (couponId !== null && !couponsOn) ? 'COUPON_SYSTEM'
      : null;
    if (missing) {
      outcomes.push({
        campaignId: campaign.id, campaignName: campaign.name, granted: false,
        bonusPoints: 0, couponInstanceId: null, error: `FEATURE_INACTIVE:${missing}`,
      });
      continue;
    }

    // code 有 unique (tenant_id, code)；32^8 ≈ 1.1e12 組合，碰撞極低，
    // 仍以 23505 重試（換一個新 code）保險，最多 3 次——與 batch-issue 同語意。
    let outcome: CampaignRewardOutcome | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await admin.rpc('grant_campaign_reward', {
        p_tenant: input.tenantId,
        p_campaign: campaign.id,
        p_customer: input.customerId,
        p_trigger: input.trigger,
        p_source: input.sourceId ?? null,
        p_points: bonusPoints,
        p_coupon: couponId,
        p_code: genCouponCode(),
      });

      if (!error) {
        const row = (Array.isArray(data) ? data[0] : data) as any;
        outcome = {
          campaignId: campaign.id,
          campaignName: campaign.name,
          granted: row?.out_granted === true,
          bonusPoints: row?.out_granted === true ? bonusPoints : 0,
          couponInstanceId: (row?.out_coupon_instance as string | null) ?? null,
          error: null,
        };
        break;
      }

      const message = String((error as any)?.message ?? '');
      if ((error as any)?.code === '23505' && attempt < 2) continue;

      // 業務錯誤代碼原樣留下——它們是 0091 檔頭定義的契約，讓 log 看得出原因。
      const known = ['COUPON_EXHAUSTED', 'COUPON_NOT_FOUND', 'CUSTOMER_NOT_FOUND', 'NOTHING_TO_GRANT']
        .find((code) => message.includes(code));
      console.error('[campaign-rewards] 發放失敗', campaign.id, input.customerId, message);
      outcome = {
        campaignId: campaign.id, campaignName: campaign.name, granted: false,
        bonusPoints: 0, couponInstanceId: null, error: known ?? 'UNKNOWN',
      };
      break;
    }

    if (outcome) outcomes.push(outcome);
  }

  return outcomes;
}
