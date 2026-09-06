import { ApiError, adapt, request } from '@/lib/api';
import type { Campaign, CampaignType } from '@/lib/types';
import { MOCK_MODE } from '@/mock';
import type { BusinessType } from '@/config/modes';

/**
 * 行銷活動（/tenant/campaigns）— Issue #23 接線。
 *
 * 後端 campaigns 表只有 name/keyword/content jsonb/start_at/end_at/status
 * （0005 migration）；description/type/pushMessage/couponId/bonusPoints/
 * thresholdAmount/recallDays/isAutoTrigger/imageUrl 全部收在 content jsonb
 * （見 src/app/api/campaigns/route.ts 檔頭註解，DB 不拆欄）。這裡在讀取時把
 * content 攤平成 Campaign 型別，寫入時再收合回 content —— 頁面只認得攤平後的
 * 型別，不用知道 jsonb 的存在。
 *
 * status：後端只有 DRAFT/PUBLISHED/PAUSED/ENDED 四種持久化狀態，沒有前端原本
 * 假資料裡的獨立 SCHEDULED。`campaignDisplayStatus()` 把 PUBLISHED 且 startAt
 * 在未來的活動顯示為「已排程」，純粹是畫面呈現 —— 可執行的動作（發布/暫停/
 * 恢復/結束）一律依真正寫進 DB 的 status 判斷，不受顯示狀態影響。
 *
 * participantCount：repo 內沒有 campaign_participants，也沒有任何表帶
 * campaign_id 外鍵，這個「參加人數」沒有任何資料來源可讀。API 完全不回這個
 * 欄位（見 src/lib/types.ts 的 Campaign 型別註解），mock 分支也一律不生成，
 * 讓兩個模式的行為一致 —— 頁面必須顯示誠實佔位文案，不可捏造數字。
 *
 * ⛔ 後端缺口（Owner 待決事項，未自行修改 src/app/api/**）：
 * deleteCampaign() 呼叫 `DELETE /api/campaigns/:id`。該 handler 原本不存在
 * （真實模式下刪除鈕必定收到 405），本 slice 依「復原而非取消」補上，與 PUT
 * 使用同一組 id + tenant_id 雙條件隔離。
 */

/** 判斷活動應該顯示的狀態（含前端衍生的 SCHEDULED，不是持久化欄位）。 */
export function campaignDisplayStatus(c: Campaign): 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'ENDED' {
  if (c.status === 'PUBLISHED') {
    return c.startAt && new Date(c.startAt).getTime() > Date.now() ? 'SCHEDULED' : 'ACTIVE';
  }
  if (c.status === 'DRAFT') return 'DRAFT';
  if (c.status === 'PAUSED') return 'PAUSED';
  return 'ENDED';
}

export type CampaignFormPayload = {
  name: string;
  keyword?: string;
  description: string;
  type: CampaignType;
  startAt: string | null;
  endAt: string | null;
  pushMessage: string;
  couponId: string | null;
  bonusPoints: number;
  thresholdAmount: number | null;
  recallDays: number | null;
  isAutoTrigger: boolean;
  imageUrl: string;
};

function contentOf(p: CampaignFormPayload): Record<string, unknown> {
  return {
    description: p.description,
    type: p.type,
    pushMessage: p.pushMessage,
    couponId: p.couponId,
    bonusPoints: p.bonusPoints,
    thresholdAmount: p.thresholdAmount,
    recallDays: p.recallDays,
    isAutoTrigger: p.isAutoTrigger,
    imageUrl: p.imageUrl,
  };
}

type ApiCampaign = {
  id: string;
  name: string;
  keyword: string;
  description: string;
  type: string;
  content: Record<string, unknown>;
  status: string;
  startAt: string | null;
  endAt: string | null;
  createdAt: string;
};

