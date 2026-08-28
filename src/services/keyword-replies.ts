import { adapt, request } from '@/lib/api';
import type { KeywordReplyImageStorageRef } from '@/lib/types';
import { byMode } from '@/mock';

/**
 * 關鍵字回覆（/tenant/keyword-replies）的資料進出口。
 * -----------------------------------------------------------------------------
 * 端點：`/api/settings/line/keyword-replies`（GET/POST）與 `/[id]`（PUT/DELETE），
 * 資料表 `keyword_replies`（0005 migration）。
 *
 * ⚠️ 這一層存在的理由（14 分冊 §1 根因 A）：頁面原本整頁 CRUD 都只有 setState +
 * 「已儲存」toast，端點與 webhook 分支 ②（src/server/line-events.ts）明明都在跑，
 * 店家設好的關鍵字卻永遠進不了 DB —— 顧客在 LINE 打那個字一輩子不會有回應。
 *
 * 欄位對應（後端只認 keywords/reply_type/content/active，展示欄位一律打包進 content）：
 *   keyword      → keywords[0]（本頁一列一個關鍵字）
 *   replyText    → content.text  ← **webhook 讀的就是這個鍵**
 *                  （src/server/line-events.ts keywordReplyMessage 相容 text/replyText）
 *   matchType    → content.matchType（EXACT 完全相同 / CONTAINS 含此字，webhook 兩種都比對）
 *   actionType / imageUrl / linkUrl / linkLabel / overridesSystem → content 同名鍵
 *   enabled      → active
 */

export type KeywordMatchType = 'EXACT' | 'CONTAINS';
export type KeywordActionType = 'REPLY_CONTENT' | 'START_PROFILE_COLLECTION';

/** 頁面用的一列（原站 /api/settings/line/keyword-replies 的自訂關鍵字結構） */
export interface KeywordReplyRow {
  id: string;
  keyword: string;
  matchType: KeywordMatchType;
  actionType: KeywordActionType;
  replyText: string;
  imageUrl: string;
  imageStorageRef?: KeywordReplyImageStorageRef;
  linkUrl: string;
  linkLabel: string;
  enabled: boolean;
  /** 取代了哪一個系統內建關鍵字（空字串＝沒有取代） */
  overridesSystem: string;
}

/** 端點回傳的原始列 */
interface KeywordReplyApiRow {
  id: string;
  keywords: string[];
  replyType: string;
  content: Record<string, unknown>;
  active: boolean;
  sortOrder: number;
}

/** 寫入端點的 body（POST 全欄、PUT 可局部） */
export interface KeywordReplyPayload {
  keywords: string[];
  replyType: 'TEXT' | 'IMAGE' | 'FLEX';
  content: Record<string, unknown>;
  active: boolean;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 頁面列 → 端點 body。webhook 讀 content.text 與 content.matchType，鍵名不可改。 */
export function toApiPayload(row: Omit<KeywordReplyRow, 'id'>): KeywordReplyPayload {
  return {
    keywords: [row.keyword.trim()],
    replyType: row.imageUrl ? 'IMAGE' : 'TEXT',
    content: {
      text: row.replyText,
      matchType: row.matchType,
      actionType: row.actionType,
      imageUrl: row.imageUrl,
      ...(row.imageStorageRef ? { imageStorageRef: row.imageStorageRef } : {}),
      linkUrl: row.linkUrl,
      linkLabel: row.linkLabel,
      overridesSystem: row.overridesSystem,
    },
    active: row.enabled,
  };
}

/** 端點列 → 頁面列 */
export function fromApiRow(r: KeywordReplyApiRow): KeywordReplyRow {
  const c = r.content ?? {};
  return {
    id: r.id,
    keyword: r.keywords?.[0] ?? '',
    matchType: str(c.matchType) === 'EXACT' ? 'EXACT' : 'CONTAINS',
    actionType:
      str(c.actionType) === 'START_PROFILE_COLLECTION' ? 'START_PROFILE_COLLECTION' : 'REPLY_CONTENT',
    replyText: str(c.text) || str(c.replyText),
    imageUrl: str(c.imageUrl),
    imageStorageRef: isKeywordReplyImageRef(c.imageStorageRef) ? c.imageStorageRef : undefined,
    linkUrl: str(c.linkUrl),
    linkLabel: str(c.linkLabel),
    enabled: !!r.active,
    overridesSystem: str(c.overridesSystem),
  };
}

function isKeywordReplyImageRef(value: unknown): value is NonNullable<KeywordReplyRow['imageStorageRef']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const ref = value as Record<string, unknown>;
  return ref.bucket === 'keyword-reply-images'
    && typeof ref.path === 'string' && typeof ref.url === 'string';
}

/**
 * 骨架模式的示範資料。
 * 三種業態各自一份 —— 沙龍的「停車」跟嚮導的「集合地點」不是同一件事，
 * 共用一份會讓示範店家講出別的行業的話（CLAUDE.md「mode-aware mock data」）。
 * 必須在 callback 內呼叫 byMode()，模組載入時 MOCK_MODE 還沒被 AppShell 設定。
 */
