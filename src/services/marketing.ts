import { ApiError, adapt, request } from '@/lib/api';
import type { MarketingPush, MarketingPushTargetType } from '@/lib/types';
import { MOCK_MODE } from '@/mock';
import type { BusinessType } from '@/config/modes';

/**
 * 行銷推播（/tenant/marketing）— Issue #24 接線。
 *
 * 後端 marketing_pushes 只有 title/content jsonb/audience jsonb/status/
 * scheduled_at/sent_at/sent_count（0005 migration，見
 * src/app/api/marketing/pushes/route.ts 檔頭註解）。content.text/imageUrl/note
 * 與 audience.type/value/label 在這裡攤平成 MarketingPush 型別，頁面只認得攤平後的
 * 型別，不用知道 jsonb 的存在。
 *
 * 沒有 estimatedCount／failedCount：marketing_pushes 沒有任何欄位或關聯表能在發送前
 * 算出受眾人數，也不記錄逐筆失敗數（見 src/lib/types.ts 的 MarketingPush 型別註解）。
 * 兩個模式都不生成這兩個欄位，頁面必須顯示誠實佔位文案，不可捏造。
 */

export type MarketingPushFormPayload = {
  title: string;
  content: string;
  imageUrl: string;
  note: string;
  targetType: MarketingPushTargetType;
  targetValue: string;
  targetLabel: string;
  scheduledAt: string | null;
};

function contentOf(p: MarketingPushFormPayload) {
  return { content: p.content, imageUrl: p.imageUrl, note: p.note };
}

type ApiMarketingPush = {
  id: string;
  title: string;
  content: string;
  imageUrl: string;
  note: string;
  targetType: string;
  targetValue: string;
  targetLabel: string;
  status: string;
  sentCount: number;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
};

/** GET /api/marketing/pushes 回傳的形狀已經攤平了 content/audience jsonb，這裡只轉型別。 */
function fromApi(r: ApiMarketingPush): MarketingPush {
  return {
    id: r.id,
    title: r.title,
    content: r.content,
    imageUrl: r.imageUrl,
    note: r.note,
    targetType: (r.targetType || 'ALL') as MarketingPushTargetType,
    targetValue: r.targetValue,
    targetLabel: r.targetLabel,
    status: r.status as MarketingPush['status'],
    sentCount: r.sentCount ?? 0,
    scheduledAt: r.scheduledAt,
    sentAt: r.sentAt,
    createdAt: r.createdAt,
  };
}

/**
 * mock 分支「假倉庫」：三種業態各自的示範資料 + 之後透過
 * createMarketingPush/updateMarketingPush/deleteMarketingPush/sendMarketingPush/
 * cancelMarketingPush 的異動，讓 mock 模式下的新增/編輯/刪除/發送/取消也像真實
 * 後端一樣可讀回、可持久。
 *
 * 延遲初始化：只在第一次被任何函式呼叫時建立（三套都建好），不在 module 頂層
 * 讀 MOCK_MODE / 呼叫 byMode()，避免凍結到錯誤業態（CLAUDE.md 明列的陷阱）。
 */
let mockPushStore: Record<BusinessType, MarketingPush[]> | null = null;
let nextMockPushId = 1;