/** GET /api/campaigns 回傳的形狀已經把 content.description / content.type 攤平了一層；這裡再把其餘欄位攤平。 */
function fromApi(r: ApiCampaign): Campaign {
  const c = r.content ?? {};
  return {
    id: r.id,
    name: r.name,
    keyword: r.keyword ?? '',
    description: r.description || (typeof c.description === 'string' ? c.description : ''),
    type: (r.type || (typeof c.type === 'string' ? c.type : '')) as CampaignType | '',
    status: r.status as Campaign['status'],
    startAt: r.startAt,
    endAt: r.endAt,
    pushMessage: typeof c.pushMessage === 'string' ? c.pushMessage : '',
    couponId: typeof c.couponId === 'string' ? c.couponId : null,
    bonusPoints: typeof c.bonusPoints === 'number' ? c.bonusPoints : 0,
    thresholdAmount: typeof c.thresholdAmount === 'number' ? c.thresholdAmount : null,
    recallDays: typeof c.recallDays === 'number' ? c.recallDays : null,
    isAutoTrigger: c.isAutoTrigger === true,
    imageUrl: typeof c.imageUrl === 'string' ? c.imageUrl : '',
    createdAt: r.createdAt,
  };
}

/**
 * mock 分支「假倉庫」：三種業態各自的示範資料 + 之後透過
 * createCampaign/updateCampaign/deleteCampaign/publishCampaign/pauseCampaign/
 * resumeCampaign/endCampaign 的異動，讓 mock 模式下的新增/編輯/刪除/狀態轉換
 * 也像真實後端一樣可讀回、可持久。
 *
 * 延遲初始化：只在第一次被任何函式呼叫時建立（三套都建好），不在 module
 * 頂層讀 MOCK_MODE / 呼叫 byMode()，避免凍結到錯誤業態（CLAUDE.md 明列的陷阱）。
 */
let mockCampaignStore: Record<BusinessType, Campaign[]> | null = null;
let nextMockCampaignId = 1;

