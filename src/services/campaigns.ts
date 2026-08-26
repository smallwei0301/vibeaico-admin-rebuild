import { adapt, request } from '@/lib/api';
import { byMode } from '@/mock';

/**
 * 行銷活動（/tenant/campaigns）service —— 04 分冊 §B-5、issue #7 (乙)。
 *
 * 這一頁先前**完全沒有 service 包裝**：`/api/campaigns*` 六支端點都在，頁面卻只有
 * `await new Promise((r) => setTimeout(r, 380))` 加一句成功 toast——「活動已發布」
 * 印出來的當下，資料庫的 status 還是 DRAFT，顧客在 LINE 打關鍵字什麼都收不到
 * （14 分冊 §1、CLAUDE.md「成功 toast 是一項事實主張」）。本檔把頁面接到端點上。
 *
 * 端點對照：
 *   list    GET    /api/campaigns
 *   create  POST   /api/campaigns
 *   update  PUT    /api/campaigns/:id            （ENDED 後不可編輯，409）
 *   remove  DELETE /api/campaigns/:id
 *   publish POST   /api/campaigns/:id/publish    DRAFT           → PUBLISHED
 *   pause   POST   /api/campaigns/:id/pause      PUBLISHED       → PAUSED
 *   resume  POST   /api/campaigns/:id/resume     PAUSED          → PUBLISHED
 *   end     POST   /api/campaigns/:id/end        PUBLISHED/PAUSED→ ENDED（終態）
 *
 * ⚠️ **PUBLISHED 不只是一個欄位值**：`src/server/line-events.ts` 只把
 * `status='PUBLISHED'` 的活動回給顧客——關鍵字命中（③ campaigns，比對 `keyword`
 * 欄位）與內建「活動」指令（replyCampaigns，列出全部 PUBLISHED）都是。所以
 * 「發布」這個按鈕的副作用是**顧客在 LINE 看得到這筆活動**，不是畫面上的一個徽章。
 *
 * mock 分支（NEXT_PUBLIC_USE_MOCK=true 或示範店家）：假資料自 page.tsx 原封搬入
 * （三種業態各一組、id 序共用），寫入類函式一律 no-op，行為與先前純本地版一致。
 */

/**
 * 頁面顯示用的狀態，**五態**（原站徽章：草稿／已排程／進行中／已暫停／已結束，
 * 見 docs/specs/campaigns.json 的 badges）。資料庫只有四態，差在 SCHEDULED：
 *
 *   DB DRAFT              → DRAFT
 *   DB PUBLISHED + 開始時間還沒到 → SCHEDULED
 *   DB PUBLISHED + 已開始／未設開始時間 → ACTIVE
 *   DB PAUSED             → PAUSED
 *   DB ENDED              → ENDED
 *
 * SCHEDULED 是**由 start_at 算出來的**，不是猜的：它與 ACTIVE 對應同一個 DB 狀態，
 * 因此兩者都能按「暫停」（後端 pause 收 PUBLISHED），行為一致。
 */
export type CampaignStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'ENDED';

export type CampaignType =
  | 'BIRTHDAY' | 'NEW_CUSTOMER' | 'SPENDING_THRESHOLD'
  | 'LIMITED_TIME' | 'RECALL' | 'REFERRAL';

export type Campaign = {
  id: string;
  name: string;
  description: string;
  type: CampaignType;
  status: CampaignStatus;
  startAt: string | null;
  endAt: string | null;
  /**
   * 推播文案。存進 `content.text`——**那正是 webhook 回給顧客的那段字**
   * （line-events.ts 的關鍵字分支與 replyCampaigns 都讀 `content.text`，沒有就退回
   * 活動名稱）。所以這個欄位不是純展示，改它會改變顧客收到的內容。
   */
  pushMessage: string;
  couponId: string | null;
  couponName: string | null;
  bonusPoints: number;
  thresholdAmount: number | null;
  recallDays: number | null;
  isAutoTrigger: boolean;
  /**
   * 參與人數。
   *
   * ⚠️ **真實模式一律 `null`＝「還不知道」，不是 0**。`campaigns` 表沒有這個欄位，
   * 也沒有任何一張表把「顧客參加了哪個活動」記下來（自動觸發的發放走的是票券
   * 與點數，沒有回指活動）。填 0 會讓「沒有人參加」和「我們沒有在算」長得一模一樣
   * ——CLAUDE.md 點名的「捏造的已知」。頁面拿到 null 必須顯示「--」。
   */
  participantCount: number | null;
  imageUrl: string;
  createdAt: string;
};