function getMockPushStore(): Record<BusinessType, MarketingPush[]> {
  if (!mockPushStore) {
    mockPushStore = {
      LOCAL_SHOP: [
        {
          id: 'mp_1', title: '本週特惠活動通知',
          content: '本週來店指定設計師洗剪只要 499，名額有限，快來 LINE 預約！',
          imageUrl: '', note: '待確認文案',
          targetType: 'ALL', targetValue: '', targetLabel: '',
          status: 'DRAFT', sentCount: 0, scheduledAt: null, sentAt: null,
          createdAt: '2026-08-20T09:30:00+08:00',
        },
        {
          id: 'mp_2', title: '中秋公休公告',
          content: '9/25～9/27 中秋連假公休，造成不便敬請見諒。',
          imageUrl: '', note: '',
          targetType: 'ALL', targetValue: '', targetLabel: '',
          status: 'SCHEDULED', sentCount: 0, scheduledAt: '2026-09-18T10:00:00+08:00', sentAt: null,
          createdAt: '2026-08-18T14:12:00+08:00',
        },
        {
          id: 'mp_3', title: '鑽石卡限定：秋季護髮 8 折',
          content: '親愛的鑽石卡會員，本季護髮課程享 8 折，回覆「護髮」即可預約。',
          imageUrl: '', note: '',
          targetType: 'MEMBERSHIP_LEVEL', targetValue: 'ml_3', targetLabel: '鑽石卡',
          status: 'SENT', sentCount: 18, scheduledAt: null, sentAt: '2026-08-19T08:10:00+08:00',
          createdAt: '2026-08-19T08:05:00+08:00',
        },
        {
          id: 'mp_4', title: '新品上架：修護洗髮精',
          content: '沙龍級修護洗髮精開賣，前 30 名下單享 9 折。',
          imageUrl: 'https://example.com/image.jpg', note: '',
          targetType: 'ALL', targetValue: '', targetLabel: '',
          status: 'SENT', sentCount: 238, scheduledAt: null, sentAt: '2026-08-12T11:00:00+08:00',
          createdAt: '2026-08-12T10:40:00+08:00',
        },
        {
          id: 'mp_5', title: '限時優惠：指定名單回饋',
          content: '感謝您長期支持，出示此訊息即可折抵 200 元。',
          imageUrl: '', note: '額度不足',
          targetType: 'CUSTOM', targetValue: 'U1234567890abcdef\nU0987654321fedcba', targetLabel: '',
          status: 'FAILED', sentCount: 0, scheduledAt: null, sentAt: '2026-08-08T19:20:00+08:00',
          createdAt: '2026-08-08T19:00:00+08:00',
        },
        {
          id: 'mp_6', title: '父親節問候',
          content: '祝所有爸爸節日快樂！本週來店贈送造型服務一次。',
          imageUrl: '', note: '改用行銷活動發送',
          targetType: 'TAG', targetValue: '熟客', targetLabel: '熟客',
          status: 'CANCELLED', sentCount: 0, scheduledAt: '2026-08-08T09:00:00+08:00', sentAt: null,
          createdAt: '2026-08-05T16:30:00+08:00',
        },
      ],
      GUIDE: [
        {
          id: 'mp_g1', title: '9 月賞鯨團次開賣',
          content: '9 月團次開放報名囉！出團前 30 天報名享 9 折，週末場次每次都秒殺 🐬',
          imageUrl: '', note: '等封面照確認',
          targetType: 'ALL', targetValue: '', targetLabel: '',
          status: 'DRAFT', sentCount: 0, scheduledAt: null, sentAt: null,
          createdAt: '2026-08-20T09:30:00+08:00',
        },
        {
          id: 'mp_g2', title: '颱風備案通知',
          content: '本週有颱風接近，8/23 前的團次將於出團前一日 18:00 前發送最終確認，如取消全額退費。',
          imageUrl: '', note: '只發近期出團的旅客',
          targetType: 'CUSTOM', targetValue: 'U901\nU902\nU905', targetLabel: '',
          status: 'SCHEDULED', sentCount: 0, scheduledAt: '2026-08-22T18:00:00+08:00', sentAt: null,
          createdAt: '2026-08-20T11:05:00+08:00',
        },
        {
          id: 'mp_g3', title: '祕島之友限定：新路線先行報名',
          content: '新開的太魯閣秘境路線，先開放祕島之友報名，回覆「新路線」了解詳情。',
          imageUrl: '', note: '',
          targetType: 'MEMBERSHIP_LEVEL', targetValue: 'ml_3', targetLabel: '祕島之友',
          status: 'SENT', sentCount: 20, scheduledAt: null, sentAt: '2026-08-19T08:10:00+08:00',
          createdAt: '2026-08-19T08:05:00+08:00',
        },
        {
          id: 'mp_g4', title: '溯溪季倒數',
          content: '溯溪季只到 10/15，還沒體驗過的旅人把握最後檔期！',
          imageUrl: 'https://example.com/river.jpg', note: '',
          targetType: 'TAG', targetValue: '溯溪', targetLabel: '溯溪',
          status: 'SENT', sentCount: 94, scheduledAt: null, sentAt: '2026-08-12T11:00:00+08:00',
          createdAt: '2026-08-12T10:40:00+08:00',
        },
        {
          id: 'mp_g5', title: '推播額度提醒測試',
          content: '本月推播額度即將用完，測試發送。',
          imageUrl: '', note: '推播額度不足（168/200）',
          targetType: 'ALL', targetValue: '', targetLabel: '',
          status: 'FAILED', sentCount: 0, scheduledAt: null, sentAt: '2026-08-10T19:20:00+08:00',
          createdAt: '2026-08-10T19:00:00+08:00',
        },
      ],
      CLINIC: [
        {
          id: 'mp_c1', title: '流感疫苗開打通知',
          content: '本院流感疫苗已到貨，公費對象請攜帶健保卡，線上可預約看診號碼。',
          imageUrl: '', note: '分批發送避免當日湧入',
          targetType: 'ALL', targetValue: '', targetLabel: '',
          status: 'SCHEDULED', sentCount: 0, scheduledAt: '2026-08-25T10:00:00+08:00', sentAt: null,
          createdAt: '2026-08-18T14:12:00+08:00',
        },
        {
          id: 'mp_c2', title: '中秋連假休診公告',
          content: '9/25～9/27 中秋連假休診，急診請至鄰近醫院，造成不便敬請見諒。',
          imageUrl: '', note: '',
          targetType: 'ALL', targetValue: '', targetLabel: '',
          status: 'DRAFT', sentCount: 0, scheduledAt: null, sentAt: null,
          createdAt: '2026-08-20T09:00:00+08:00',
        },
        {
          id: 'mp_c3', title: '年度健檢提醒',
          content: '距離您上次健檢已滿一年，現在預約享早鳥折 800，名額有限。',
          imageUrl: '', note: '',
          targetType: 'MEMBERSHIP_LEVEL', targetValue: 'ml_3', targetLabel: 'VIP 健檢',
          status: 'SENT', sentCount: 46, scheduledAt: null, sentAt: '2026-08-14T09:00:00+08:00',
          createdAt: '2026-08-14T08:30:00+08:00',
        },
      ],
    };
  }
  return mockPushStore;
}