function getMockCampaignStore(): Record<BusinessType, Campaign[]> {
  if (!mockCampaignStore) {
    mockCampaignStore = {
      LOCAL_SHOP: [
        {
          id: 'cm_1', name: '生日祝福', keyword: '', description: '生日當月來店即贈護髮體驗。',
          type: 'BIRTHDAY', status: 'PUBLISHED', startAt: '2026-01-01T00:00:00+08:00', endAt: null,
          pushMessage: '生日快樂！本月來店即可領取專屬生日禮，期待與你見面 🎂',
          couponId: 'cp_3', bonusPoints: 100,
          thresholdAmount: null, recallDays: null, isAutoTrigger: true,
          imageUrl: '', createdAt: '2025-12-20T10:00:00+08:00',
        },
        {
          id: 'cm_2', name: '新春限時優惠', keyword: '', description: '春節期間全店服務 9 折。',
          type: 'LIMITED_TIME', status: 'PUBLISHED',
          startAt: '2026-09-10T00:00:00+08:00', endAt: '2026-09-30T23:59:00+08:00',
          pushMessage: '新春限時：全店服務 9 折，只到 9/30！',
          couponId: 'cp_1', bonusPoints: 0,
          thresholdAmount: null, recallDays: null, isAutoTrigger: false,
          imageUrl: '', createdAt: '2026-08-15T09:20:00+08:00',
        },
        {
          id: 'cm_3', name: '顧客喚回', keyword: '', description: '', type: 'RECALL', status: 'PAUSED',
          startAt: '2026-05-01T00:00:00+08:00', endAt: null,
          pushMessage: '好久不見！回來讓我們幫你整理一下造型吧，出示此訊息折 200。',
          couponId: null, bonusPoints: 200,
          thresholdAmount: null, recallDays: 60, isAutoTrigger: true,
          imageUrl: '', createdAt: '2026-04-28T15:40:00+08:00',
        },
        {
          id: 'cm_4', name: '消費滿 2000 送點數', keyword: '', description: '單筆消費滿額回饋。',
          type: 'SPENDING_THRESHOLD', status: 'DRAFT', startAt: null, endAt: null,
          pushMessage: '', couponId: null, bonusPoints: 300,
          thresholdAmount: 2000, recallDays: null, isAutoTrigger: true,
          imageUrl: '', createdAt: '2026-08-19T18:05:00+08:00',
        },
        {
          id: 'cm_5', name: '新客首次體驗', keyword: '', description: '首次到店贈 8 折券。',
          type: 'NEW_CUSTOMER', status: 'ENDED',
          startAt: '2026-03-01T00:00:00+08:00', endAt: '2026-06-30T23:59:00+08:00',
          pushMessage: '第一次來？出示這則訊息即可享新客 8 折！',
          couponId: 'cp_1', bonusPoints: 0,
          thresholdAmount: null, recallDays: null, isAutoTrigger: true,
          imageUrl: '', createdAt: '2026-02-24T11:10:00+08:00',
        },
      ],
      GUIDE: [
        {
          id: 'cm_g1', name: '早鳥報名回饋', keyword: '', description: '出團前 30 天報名，送 500 點。',
          type: 'LIMITED_TIME', status: 'PUBLISHED',
          startAt: '2026-06-01T00:00:00+08:00', endAt: '2026-10-31T23:59:00+08:00',
          pushMessage: '暑期檔期開賣！出團前 30 天報名享 9 折，還送 500 點折抵下次行程 🌊',
          couponId: 'cp_1', bonusPoints: 500,
          thresholdAmount: null, recallDays: null, isAutoTrigger: false,
          imageUrl: '', createdAt: '2026-05-20T10:00:00+08:00',
        },
        {
          id: 'cm_g2', name: '揪團同行折扣', keyword: '', description: '4 人以上同行自動折 500。',
          type: 'SPENDING_THRESHOLD', status: 'PUBLISHED', startAt: '2026-07-01T00:00:00+08:00', endAt: null,
          pushMessage: '找朋友一起來！4 人以上同行每筆折 500，人越多越划算 🙌',
          couponId: 'cp_2', bonusPoints: 0,
          thresholdAmount: 5000, recallDays: null, isAutoTrigger: true,
          imageUrl: '', createdAt: '2026-06-25T14:30:00+08:00',
        },
        {
          id: 'cm_g3', name: '旅人回訪禮', keyword: '', description: '一年內再次報名贈免費裝備租借。',
          type: 'RECALL', status: 'PUBLISHED', startAt: '2026-03-01T00:00:00+08:00', endAt: null,
          pushMessage: '好久不見！最近開了新路線，回訪的旅人享免費裝備租借 🏕',
          couponId: 'cp_3', bonusPoints: 0,
          thresholdAmount: null, recallDays: 180, isAutoTrigger: true,
          imageUrl: '', createdAt: '2026-02-26T09:15:00+08:00',
        },
        {
          id: 'cm_g4', name: '生日出海禮', keyword: '', description: '壽星當月報名任一行程送紀念明信片。',
          type: 'BIRTHDAY', status: 'PUBLISHED', startAt: '2026-01-01T00:00:00+08:00', endAt: null,
          pushMessage: '生日快樂！這個月報名任一行程，我們送你一組祕島明信片 🎂',
          couponId: null, bonusPoints: 200,
          thresholdAmount: null, recallDays: null, isAutoTrigger: true,
          imageUrl: '', createdAt: '2025-12-28T11:00:00+08:00',
        },
        {
          id: 'cm_g5', name: '賞鯨季開跑', keyword: '', description: '4–9 月賞鯨旺季主打。',
          type: 'LIMITED_TIME', status: 'ENDED',
          startAt: '2026-04-01T00:00:00+08:00', endAt: '2026-08-10T23:59:00+08:00',
          pushMessage: '賞鯨季來了！飛旋海豚出沒率 9 成，週末團次熱賣中 🐬',
          couponId: null, bonusPoints: 0,
          thresholdAmount: null, recallDays: null, isAutoTrigger: false,
          imageUrl: '', createdAt: '2026-03-24T16:40:00+08:00',
        },
      ],
      CLINIC: [
        {
          id: 'cm_c1', name: '流感疫苗季提醒', keyword: '', description: '公費疫苗開打通知。',
          type: 'LIMITED_TIME', status: 'PUBLISHED',
          startAt: '2026-08-15T00:00:00+08:00', endAt: '2026-12-31T23:59:00+08:00',
          pushMessage: '流感疫苗開打囉！本院已開放線上預約，公費對象免費接種，名額有限。',
          couponId: null, bonusPoints: 0,
          thresholdAmount: null, recallDays: null, isAutoTrigger: false,
          imageUrl: '', createdAt: '2026-08-10T09:00:00+08:00',
        },
        {
          id: 'cm_c2', name: '年度健檢回訪', keyword: '', description: '滿一年未健檢者自動提醒。',
          type: 'RECALL', status: 'PUBLISHED', startAt: '2026-01-01T00:00:00+08:00', endAt: null,
          pushMessage: '距離您上次健康檢查已滿一年，建議安排今年度檢查，現在預約享早鳥折 800。',
          couponId: 'cp_1', bonusPoints: 0,
          thresholdAmount: null, recallDays: 365, isAutoTrigger: true,
          imageUrl: '', createdAt: '2025-12-30T10:20:00+08:00',
        },
        {
          id: 'cm_c3', name: '慢性病回診提醒', keyword: '', description: '慢性處方箋到期前提醒。',
          type: 'RECALL', status: 'PUBLISHED', startAt: '2026-02-01T00:00:00+08:00', endAt: null,
          pushMessage: '提醒您：慢性處方箋即將到期，記得回診由醫師評估後續用藥。',
          couponId: null, bonusPoints: 0,
          thresholdAmount: null, recallDays: 90, isAutoTrigger: true,
          imageUrl: '', createdAt: '2026-01-28T15:10:00+08:00',
        },
        {
          id: 'cm_c4', name: '家庭疫苗方案', keyword: '', description: '同戶 3 人以上 9 折。', type: 'SPENDING_THRESHOLD',
          status: 'DRAFT', startAt: null, endAt: null,
          pushMessage: '', couponId: 'cp_2', bonusPoints: 0,
          thresholdAmount: 2400, recallDays: null, isAutoTrigger: true,
          imageUrl: '', createdAt: '2026-08-18T17:30:00+08:00',
        },
      ],
    };
  }
  return mockCampaignStore;
}