/** GET /api/campaigns 的原始回應列（欄位對應見該 route 的 mapCampaign） */
type RawCampaign = {
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

const CAMPAIGN_TYPES: CampaignType[] = [
  'BIRTHDAY', 'NEW_CUSTOMER', 'SPENDING_THRESHOLD', 'LIMITED_TIME', 'RECALL', 'REFERRAL',
];

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** DB 四態 → 頁面五態（SCHEDULED 由 start_at 現算，見 CampaignStatus 說明） */
export function displayStatus(dbStatus: string, startAt: string | null): CampaignStatus {
  if (dbStatus === 'PAUSED') return 'PAUSED';
  if (dbStatus === 'ENDED') return 'ENDED';
  if (dbStatus !== 'PUBLISHED') return 'DRAFT';
  if (startAt && Date.parse(startAt) > Date.now()) return 'SCHEDULED';
  return 'ACTIVE';
}

const toCampaign = (r: RawCampaign): Campaign => {
  const c = r.content ?? {};
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    type: (CAMPAIGN_TYPES as string[]).includes(r.type) ? (r.type as CampaignType) : 'LIMITED_TIME',
    status: displayStatus(r.status, r.startAt),
    startAt: r.startAt,
    endAt: r.endAt,
    pushMessage: str(c.text),
    couponId: str(c.couponId) || null,
    couponName: str(c.couponName) || null,
    bonusPoints: num(c.bonusPoints),
    thresholdAmount: numOrNull(c.thresholdAmount),
    recallDays: numOrNull(c.recallDays),
    isAutoTrigger: c.isAutoTrigger === true,
    participantCount: null,
    imageUrl: str(c.imageUrl),
    createdAt: r.createdAt,
  };
};

/* ------------------------------------------------- mock 假資料（自頁面搬入） */

const CAMPAIGNS_LOCAL_SHOP: Campaign[] = [
  {
    id: 'cm_1', name: '生日祝福', description: '生日當月來店即贈護髮體驗。',
    type: 'BIRTHDAY', status: 'ACTIVE', startAt: '2026-01-01T00:00:00+08:00', endAt: null,
    pushMessage: '生日快樂！本月來店即可領取專屬生日禮，期待與你見面 🎂',
    couponId: 'cp_3', couponName: '生日禮：免費瀏海修剪', bonusPoints: 100,
    thresholdAmount: null, recallDays: null, isAutoTrigger: true,
    participantCount: 38, imageUrl: '', createdAt: '2025-12-20T10:00:00+08:00',
  },
  {
    id: 'cm_2', name: '新春限時優惠', description: '春節期間全店服務 9 折。',
    type: 'LIMITED_TIME', status: 'SCHEDULED',
    startAt: '2026-09-01T00:00:00+08:00', endAt: '2026-09-30T23:59:00+08:00',
    pushMessage: '新春限時：全店服務 9 折，只到 9/30！',
    couponId: 'cp_1', couponName: '新客體驗 8 折', bonusPoints: 0,
    thresholdAmount: null, recallDays: null, isAutoTrigger: false,
    participantCount: 0, imageUrl: '', createdAt: '2026-08-15T09:20:00+08:00',
  },
  {
    id: 'cm_3', name: '顧客喚回', description: '', type: 'RECALL', status: 'PAUSED',
    startAt: '2026-05-01T00:00:00+08:00', endAt: null,
    pushMessage: '好久不見！回來讓我們幫你整理一下造型吧，出示此訊息折 200。',
    couponId: null, couponName: null, bonusPoints: 200,
    thresholdAmount: null, recallDays: 60, isAutoTrigger: true,
    participantCount: 12, imageUrl: '', createdAt: '2026-04-28T15:40:00+08:00',
  },
  {
    id: 'cm_4', name: '消費滿 2000 送點數', description: '單筆消費滿額回饋。',
    type: 'SPENDING_THRESHOLD', status: 'DRAFT', startAt: null, endAt: null,
    pushMessage: '', couponId: null, couponName: null, bonusPoints: 300,
    thresholdAmount: 2000, recallDays: null, isAutoTrigger: true,
    participantCount: 0, imageUrl: '', createdAt: '2026-08-19T18:05:00+08:00',
  },
  {
    id: 'cm_5', name: '新客首次體驗', description: '首次到店贈 8 折券。',
    type: 'NEW_CUSTOMER', status: 'ENDED',
    startAt: '2026-03-01T00:00:00+08:00', endAt: '2026-06-30T23:59:00+08:00',
    pushMessage: '第一次來？出示這則訊息即可享新客 8 折！',
    couponId: 'cp_1', couponName: '新客體驗 8 折', bonusPoints: 0,
    thresholdAmount: null, recallDays: null, isAutoTrigger: true,
    participantCount: 62, imageUrl: '', createdAt: '2026-02-24T11:10:00+08:00',
  },
];