/** GET /api/marketing/pushes — 依建立時間新到舊排序，頁面唯一資料源。 */
export const listMarketingPushes = () =>
  adapt<MarketingPush[]>(
    () => [...getMockPushStore()[MOCK_MODE]].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    async () => (await request<ApiMarketingPush[]>('/api/marketing/pushes')).map(fromApi),
  );

/** POST /api/marketing/pushes — 有 scheduledAt 建 SCHEDULED，否則 DRAFT，回 { id }。 */
export const createMarketingPush = (payload: MarketingPushFormPayload) =>
  adapt<{ id: string }>(
    () => {
      const store = getMockPushStore()[MOCK_MODE];
      const id = `mp_new_${nextMockPushId++}`;
      store.push({
        id,
        title: payload.title,
        content: payload.content,
        imageUrl: payload.imageUrl,
        note: payload.note,
        targetType: payload.targetType,
        targetValue: payload.targetValue,
        targetLabel: payload.targetLabel,
        status: payload.scheduledAt ? 'SCHEDULED' : 'DRAFT',
        sentCount: 0,
        scheduledAt: payload.scheduledAt,
        sentAt: null,
        createdAt: new Date().toISOString(),
      });
      return { id };
    },
    () => request<{ id: string }>('/api/marketing/pushes', {
      method: 'POST',
      body: JSON.stringify({
        title: payload.title,
        targetType: payload.targetType,
        targetValue: payload.targetValue,
        targetLabel: payload.targetLabel,
        scheduledAt: payload.scheduledAt,
        ...contentOf(payload),
      }),
    }),
  );

/**
 * PUT /api/marketing/pushes/:id — 僅 DRAFT/SCHEDULED 可編輯（後端 409 擋 SENT/
 * SENDING/CANCELLED/FAILED），scheduledAt 有值→SCHEDULED、清空→DRAFT。
 */
