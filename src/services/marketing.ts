import { adapt, request } from '@/lib/api';
import { byMode } from '@/mock';

/**
 * 行銷推播（/tenant/marketing）service —— 04 分冊 §B-5、issue #7 (乙)。
 *
 * 這一頁先前**完全沒有 service 包裝**：`/api/marketing/pushes*` 四支端點都在，
 * 頁面卻只有 `await new Promise((r) => setTimeout(r, 380))` 加一句成功 toast——
 * 「推播已開始發送」印出來的當下，LINE 一則訊息都沒送出去（14 分冊 §1、
 * CLAUDE.md「成功 toast 是一項事實主張」）。本檔把頁面接到端點上。
 *
 * 端點對照：
 *   list   GET    /api/marketing/pushes
 *   create POST   /api/marketing/pushes
 *   update PUT    /api/marketing/pushes/:id
 *   remove DELETE /api/marketing/pushes/:id
 *   send   POST   /api/marketing/pushes/:id/send    （真的 multicast、真的扣推播額度）
 *   cancel POST   /api/marketing/pushes/:id/cancel  （SCHEDULED → CANCELLED）
 *
 * mock 分支（NEXT_PUBLIC_USE_MOCK=true 或示範店家）：假資料自 page.tsx 原封搬入
 * （三種業態各一組、id 序共用），寫入類函式一律 no-op，行為與先前純本地版一致。
 */

/** 頁面顯示用的狀態。後端狀態機的 `SENT` 對應這裡的 `COMPLETED`（原站表格用語）。 */
export type PushStatus =
  | 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type PushTargetType = 'ALL' | 'MEMBERSHIP_LEVEL' | 'TAG' | 'CUSTOM';

export type MarketingPush = {
  id: string;
  title: string;
  content: string;
  targetType: PushTargetType;
  /** MEMBERSHIP_LEVEL 時為會員等級 id；TAG 時為標籤名稱；CUSTOM 時為 LINE User ID 清單 */
  targetValue: string;
  targetLabel: string;
  /**
   * 預估收件人數。
   *
   * ⚠️ **真實模式一律是 `null`＝「還不知道」，不是 0**。`/api/marketing/pushes`
   * 沒有這個欄位，平台也沒有「試算受眾」端點——真正的收件名單是
   * `/api/marketing/pushes/:id/send` 在發送當下才由 line_users ∩ customers 算出來的。
   * 在這裡填一個貌似合理的數字，就是 CLAUDE.md 點名的「捏造的已知」（假值與
   * 真值並排，畫面上分不出來）。頁面拿到 null 必須顯示「--」而不是 0 人。
   */
  estimatedCount: number | null;
  /** 後端 `sent_count`。尚未發送時為 0——這是後端真的存著的值，不是推測。 */
  sentCount: number;
  /**
   * 失敗筆數。**真實模式一律 `null`**：`marketing_pushes` 沒有這個欄位，
   * send 端點的 multicast 是「整批成功、或整批失敗（狀態轉 FAILED）」，
   * 逐筆失敗數從來沒有被記錄過。mock 有假值。
   */
  failedCount: number | null;
  status: PushStatus;
  imageUrl: string;
  scheduledAt: string | null;
  sentAt: string | null;
  note: string;
  createdAt: string;
};