const CAMPAIGNS_GUIDE: Campaign[] = [
  {
    id: 'cm_g1', name: '早鳥報名回饋', description: '出團前 30 天報名，送 500 點。',
    type: 'LIMITED_TIME', status: 'ACTIVE',
    startAt: '2026-06-01T00:00:00+08:00', endAt: '2026-10-31T23:59:00+08:00',
    pushMessage: '暑期檔期開賣！出團前 30 天報名享 9 折，還送 500 點折抵下次行程 🌊',
    couponId: 'cp_1', couponName: '早鳥報名 9 折', bonusPoints: 500,
    thresholdAmount: null, recallDays: null, isAutoTrigger: false,
    participantCount: 88, imageUrl: '', createdAt: '2026-05-20T10:00:00+08:00',
  },
  {
    id: 'cm_g2', name: '揪團同行折扣', description: '4 人以上同行自動折 500。',
    type: 'SPENDING_THRESHOLD', status: 'ACTIVE', startAt: '2026-07-01T00:00:00+08:00', endAt: null,
    pushMessage: '找朋友一起來！4 人以上同行每筆折 500，人越多越划算 🙌',
    couponId: 'cp_2', couponName: '揪團折 500', bonusPoints: 0,
    thresholdAmount: 5000, recallDays: null, isAutoTrigger: true,
    participantCount: 34, imageUrl: '', createdAt: '2026-06-25T14:30:00+08:00',
  },
  {
    id: 'cm_g3', name: '旅人回訪禮', description: '一年內再次報名贈免費裝備租借。',
    type: 'RECALL', status: 'ACTIVE', startAt: '2026-03-01T00:00:00+08:00', endAt: null,
    pushMessage: '好久不見！最近開了新路線，回訪的旅人享免費裝備租借 🏕',
    couponId: 'cp_3', couponName: '回訪禮：免費裝備租借', bonusPoints: 0,
    thresholdAmount: null, recallDays: 180, isAutoTrigger: true,
    participantCount: 26, imageUrl: '', createdAt: '2026-02-26T09:15:00+08:00',
  },
  {
    id: 'cm_g4', name: '生日出海禮', description: '壽星當月報名任一行程送紀念明信片。',
    type: 'BIRTHDAY', status: 'ACTIVE', startAt: '2026-01-01T00:00:00+08:00', endAt: null,
    pushMessage: '生日快樂！這個月報名任一行程，我們送你一組祕島明信片 🎂',
    couponId: null, couponName: null, bonusPoints: 200,
    thresholdAmount: null, recallDays: null, isAutoTrigger: true,
    participantCount: 17, imageUrl: '', createdAt: '2025-12-28T11:00:00+08:00',
  },
  {
    id: 'cm_g5', name: '賞鯨季開跑', description: '4–9 月賞鯨旺季主打。',
    type: 'LIMITED_TIME', status: 'ENDED',
    startAt: '2026-04-01T00:00:00+08:00', endAt: '2026-08-10T23:59:00+08:00',
    pushMessage: '賞鯨季來了！飛旋海豚出沒率 9 成，週末團次熱賣中 🐬',
    couponId: null, couponName: null, bonusPoints: 0,
    thresholdAmount: null, recallDays: null, isAutoTrigger: false,
    participantCount: 142, imageUrl: '', createdAt: '2026-03-24T16:40:00+08:00',
  },
];