/** GET /api/campaigns — 依建立時間新到舊排序，頁面唯一資料源。 */
export const listCampaigns = () =>
  adapt<Campaign[]>(
    () => [...getMockCampaignStore()[MOCK_MODE]].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    async () => (await request<ApiCampaign[]>('/api/campaigns')).map(fromApi),
  );

/** POST /api/campaigns — 一律以 DRAFT 建立，回 { id }。 */
export const createCampaign = (payload: CampaignFormPayload) =>
  adapt<{ id: string }>(
    () => {
      const store = getMockCampaignStore()[MOCK_MODE];
      const id = `cm_new_${nextMockCampaignId++}`;
      store.push({
        id,
        name: payload.name,
        keyword: payload.keyword ?? '',
        description: payload.description,
        type: payload.type,
        status: 'DRAFT',
        startAt: payload.startAt,
        endAt: payload.endAt,
        pushMessage: payload.pushMessage,
        couponId: payload.couponId,
        bonusPoints: payload.bonusPoints,
        thresholdAmount: payload.thresholdAmount,
        recallDays: payload.recallDays,
        isAutoTrigger: payload.isAutoTrigger,
        imageUrl: payload.imageUrl,
        createdAt: new Date().toISOString(),
      });
      return { id };
    },
    () => request<{ id: string }>('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        name: payload.name,
        keyword: payload.keyword ?? '',
        startAt: payload.startAt,
        endAt: payload.endAt,
        content: contentOf(payload),
      }),
    }),
  );