/** GET /api/marketing/pushes 的原始回應列（欄位對應見該 route 的 mapPush） */
type RawPush = {
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

const TARGET_TYPES: PushTargetType[] = ['ALL', 'MEMBERSHIP_LEVEL', 'TAG', 'CUSTOM'];

const toPush = (r: RawPush): MarketingPush => ({
  id: r.id,
  title: r.title,
  content: r.content,
  targetType: (TARGET_TYPES as string[]).includes(r.targetType)
    ? (r.targetType as PushTargetType)
    : 'ALL',
  targetValue: r.targetValue,
  targetLabel: r.targetLabel,
  estimatedCount: null,
  sentCount: r.sentCount ?? 0,
  failedCount: null,
  // 後端狀態機用 SENT，原站表格用「已完成」＝COMPLETED；其餘同名直通。
  status: (r.status === 'SENT' ? 'COMPLETED' : r.status) as PushStatus,
  imageUrl: r.imageUrl,
  scheduledAt: r.scheduledAt,
  sentAt: r.sentAt,
  note: r.note,
  createdAt: r.createdAt,
});

/* ------------------------------------------------- mock 假資料（自頁面搬入） */

const PUSHES_LOCAL_SHOP: MarketingPush[] = [
  {
    id: 'mp_1', title: '本週特惠活動通知',
    content: '本週來店指定設計師洗剪只要 499，名額有限，快來 LINE 預約！',
    targetType: 'ALL', targetValue: '', targetLabel: '',
    estimatedCount: 246, sentCount: 0, failedCount: 0,
    status: 'DRAFT', imageUrl: '', scheduledAt: null, sentAt: null,
    note: '待確認文案', createdAt: '2026-08-20T09:30:00+08:00',
  },
  {
    id: 'mp_2', title: '中秋公休公告',
    content: '9/25～9/27 中秋連假公休，造成不便敬請見諒。',
    targetType: 'ALL', targetValue: '', targetLabel: '',
    estimatedCount: 246, sentCount: 0, failedCount: 0,
    status: 'SCHEDULED', imageUrl: '', scheduledAt: '2026-09-18T10:00:00+08:00',
    sentAt: null, note: '', createdAt: '2026-08-18T14:12:00+08:00',
  },
  {
    id: 'mp_3', title: '鑽石卡限定：秋季護髮 8 折',
    content: '親愛的鑽石卡會員，本季護髮課程享 8 折，回覆「護髮」即可預約。',
    targetType: 'MEMBERSHIP_LEVEL', targetValue: 'ml_3', targetLabel: '鑽石卡',
    estimatedCount: 18, sentCount: 0, failedCount: 0,
    status: 'SENDING', imageUrl: '', scheduledAt: null, sentAt: null,
    note: '', createdAt: '2026-08-19T08:05:00+08:00',
  },
  {
    id: 'mp_4', title: '新品上架：修護洗髮精',
    content: '沙龍級修護洗髮精開賣，前 30 名下單享 9 折。',
    targetType: 'ALL', targetValue: '', targetLabel: '',
    estimatedCount: 240, sentCount: 238, failedCount: 2,
    status: 'COMPLETED', imageUrl: 'https://example.com/image.jpg',
    scheduledAt: null, sentAt: '2026-08-12T11:00:00+08:00',
    note: '', createdAt: '2026-08-12T10:40:00+08:00',
  },
  {
    id: 'mp_5', title: '限時優惠：指定名單回饋',
    content: '感謝您長期支持，出示此訊息即可折抵 200 元。',
    targetType: 'CUSTOM', targetValue: 'U1234567890abcdef\nU0987654321fedcba',
    targetLabel: '', estimatedCount: 2, sentCount: 0, failedCount: 2,
    status: 'FAILED', imageUrl: '', scheduledAt: null,
    sentAt: '2026-08-08T19:20:00+08:00', note: '額度不足', createdAt: '2026-08-08T19:00:00+08:00',
  },
  {
    id: 'mp_6', title: '父親節問候',
    content: '祝所有爸爸節日快樂！本週來店贈送造型服務一次。',
    targetType: 'TAG', targetValue: '熟客', targetLabel: '熟客',
    estimatedCount: 42, sentCount: 0, failedCount: 0,
    status: 'CANCELLED', imageUrl: '', scheduledAt: '2026-08-08T09:00:00+08:00',
    sentAt: null, note: '改用行銷活動發送', createdAt: '2026-08-05T16:30:00+08:00',
  },
];

const PUSHES_GUIDE: MarketingPush[] = [
  {
    id: 'mp_g1', title: '9 月賞鯨團次開賣',
    content: '9 月團次開放報名囉！出團前 30 天報名享 9 折，週末場次每次都秒殺 🐬',
    targetType: 'ALL', targetValue: '', targetLabel: '',
    estimatedCount: 412, sentCount: 0, failedCount: 0,
    status: 'DRAFT', imageUrl: '', scheduledAt: null, sentAt: null,
    note: '等封面照確認', createdAt: '2026-08-20T09:30:00+08:00',
  },
  {
    id: 'mp_g2', title: '颱風備案通知',
    content: '本週有颱風接近，8/23 前的團次將於出團前一日 18:00 前發送最終確認，如取消全額退費。',
    targetType: 'CUSTOM', targetValue: 'U901\nU902\nU905', targetLabel: '',
    estimatedCount: 34, sentCount: 0, failedCount: 0,
    status: 'SCHEDULED', imageUrl: '', scheduledAt: '2026-08-22T18:00:00+08:00',
    sentAt: null, note: '只發近期出團的旅客', createdAt: '2026-08-20T11:05:00+08:00',
  },
  {
    id: 'mp_g3', title: '祕島之友限定：新路線先行報名',
    content: '新開的太魯閣秘境路線，先開放祕島之友報名，回覆「新路線」了解詳情。',
    targetType: 'MEMBERSHIP_LEVEL', targetValue: 'ml_3', targetLabel: '祕島之友',
    estimatedCount: 20, sentCount: 0, failedCount: 0,
    status: 'SENDING', imageUrl: '', scheduledAt: null, sentAt: null,
    note: '', createdAt: '2026-08-19T08:05:00+08:00',
  },
  {
    id: 'mp_g4', title: '溯溪季倒數',
    content: '溯溪季只到 10/15，還沒體驗過的旅人把握最後檔期！',
    targetType: 'TAG', targetValue: '溯溪', targetLabel: '溯溪',
    estimatedCount: 96, sentCount: 94, failedCount: 2,
    status: 'COMPLETED', imageUrl: 'https://example.com/river.jpg',
    scheduledAt: null, sentAt: '2026-08-12T11:00:00+08:00',
    note: '', createdAt: '2026-08-12T10:40:00+08:00',
  },
  {
    id: 'mp_g5', title: '推播額度提醒測試',
    content: '本月推播額度即將用完，測試發送。',
    targetType: 'ALL', targetValue: '', targetLabel: '',
    estimatedCount: 412, sentCount: 0, failedCount: 412,
    status: 'FAILED', imageUrl: '', scheduledAt: null,
    sentAt: '2026-08-10T19:20:00+08:00', note: '推播額度不足（168/200）', createdAt: '2026-08-10T19:00:00+08:00',
  },
];

const PUSHES_CLINIC: MarketingPush[] = [
  {
    id: 'mp_c1', title: '流感疫苗開打通知',
    content: '本院流感疫苗已到貨，公費對象請攜帶健保卡，線上可預約看診號碼。',
    targetType: 'ALL', targetValue: '', targetLabel: '',
    estimatedCount: 1864, sentCount: 0, failedCount: 0,
    status: 'SCHEDULED', imageUrl: '', scheduledAt: '2026-08-25T10:00:00+08:00',
    sentAt: null, note: '分批發送避免當日湧入', createdAt: '2026-08-18T14:12:00+08:00',
  },
  {
    id: 'mp_c2', title: '中秋連假休診公告',
    content: '9/25～9/27 中秋連假休診，急診請至鄰近醫院，造成不便敬請見諒。',
    targetType: 'ALL', targetValue: '', targetLabel: '',
    estimatedCount: 1864, sentCount: 0, failedCount: 0,
    status: 'DRAFT', imageUrl: '', scheduledAt: null, sentAt: null,
    note: '', createdAt: '2026-08-20T09:00:00+08:00',
  },
  {
    id: 'mp_c3', title: '年度健檢提醒',
    content: '距離您上次健檢已滿一年，現在預約享早鳥折 800，名額有限。',
    targetType: 'MEMBERSHIP_LEVEL', targetValue: 'ml_3', targetLabel: 'VIP 健檢',
    estimatedCount: 46, sentCount: 46, failedCount: 0,
    status: 'COMPLETED', imageUrl: '', scheduledAt: null,
    sentAt: '2026-08-14T09:00:00+08:00', note: '', createdAt: '2026-08-14T08:30:00+08:00',
  },
];

/** mock 新增推播的流水號（頁面在 mock 模式下不會真的看到新列，重載即回原樣） */
let mockSeq = 1;

/* ----------------------------------------------------------------- 端點 */

/** GET /api/marketing/pushes —— 全量，created_at desc */
export const listPushes = () =>
  adapt<MarketingPush[]>(
    () => byMode({ LOCAL_SHOP: PUSHES_LOCAL_SHOP, GUIDE: PUSHES_GUIDE, CLINIC: PUSHES_CLINIC }),
    async () => (await request<RawPush[]>('/api/marketing/pushes')).map(toPush),
  );

/** POST /api/marketing/pushes、PUT :id 接受的欄位 */
export type PushPayload = {
  title: string;
  content?: string;
  imageUrl?: string;
  note?: string;
  targetType?: PushTargetType;
  targetValue?: string;
  targetLabel?: string;
  /** ISO 8601 帶時區；`null` = 清空排程（狀態回 DRAFT），有值 = SCHEDULED */
  scheduledAt?: string | null;
};

export const createPush = (payload: PushPayload) =>
  adapt<{ id: string }>(
    () => ({ id: `mp_new_${mockSeq++}` }),
    () => request<{ id: string }>('/api/marketing/pushes', {
      method: 'POST', body: JSON.stringify(payload),
    }),
  );

/** 僅 DRAFT / SCHEDULED 可編輯，其餘後端回 409（訊息由頁面 toast 原樣顯示） */
export const updatePush = (id: string, payload: Partial<PushPayload>) =>
  adapt<void>(
    () => undefined,
    () => request<void>(`/api/marketing/pushes/${id}`, {
      method: 'PUT', body: JSON.stringify(payload),
    }),
  );

/** 已發送（SENT）的推播後端保留歷史不可刪，回 409 */
export const deletePush = (id: string) =>
  adapt<void>(
    () => undefined,
    () => request<void>(`/api/marketing/pushes/${id}`, { method: 'DELETE' }),
  );

/**
 * 立即發送。**這支會真的打 LINE multicast 並扣掉推播額度**，回傳實際送出的人數。
 * 額度不足 / 沒有符合條件的收件人 → 後端回 409 並還原原狀態，一則都不會送出。
 */
export const sendPush = (id: string) =>
  adapt<{ sentCount: number }>(
    () => ({ sentCount: 0 }),
    () => request<{ sentCount: number }>(`/api/marketing/pushes/${id}/send`, { method: 'POST' }),
  );

/** SCHEDULED → CANCELLED；其他狀態後端回 409 */
export const cancelPush = (id: string) =>
  adapt<void>(
    () => undefined,
    () => request<void>(`/api/marketing/pushes/${id}/cancel`, { method: 'POST' }),
  );