const mockRows = (): KeywordReplyRow[] =>
  byMode<KeywordReplyRow[]>({
    LOCAL_SHOP: [
      {
        id: 'kw_1', keyword: '停車', matchType: 'CONTAINS', actionType: 'REPLY_CONTENT',
        replyText: '店門口有 3 個機車位，汽車可停巷口的收費停車場（每小時 30 元）。',
        imageUrl: '', linkUrl: '', linkLabel: '', enabled: true, overridesSystem: '',
      },
      {
        id: 'kw_2', keyword: '價格', matchType: 'CONTAINS', actionType: 'REPLY_CONTENT',
        replyText: '您好！剪髮 NT$600 起、染髮 NT$2,200 起，燙髮視髮長報價 😊',
        imageUrl: '', linkUrl: 'https://example.com/price', linkLabel: '查看更多',
        enabled: true, overridesSystem: '',
      },
      {
        id: 'kw_3', keyword: '會員', matchType: 'EXACT', actionType: 'REPLY_CONTENT',
        replyText: '會員消費一次累積 1 點，滿 10 點折抵 300 元。',
        imageUrl: '', linkUrl: '', linkLabel: '', enabled: false, overridesSystem: '會員',
      },
    ],
    GUIDE: [
      {
        id: 'kw_1', keyword: '集合地點', matchType: 'CONTAINS', actionType: 'REPLY_CONTENT',
        replyText: '所有行程統一在南方澳漁港遊客中心前集合，出發前一天會再傳一次定位給您。',
        imageUrl: '', linkUrl: '', linkLabel: '', enabled: true, overridesSystem: '',
      },
      {
        id: 'kw_2', keyword: '裝備', matchType: 'CONTAINS', actionType: 'REPLY_CONTENT',
        replyText: '獨木舟與救生衣由我們準備，請自備防曬、換洗衣物與飲用水 🛶',
        imageUrl: '', linkUrl: 'https://example.com/gear', linkLabel: '裝備清單',
        enabled: true, overridesSystem: '',
      },
      {
        id: 'kw_3', keyword: '會員', matchType: 'EXACT', actionType: 'REPLY_CONTENT',
        replyText: '老團員回訪每人折 200 元，報名時報上您的手機號碼即可。',
        imageUrl: '', linkUrl: '', linkLabel: '', enabled: false, overridesSystem: '會員',
      },
    ],
    CLINIC: [
      {
        id: 'kw_1', keyword: '健保', matchType: 'CONTAINS', actionType: 'REPLY_CONTENT',
        replyText: '本院為健保特約診所，初診請攜帶健保卡與身分證件。',
        imageUrl: '', linkUrl: '', linkLabel: '', enabled: true, overridesSystem: '',
      },
      {
        id: 'kw_2', keyword: '自費', matchType: 'CONTAINS', actionType: 'REPLY_CONTENT',
        replyText: '自費項目（雷射、營養針等）費用請洽櫃檯，或點下方連結查看價目表。',
        imageUrl: '', linkUrl: 'https://example.com/fee', linkLabel: '自費價目表',
        enabled: true, overridesSystem: '',
      },
      {
        id: 'kw_3', keyword: '會員', matchType: 'EXACT', actionType: 'REPLY_CONTENT',
        replyText: '本院採會員回診提醒制，留下手機號碼即可收到回診通知。',
        imageUrl: '', linkUrl: '', linkLabel: '', enabled: false, overridesSystem: '會員',
      },
    ],
  });

/** GET /api/settings/line/keyword-replies */
export const listKeywordReplies = () =>
  adapt<KeywordReplyRow[]>(
    () => mockRows(),
    async () => (await request<KeywordReplyApiRow[]>('/api/settings/line/keyword-replies')).map(fromApiRow),
  );

let nextMockKeywordId = 1;

/** POST /api/settings/line/keyword-replies（409「每店最多 20 組」、403 FEAT_001 由呼叫端顯示） */
export const createKeywordReply = (row: Omit<KeywordReplyRow, 'id'>) =>
  adapt<{ id: string }>(
    () => ({ id: `kw_new_${nextMockKeywordId++}` }),
    () => request<{ id: string }>('/api/settings/line/keyword-replies', {
      method: 'POST',
      body: JSON.stringify(toApiPayload(row)),
    }),
  );

/** PUT /api/settings/line/keyword-replies/:id */
export const updateKeywordReply = (id: string, row: Omit<KeywordReplyRow, 'id'>) =>
  adapt<void>(
    () => undefined,
    () => request<void>(`/api/settings/line/keyword-replies/${id}`, {
      method: 'PUT',
      body: JSON.stringify(toApiPayload(row)),
    }),
  );

/** PUT /api/settings/line/keyword-replies/:id —— 只切啟用狀態 */
export const setKeywordReplyActive = (id: string, active: boolean) =>
  adapt<void>(
    () => undefined,
    () => request<void>(`/api/settings/line/keyword-replies/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ active }),
    }),
  );

/** DELETE /api/settings/line/keyword-replies/:id */
export const deleteKeywordReply = (id: string) =>
  adapt<void>(
    () => undefined,
    () => request<void>(`/api/settings/line/keyword-replies/${id}`, { method: 'DELETE' }),
  );

/** 取消尚未寫入 keyword_replies 的選檔，避免隨機 UUID 物件成為孤兒。 */
export const discardKeywordReplyImage = (storageRef: KeywordReplyImageStorageRef) =>
  request<void>('/api/settings/line/keyword-replies/image', {
    method: 'DELETE',
    body: JSON.stringify({ storageRef }),
  });
