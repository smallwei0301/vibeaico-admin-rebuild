/**
 * src/server/trip-flex.ts — 「行程」關鍵字的 Flex 輪播（10 分冊 §6.1 的 `TRIP` 組）。
 *
 * 為什麼**不**寫進 `src/server/flex-menu.ts`：那一支的檔頭寫著它是主選單 Flex 的
 * 單一事實來源（issue #6）——那句話管的是**主選單**這一個成品，不是「全站所有
 * Flex JSON」。行程輪播是另一個成品：資料來源是 `trips` 表而不是店家編的卡片，
 * 觸發字、欄位、按鈕動作全都不同。硬塞進去只會讓那支檔案變成兩件事共用一個
 * builder，日後改其中一件必然弄壞另一件。
 *
 * 10 分冊 §6.1 對這張卡片的規格：**封面 / 標語 / 最低價 / 「我要預約」按鈕**。
 * 按鈕動作依 §6.2 v1：`uri` 指到商店頁該行程的網址（LINE 內建瀏覽器開啟，
 * 走 11 分冊的 checkout）——不是 postback，聊天內下單是 v2。
 *
 * ⚠️ LINE 的硬性限制，每一條都會讓整則訊息被退：
 *   - carousel 最多 12 個 bubble
 *   - hero 的 `url` 只收 **https**（14 分冊 §8.20-b 實測：`uri` action 收 http，
 *     但 **hero 圖片**不收——§6.9 記的就是這一條，兩者不可混為一談）。
 *     所以沒有封面圖、或封面圖不是 https 的行程，這裡**不放 hero**，
 *     而不是塞一張佔位圖。
 *   - text 不可為空字串（會回 `may not be empty`），所以每個欄位都要有 fallback
 *     或整個省略。
 */

import { withLineSource } from '@/lib/public-order-channel';

/** LINE carousel 的硬上限 */
export const TRIP_CAROUSEL_MAX = 12;

export type TripCardSource = {
  slug: string;
  title: string;
  /** 一句話標語。`0089` 之後才真的存得住，見 `subtitleOf()`。 */
  tagline: string;
  summary: string;
  coverImageUrl: string;
  /**
   * 該行程所有 active 方案的最低 `price_per_person`；沒有啟用方案時為 `null`
   * （＝價格未知，**不是 0**，理由見下方 `priceTextOf()`）。
   */
  minPrice: number | null;
};

const isHttps = (u: string) => /^https:\/\//i.test(u.trim());

/**
 * 一行副標：**標語優先，其次簡介**；兩者皆空就不放這一列（LINE 的 text 元件
 * 不收空字串）。
 *
 * 這裡曾經只取簡介。原因是 `public.trips` 當時**沒有 tagline 欄位**
 * （`0066_issue_8_tour_domain_core.sql`），`tripCreateSchema` 也不收它——
 * 讀一個不存在的欄位只會讓每張卡的副標永遠是 undefined，而且沒有任何測試會紅。
 * `0089_trip_display_fields.sql`（issue #259）補上欄位、寫入與讀取四條路徑都接好
 * 之後，才改回標語優先：那是店家真的填得進去、也真的想讓顧客先看到的一句話。
 */
function subtitleOf(t: TripCardSource): string {
  const source = (t.tagline || '').trim() || (t.summary || '');
  const raw = source.split('\n')[0].trim();
  return raw.length > 60 ? `${raw.slice(0, 59)}…` : raw;
}

/**
 * 價格文字。
 *
 * ⚠️ `minPrice === null` 代表「這個行程還沒有任何啟用的方案，所以沒有價格」
 * ——顯示 `NT$ 0` 會是一個捏造的已知（顧客會以為免費）。這種情況顯示
 * `priceUnknownText`，由呼叫端傳入（文案不寫死在 server 檔裡）。
 */