/**
 * PUT /api/campaigns/:id — 已發布的活動只能改名稱/描述/結束時間/圖片
 *（頁面 `locked` 邏輯已限制不可編輯欄位不會被送出；後端本身允許改
 * PUBLISHED/PAUSED，只擋 ENDED）。ENDED 後端回 409，這裡的 mock 分支照做同樣的擋法。
 */
export const updateCampaign = (id: string, payload: CampaignFormPayload) =>
  adapt<void>(
    () => {
      const store = getMockCampaignStore()[MOCK_MODE];
      const item = store.find((c) => c.id === id);
      if (!item) throw new ApiError('找不到此活動', 'NOT_FOUND', 404);
      if (item.status === 'ENDED') throw new ApiError('活動已結束，無法編輯', 'CONFLICT', 409);
      item.name = payload.name;
      if (payload.keyword !== undefined) item.keyword = payload.keyword;
      item.description = payload.description;
      item.endAt = payload.endAt;
      item.imageUrl = payload.imageUrl;
      if (item.status === 'DRAFT') {
        item.type = payload.type;
        item.startAt = payload.startAt;
        item.pushMessage = payload.pushMessage;
        item.couponId = payload.couponId;
        item.bonusPoints = payload.bonusPoints;
        item.thresholdAmount = payload.thresholdAmount;
        item.recallDays = payload.recallDays;
        item.isAutoTrigger = payload.isAutoTrigger;
      }
    },
    () => request<void>(`/api/campaigns/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: payload.name,
        keyword: payload.keyword,
        endAt: payload.endAt,
        content: contentOf(payload),
      }),
    }),
  );

/**
 * DELETE /api/campaigns/:id — ⛔ 後端沒有這個路由（`[id]/route.ts` 只有
 * PUT），這是後端缺口，不是本次施工範圍（邊界禁止改 src/app/api/**）。
 * mock 分支照常刪除，讓骨架模式的刪除流程可用；真實分支仍然照樣呼叫這個
 * 端點，失敗時把後端回的真實錯誤（Next.js 405）顯示給使用者，不假裝成功。
 */
export const deleteCampaign = (id: string) =>
  adapt<void>(
    () => {
      const store = getMockCampaignStore()[MOCK_MODE];
      const idx = store.findIndex((c) => c.id === id);
      if (idx === -1) throw new ApiError('找不到此活動', 'NOT_FOUND', 404);
      store.splice(idx, 1);
    },
    () => request<void>(`/api/campaigns/${id}`, { method: 'DELETE' }),
  );

function transition(
  id: string,
  from: Campaign['status'][],
  to: Campaign['status'],
  path: string,
) {
  return adapt<void>(
    () => {
      const store = getMockCampaignStore()[MOCK_MODE];
      const item = store.find((c) => c.id === id);
      if (!item) throw new ApiError('找不到此活動', 'NOT_FOUND', 404);
      if (!from.includes(item.status)) {
        throw new ApiError('此活動狀態已變更，請重新整理', 'CONFLICT', 409);
      }
      item.status = to;
    },
    () => request<void>(path, { method: 'POST' }),
  );
}

/** POST /api/campaigns/:id/publish — DRAFT→PUBLISHED。 */
export const publishCampaign = (id: string) => transition(id, ['DRAFT'], 'PUBLISHED', `/api/campaigns/${id}/publish`);

/** POST /api/campaigns/:id/pause — PUBLISHED→PAUSED。 */
export const pauseCampaign = (id: string) => transition(id, ['PUBLISHED'], 'PAUSED', `/api/campaigns/${id}/pause`);

/** POST /api/campaigns/:id/resume — PAUSED→PUBLISHED。 */
export const resumeCampaign = (id: string) => transition(id, ['PAUSED'], 'PUBLISHED', `/api/campaigns/${id}/resume`);

/** POST /api/campaigns/:id/end — PUBLISHED/PAUSED→ENDED（終態）。 */
export const endCampaign = (id: string) => transition(id, ['PUBLISHED', 'PAUSED'], 'ENDED', `/api/campaigns/${id}/end`);