export const updateMarketingPush = (id: string, payload: MarketingPushFormPayload) =>
  adapt<void>(
    () => {
      const store = getMockPushStore()[MOCK_MODE];
      const item = store.find((p) => p.id === id);
      if (!item) throw new ApiError('找不到此推播', 'NOT_FOUND', 404);
      if (item.status !== 'DRAFT' && item.status !== 'SCHEDULED') {
        throw new ApiError('此推播已發送或取消，無法編輯', 'CONFLICT', 409);
      }
      item.title = payload.title;
      item.content = payload.content;
      item.imageUrl = payload.imageUrl;
      item.note = payload.note;
      item.targetType = payload.targetType;
      item.targetValue = payload.targetValue;
      item.targetLabel = payload.targetLabel;
      item.scheduledAt = payload.scheduledAt;
      item.status = payload.scheduledAt ? 'SCHEDULED' : 'DRAFT';
    },
    () => request<void>(`/api/marketing/pushes/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        title: payload.title,
        targetType: payload.targetType,
        targetValue: payload.targetValue,
        targetLabel: payload.targetLabel,
        scheduledAt: payload.scheduledAt,
        ...contentOf(payload),
      }),
    }),
  );

/** DELETE /api/marketing/pushes/:id — SENT 保留歷史不可刪（後端 409），其餘皆可刪。 */
export const deleteMarketingPush = (id: string) =>
  adapt<void>(
    () => {
      const store = getMockPushStore()[MOCK_MODE];
      const idx = store.findIndex((p) => p.id === id);
      if (idx === -1) throw new ApiError('找不到此推播', 'NOT_FOUND', 404);
      if (store[idx].status === 'SENT') throw new ApiError('已發送的推播不可刪除', 'CONFLICT', 409);
      store.splice(idx, 1);
    },
    () => request<void>(`/api/marketing/pushes/${id}`, { method: 'DELETE' }),
  );

/** POST /api/marketing/pushes/:id/cancel — SCHEDULED→CANCELLED。 */
export const cancelMarketingPush = (id: string) =>
  adapt<void>(
    () => {
      const store = getMockPushStore()[MOCK_MODE];
      const item = store.find((p) => p.id === id);
      if (!item) throw new ApiError('找不到此推播', 'NOT_FOUND', 404);
      if (item.status !== 'SCHEDULED') throw new ApiError('此推播狀態已變更，請重新整理', 'CONFLICT', 409);
      item.status = 'CANCELLED';
    },
    () => request<void>(`/api/marketing/pushes/${id}/cancel`, { method: 'POST' }),
  );

/**
 * POST /api/marketing/pushes/:id/send — 立即發送，真的透過 LINE multicast 發給真實顧客
 * 並扣推播額度（見 send/route.ts 檔頭註解）。
 *
 * ⚠️ mock 分支絕不可呼叫任何網路：只把本地假倉庫的狀態改成 SENT，模擬「看起來已發送」
 * 讓骨架模式下的操作可以自洽測試，不會、也不能觸發真實 LINE 發送。真實分支單純呼叫
 * 這支端點一次，讓後端決定要不要真的送出——本檔案本身完全不含任何會直接命中
 * LINE API 或繞過後端的邏輯。
 */
export const sendMarketingPush = (id: string) =>
  adapt<{ sentCount: number }>(
    () => {
      const store = getMockPushStore()[MOCK_MODE];
      const item = store.find((p) => p.id === id);
      if (!item) throw new ApiError('找不到此推播', 'NOT_FOUND', 404);
      if (!['DRAFT', 'SCHEDULED', 'FAILED'].includes(item.status)) {
        throw new ApiError('此推播狀態已變更，請重新整理', 'CONFLICT', 409);
      }
      const sentCount = item.targetType === 'ALL' ? 200 : 1;
      item.status = 'SENT';
      item.sentCount = sentCount;
      item.sentAt = new Date().toISOString();
      return { sentCount };
    },
    () => request<{ sentCount: number }>(`/api/marketing/pushes/${id}/send`, { method: 'POST' }),
  );