const CAMPAIGNS_CLINIC: Campaign[] = [
  {
    id: 'cm_c1', name: '流感疫苗季提醒', description: '公費疫苗開打通知。',
    type: 'LIMITED_TIME', status: 'ACTIVE',
    startAt: '2026-08-15T00:00:00+08:00', endAt: '2026-12-31T23:59:00+08:00',
    pushMessage: '流感疫苗開打囉！本院已開放線上預約，公費對象免費接種，名額有限。',
    couponId: null, couponName: null, bonusPoints: 0,
    thresholdAmount: null, recallDays: null, isAutoTrigger: false,
    participantCount: 214, imageUrl: '', createdAt: '2026-08-10T09:00:00+08:00',
  },
  {
    id: 'cm_c2', name: '年度健檢回訪', description: '滿一年未健檢者自動提醒。',
    type: 'RECALL', status: 'ACTIVE', startAt: '2026-01-01T00:00:00+08:00', endAt: null,
    pushMessage: '距離您上次健康檢查已滿一年，建議安排今年度檢查，現在預約享早鳥折 800。',
    couponId: 'cp_1', couponName: '健檢早鳥折 800', bonusPoints: 0,
    thresholdAmount: null, recallDays: 365, isAutoTrigger: true,
    participantCount: 96, imageUrl: '', createdAt: '2025-12-30T10:20:00+08:00',
  },
  {
    id: 'cm_c3', name: '慢性病回診提醒', description: '慢性處方箋到期前提醒。',
    type: 'RECALL', status: 'ACTIVE', startAt: '2026-02-01T00:00:00+08:00', endAt: null,
    pushMessage: '提醒您：慢性處方箋即將到期，記得回診由醫師評估後續用藥。',
    couponId: null, couponName: null, bonusPoints: 0,
    thresholdAmount: null, recallDays: 90, isAutoTrigger: true,
    participantCount: 178, imageUrl: '', createdAt: '2026-01-28T15:10:00+08:00',
  },
  {
    id: 'cm_c4', name: '家庭疫苗方案', description: '同戶 3 人以上 9 折。', type: 'SPENDING_THRESHOLD',
    status: 'DRAFT', startAt: null, endAt: null,
    pushMessage: '', couponId: 'cp_2', couponName: '疫苗季家庭方案', bonusPoints: 0,
    thresholdAmount: 2400, recallDays: null, isAutoTrigger: true,
    participantCount: 0, imageUrl: '', createdAt: '2026-08-18T17:30:00+08:00',
  },
];

/** mock 新增活動的流水號 */
let mockSeq = 1;

/* ----------------------------------------------------------------- 端點 */

/** GET /api/campaigns —— 全量，created_at desc */
export const listCampaigns = () =>
  adapt<Campaign[]>(
    () => byMode({
      LOCAL_SHOP: CAMPAIGNS_LOCAL_SHOP, GUIDE: CAMPAIGNS_GUIDE, CLINIC: CAMPAIGNS_CLINIC,
    }),
    async () => (await request<RawCampaign[]>('/api/campaigns')).map(toCampaign),
  );

/**
 * POST /api/campaigns、PUT :id 接受的欄位。
 *
 * `campaigns` 表只有 name / keyword / content jsonb / start_at / end_at / status，
 * 所以頁面表單那些展示欄位（推播文案、票券、點數、門檻…）全部收進 `content`
 * ——route 的 mapCampaign 也是從那裡讀回來的，兩邊是同一份約定。
 */
export type CampaignPayload = {
  name: string;
  description?: string;
  type?: CampaignType;
  /** ISO 8601 帶時區；`null` = 清空 */
  startAt?: string | null;
  endAt?: string | null;
  /** 顧客在 LINE 打這個字會命中這筆活動（line-events.ts ③）；原站表單沒有這欄，一律空字串 */
  keyword?: string;
  pushMessage?: string;
  couponId?: string | null;
  couponName?: string | null;
  bonusPoints?: number;
  thresholdAmount?: number | null;
  recallDays?: number | null;
  isAutoTrigger?: boolean;
  imageUrl?: string;
};

/** 把頁面表單欄位攤成端點吃的形狀（展示欄位進 content jsonb） */
function toBody(p: Partial<CampaignPayload>): Record<string, unknown> {
  const content: Record<string, unknown> = {};
  // `text` 就是顧客會收到的那段字（line-events.ts 讀的欄位），不是另一個展示欄位
  if (p.pushMessage !== undefined) content.text = p.pushMessage;
  if (p.couponId !== undefined) content.couponId = p.couponId ?? '';
  if (p.couponName !== undefined) content.couponName = p.couponName ?? '';
  if (p.bonusPoints !== undefined) content.bonusPoints = p.bonusPoints;
  if (p.thresholdAmount !== undefined) content.thresholdAmount = p.thresholdAmount;
  if (p.recallDays !== undefined) content.recallDays = p.recallDays;
  if (p.isAutoTrigger !== undefined) content.isAutoTrigger = p.isAutoTrigger;
  if (p.imageUrl !== undefined) content.imageUrl = p.imageUrl;

  const body: Record<string, unknown> = { content };
  if (p.name !== undefined) body.name = p.name;
  if (p.description !== undefined) body.description = p.description;
  if (p.type !== undefined) body.type = p.type;
  if (p.keyword !== undefined) body.keyword = p.keyword;
  if (p.startAt !== undefined) body.startAt = p.startAt;
  if (p.endAt !== undefined) body.endAt = p.endAt;
  return body;
}