function priceTextOf(minPrice: number | null, fromLabel: string, unknownText: string): string {
  if (minPrice === null || !Number.isFinite(minPrice)) return unknownText;
  return `${fromLabel} NT$ ${Math.round(minPrice).toLocaleString('en-US')}`;
}

export type TripFlexLabels = {
  /** carousel 的 altText（LINE 在推播清單與不支援 Flex 的裝置上顯示這一句） */
  altText: string;
  /** 價格前綴，例：「最低」 */
  priceFrom: string;
  /** 沒有任何啟用方案時的價格文字，例：「價格洽詢」 */
  priceUnknown: string;
  /** 按鈕文字，例：「我要預約」 */
  bookCta: string;
};

/**
 * 行程 → Flex carousel 訊息物件（可直接放進 `lineReply` 的 messages 陣列）。
 * 傳入空陣列時回 `null`，由呼叫端決定要回什麼（不要在這裡替它決定）。
 */
export function buildTripCarousel(
  trips: TripCardSource[],
  shopUrl: string,
  labels: TripFlexLabels,
): Record<string, unknown> | null {
  const rows = trips.slice(0, TRIP_CAROUSEL_MAX);
  if (!rows.length) return null;

  const bubbles = rows.map((t) => {
    const subtitle = subtitleOf(t);
    const bodyContents: Record<string, unknown>[] = [
      { type: 'text', text: t.title, weight: 'bold', size: 'lg', wrap: true, maxLines: 2 },
    ];
    if (subtitle) {
      bodyContents.push({
        type: 'text', text: subtitle, size: 'sm', color: '#8C8C8C', wrap: true, maxLines: 2,
      });
    }
    bodyContents.push({
      type: 'text',
      text: priceTextOf(t.minPrice, labels.priceFrom, labels.priceUnknown),
      weight: 'bold',
      size: 'md',
      margin: 'md',
    });

    // 行程頁網址：商店頁 base + /trip/{slug}，最後才補 src=line（shopUrl 必須是不帶 query 的乾淨 base）
    const tripUrl = withLineSource(`${shopUrl.replace(/\/$/, '')}/trip/${encodeURIComponent(t.slug)}`);

    const bubble: Record<string, unknown> = {
      type: 'bubble',
      size: 'kilo',
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: bodyContents },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [{
          type: 'button',
          style: 'primary',
          height: 'sm',
          action: { type: 'uri', label: labels.bookCta, uri: tripUrl },
        }],
      },
    };

    // 封面圖只在確定是 https 時才放（見檔頭）——否則整則訊息會被 LINE 退回
    if (isHttps(t.coverImageUrl)) {
      bubble.hero = {
        type: 'image',
        url: t.coverImageUrl.trim(),
        size: 'full',
        aspectRatio: '20:13',
        aspectMode: 'cover',
        action: { type: 'uri', label: labels.bookCta, uri: tripUrl },
      };
    }

    return bubble;
  });

  return {
    type: 'flex',
    altText: labels.altText,
    contents: { type: 'carousel', contents: bubbles },
  };
}

/**
 * #1012：各行程「起 NT$」最低價。只算 active、價格為有限且 > 0、且**非季節定價**的方案
 * （季節方案的 price_per_person 只是基本價，與公開首頁 #895 同一規則；0 元／負數方案與首頁一樣不計入）。
 * 沒有符合的方案就不會有該行程的 entry → 呼叫端顯示「價格洽詢」，不是 NT$ 0。
 */
export function minNonSeasonalPriceByTrip(
  plans: ReadonlyArray<{ id?: unknown; trip_id: string; price_per_person: unknown; active?: unknown }>,
  seasonalPlanIds: ReadonlySet<string>,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const p of plans) {
    if (!p.active) continue;
    if (seasonalPlanIds.has(String(p.id))) continue;
    const price = Number(p.price_per_person);
    if (!Number.isFinite(price) || price <= 0) continue;
    const current = result.get(p.trip_id);
    if (current === undefined || price < current) result.set(p.trip_id, price);
  }
  return result;
}