/** 新增活動；後端一律建成 DRAFT（要顧客看得到必須再按「發布」） */
export const createCampaign = (payload: CampaignPayload) =>
  adapt<{ id: string }>(
    () => ({ id: `cm_new_${mockSeq++}` }),
    () => request<{ id: string }>('/api/campaigns', {
      method: 'POST', body: JSON.stringify(toBody(payload)),
    }),
  );

/** ENDED 後不可編輯，後端回 409（訊息由頁面 toast 原樣顯示） */
export const updateCampaign = (id: string, payload: Partial<CampaignPayload>) =>
  adapt<void>(
    () => undefined,
    () => request<void>(`/api/campaigns/${id}`, {
      method: 'PUT', body: JSON.stringify(toBody(payload)),
    }),
  );

export const deleteCampaign = (id: string) =>
  adapt<void>(
    () => undefined,
    () => request<void>(`/api/campaigns/${id}`, { method: 'DELETE' }),
  );

/* ------------------------------------------------------------ 狀態機 */

/**
 * 發布沒有推播出去時的原因（端點的 PushSkipReason，逐字對應）。
 * 這些**都不是錯誤**——活動已經發布了，只是那一則 LINE 推播沒有送出。
 */
export type CampaignPushSkipReason =
  | 'AUTO_TRIGGER'
  | 'NO_MESSAGE'
  | 'NO_RECIPIENTS'
  | 'LINE_NOT_CONFIGURED'
  | 'QUOTA_EXCEEDED'
  | 'LINE_ERROR';

/**
 * 發布的結果。
 *
 * ⚠️ **`pushed` 一定要看**：頁面不可以一律顯示「LINE 推播已發送」。
 * 發布與推播是兩件會分開發生的事（端點檔頭有完整理由），端點照實回報哪一件
 * 真的發生了，畫面就得照實顯示——這是 14 分冊 §8.6 這一輪要修的核心。
 */
export type CampaignPublishResult = {
  pushed: boolean;
  /** 真的被 multicast 送出去的收件人數 */
  sentCount: number;
  pushSkipReason?: CampaignPushSkipReason;
  /** pushSkipReason==='LINE_ERROR' 時 LINE 回的原文 */
  pushErrorMessage?: string;
};

/**
 * DRAFT → PUBLISHED。副作用有兩個，**兩個都是真的**：
 *   1. 顧客在 LINE 打關鍵字／「活動」就收得到這一筆（line-events.ts 只回 PUBLISHED）。
 *   2. 非「自動觸發」的活動會**立刻 multicast 給本店所有追蹤者**並扣推播額度
 *      （14 分冊 §8.6 擁有者裁決；實作見 /api/campaigns/:id/publish）。
 */
export const publishCampaign = (id: string) =>
  adapt<CampaignPublishResult>(
    // mock 分支沒有 LINE，也沒有額度——照實回「沒有推」，不要假裝推了
    () => ({ pushed: false, sentCount: 0, pushSkipReason: 'LINE_NOT_CONFIGURED' }),
    () => request<CampaignPublishResult>(`/api/campaigns/${id}/publish`, { method: 'POST' }));

/** PUBLISHED → PAUSED。副作用：webhook 立刻不再回這一筆。 */
export const pauseCampaign = (id: string) =>
  adapt<void>(() => undefined,
    () => request<void>(`/api/campaigns/${id}/pause`, { method: 'POST' }));

/** PAUSED → PUBLISHED */
export const resumeCampaign = (id: string) =>
  adapt<void>(() => undefined,
    () => request<void>(`/api/campaigns/${id}/resume`, { method: 'POST' }));

/** PUBLISHED / PAUSED → ENDED（終態，不可再轉出） */
export const endCampaign = (id: string) =>
  adapt<void>(() => undefined,
    () => request<void>(`/api/campaigns/${id}/end`, { method: 'POST' }));
