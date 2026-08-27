import { USE_MOCK } from '@/config/env';
import { adapt, request } from '@/lib/api';
import type { Paged } from '@/lib/types';
import { byMode } from '@/mock';
import { uploadImage } from './upload';

/**
 * 顧客訊息（/tenant/chat）service — 04 分冊 §B-5 / §B-5.1。
 * 鐵則 1（頁面不 fetch）的核准例外頁也一樣走 service：頁面只呼叫這裡的函式，
 * 輪詢規約（5 秒訊息增量、15 秒對話列表、hidden 暫停）全部收在本檔。
 *
 * mock 分支（NEXT_PUBLIC_USE_MOCK=true）：
 * - 假資料自 page.tsx 原封搬入（固定基準時間、三種業態各一組、id 序共用），
 *   行為與先前純本地版完全一致；不寫進 src/mock，避免與其他頁面衝突。
 * - `startPolling()` 直接回 no-op stop，不會啟動計時器，假資料不會被輪詢清掉；
 *   `listMessages({after})` 在 mock 下恆回 []（無副作用）。
 */

/* ----------------------------------------------------------------- 型別 */
/** 對話（real 模式以 lineUserId 為 id；mock 模式沿用 chat_N） */
export type ChatConversation = {
  id: string;
  customerId: string | null;
  customerName: string;
  /** 清單預覽用；type = IMAGE 時顯示「圖片」 */
  lastMessageType: 'TEXT' | 'IMAGE';
  lastMessage: string;
  lastMessageAt: string | null;
  unread: number;
};

export type ChatMessage = {
  id: string;
  from: 'CUSTOMER' | 'SHOP';
  type: 'TEXT' | 'IMAGE';
  text: string;
  imageUrl: string;
  at: string;
  readAt: string | null;
};

export type UnboundLineUser = {
  lineUserId: string;
  displayName: string;
  pictureUrl: string;
  createdAt: string;
};

/** GET /api/chat/conversations 的原始回應列 */
type RawConversation = {
  lineUserId: string;
  displayName: string;
  pictureUrl: string;
  customerId: string | null;
  lastMessageType: string;
  lastMessage: string;
  lastMessageAt: string | null;
  unread: number;
};

/** /api/chat/messages 的原始回應列（route 的 mapMessage 形狀） */
type RawMessage = {
  id: string;
  lineUserId: string;
  direction: 'IN' | 'OUT';
  messageType: string;
  text: string;
  imageUrl: string;
  readAt: string | null;
  createdAt: string;
};

const toConversation = (r: RawConversation): ChatConversation => ({
  id: r.lineUserId,
  customerId: r.customerId,
  customerName: r.displayName,
  lastMessageType: r.lastMessageType === 'IMAGE' ? 'IMAGE' : 'TEXT',
  lastMessage: r.lastMessage,
  lastMessageAt: r.lastMessageAt,
  unread: r.unread,
});

const toMessage = (r: RawMessage): ChatMessage => ({
  id: r.id,
  from: r.direction === 'OUT' ? 'SHOP' : 'CUSTOMER',
  type: r.messageType.toLowerCase() === 'image' ? 'IMAGE' : 'TEXT',
  text: r.text,
  imageUrl: r.imageUrl,
  at: r.createdAt,
  readAt: r.readAt,
});

/* ------------------------------------------------- mock 假資料（自頁面搬入） */
/** 以固定基準時間產生假資料，避免 render 期出現 Date.now() */
const BASE = new Date('2026-08-20T15:00:00+08:00').getTime();
const ago = (minutes: number) => new Date(BASE - minutes * 60_000).toISOString();

const CONV_LOCAL_SHOP: ChatConversation[] = [
  {
    id: 'chat_1', customerId: 'c_1', customerName: '王小明',
    lastMessageType: 'TEXT', lastMessage: '請問這週六下午還有位子嗎？',
    lastMessageAt: ago(3), unread: 2,
  },
  {
    id: 'chat_2', customerId: 'c_4', customerName: '陳雅婷',
    lastMessageType: 'IMAGE', lastMessage: '',
    lastMessageAt: ago(95), unread: 1,
  },
  {
    id: 'chat_3', customerId: 'c_2', customerName: '李美華',
    lastMessageType: 'TEXT', lastMessage: '好的，謝謝！',
    lastMessageAt: ago(60 * 26), unread: 0,
  },
];

const MSG_LOCAL_SHOP: Record<string, ChatMessage[]> = {
  chat_1: [
    { id: 'm_1', from: 'CUSTOMER', type: 'TEXT', text: '你好，我想預約剪髮', imageUrl: '', at: ago(20), readAt: ago(19) },
    { id: 'm_2', from: 'SHOP', type: 'TEXT', text: '您好！請問希望哪一天呢？', imageUrl: '', at: ago(18), readAt: null },
    { id: 'm_3', from: 'CUSTOMER', type: 'TEXT', text: '這週六可以嗎', imageUrl: '', at: ago(5), readAt: null },
    { id: 'm_4', from: 'CUSTOMER', type: 'TEXT', text: '請問這週六下午還有位子嗎？', imageUrl: '', at: ago(3), readAt: null },
  ],
  chat_2: [
    { id: 'm_5', from: 'CUSTOMER', type: 'TEXT', text: '想染成這個顏色', imageUrl: '', at: ago(100), readAt: null },
    { id: 'm_6', from: 'CUSTOMER', type: 'IMAGE', text: '', imageUrl: '', at: ago(95), readAt: null },
  ],
  chat_3: [
    { id: 'm_7', from: 'SHOP', type: 'TEXT', text: '您的預約已確認，週日 15:00 見！', imageUrl: '', at: ago(60 * 27), readAt: null },
    { id: 'm_8', from: 'CUSTOMER', type: 'TEXT', text: '好的，謝謝！', imageUrl: '', at: ago(60 * 26), readAt: ago(60 * 25) },
  ],
};

const CONV_GUIDE: ChatConversation[] = [
  {
    id: 'chat_1', customerId: 'c_1', customerName: '陳彥廷',
    lastMessageType: 'TEXT', lastMessage: '這週六賞鯨還有位子嗎？兩大一小',
    lastMessageAt: ago(4), unread: 2,
  },
  {
    id: 'chat_2', customerId: 'c_4', customerName: '黃思穎',
    lastMessageType: 'TEXT', lastMessage: '溯溪需要自備什麼嗎？',
    lastMessageAt: ago(88), unread: 1,
  },
  {
    id: 'chat_3', customerId: 'c_5', customerName: '張家豪',
    lastMessageType: 'TEXT', lastMessage: '好的，那就麻煩你了！',
    lastMessageAt: ago(60 * 20), unread: 0,
  },
];

const MSG_GUIDE: Record<string, ChatMessage[]> = {
  chat_1: [
    { id: 'm_1', from: 'CUSTOMER', type: 'TEXT', text: '你好，想問龜山島賞鯨', imageUrl: '', at: ago(25), readAt: ago(24) },
    { id: 'm_2', from: 'SHOP', type: 'TEXT', text: '您好！標準團每天 09:00 出發，全程約 3 小時 🐬', imageUrl: '', at: ago(22), readAt: null },
    { id: 'm_3', from: 'CUSTOMER', type: 'TEXT', text: '小孩 6 歲可以參加嗎', imageUrl: '', at: ago(8), readAt: null },
    { id: 'm_4', from: 'CUSTOMER', type: 'TEXT', text: '這週六賞鯨還有位子嗎？兩大一小', imageUrl: '', at: ago(4), readAt: null },
  ],
  chat_2: [
    { id: 'm_5', from: 'SHOP', type: 'TEXT', text: '您的溯溪行程已確認，8/24 08:00 花蓮火車站前集合 🏞', imageUrl: '', at: ago(120), readAt: null },
    { id: 'm_6', from: 'CUSTOMER', type: 'TEXT', text: '溯溪需要自備什麼嗎？', imageUrl: '', at: ago(88), readAt: null },
  ],
  chat_3: [
    { id: 'm_7', from: 'CUSTOMER', type: 'TEXT', text: '公司 12 人想包船，8/22 可以嗎', imageUrl: '', at: ago(60 * 24), readAt: ago(60 * 23) },
    { id: 'm_8', from: 'SHOP', type: 'TEXT', text: '可以！包船專案 18,000 元，先收 5,000 定金即可保留船班', imageUrl: '', at: ago(60 * 22), readAt: null },
    { id: 'm_9', from: 'CUSTOMER', type: 'TEXT', text: '好的，那就麻煩你了！', imageUrl: '', at: ago(60 * 20), readAt: ago(60 * 19) },
  ],
};

const CONV_CLINIC: ChatConversation[] = [
  {
    id: 'chat_1', customerId: 'c_2', customerName: '周佩琪',
    lastMessageType: 'TEXT', lastMessage: '今天下午還有初診的號嗎？',
    lastMessageAt: ago(6), unread: 2,
  },
  {
    id: 'chat_2', customerId: 'c_1', customerName: '劉建國',
    lastMessageType: 'TEXT', lastMessage: '收到，謝謝提醒',
    lastMessageAt: ago(60 * 5), unread: 0,
  },
  {
    id: 'chat_3', customerId: 'c_4', customerName: '蔡淑芬',
    lastMessageType: 'TEXT', lastMessage: '健檢報告可以線上看嗎？',
    lastMessageAt: ago(60 * 30), unread: 1,
  },
];

const MSG_CLINIC: Record<string, ChatMessage[]> = {
  chat_1: [
    { id: 'm_1', from: 'CUSTOMER', type: 'TEXT', text: '你好，喉嚨痛三天了', imageUrl: '', at: ago(15), readAt: ago(14) },
    { id: 'm_2', from: 'SHOP', type: 'TEXT', text: '您好，建議先掛一般門診由醫師評估，線上可預約看診號碼。', imageUrl: '', at: ago(12), readAt: null },
    { id: 'm_3', from: 'CUSTOMER', type: 'TEXT', text: '今天下午還有初診的號嗎？', imageUrl: '', at: ago(6), readAt: null },
  ],
  chat_2: [
    { id: 'm_4', from: 'SHOP', type: 'TEXT', text: '提醒您：慢性處方箋將於下週到期，記得回診由醫師評估用藥。', imageUrl: '', at: ago(60 * 6), readAt: null },
    { id: 'm_5', from: 'CUSTOMER', type: 'TEXT', text: '收到，謝謝提醒', imageUrl: '', at: ago(60 * 5), readAt: ago(60 * 4) },
  ],
  chat_3: [
    { id: 'm_6', from: 'CUSTOMER', type: 'TEXT', text: '健檢報告可以線上看嗎？', imageUrl: '', at: ago(60 * 30), readAt: null },
  ],
};

/** mock 送出訊息的流水號（沿用頁面原本的 m_local_N 命名） */
let mockSeq = 1;

/* ----------------------------------------------------------------- 端點 */

const PAGE_SIZE = 100;

/**
 * 對話列表。`since` 給 15 秒輪詢用：只回該時間後有新訊息的對話（增量）。
 * 完整載入（無 since）時同時抓 GET /api/line-users/unbound，把「已加好友但
 * 尚未綁定顧客、也還沒有訊息」的 LINE 使用者併進清單（customerId=null），
 * 店家才看得到並能主動開啟對話。
 */
export function listConversations(q: { since?: string } = {}): Promise<ChatConversation[]> {
  return adapt(
    () => {
      // mock：輪詢增量恆為空；完整載入回當前業態的固定資料
      if (q.since) return [];
      return byMode({ LOCAL_SHOP: CONV_LOCAL_SHOP, GUIDE: CONV_GUIDE, CLINIC: CONV_CLINIC });
    },
    async () => {
      if (q.since) {
        const rows = await request<RawConversation[]>('/api/chat/conversations', { query: { since: q.since } });
        return rows.map(toConversation);
      }
      const [rows, unbound] = await Promise.all([
        request<RawConversation[]>('/api/chat/conversations'),
        request<UnboundLineUser[]>('/api/line-users/unbound'),
      ]);
      const seen = new Set(rows.map((r) => r.lineUserId));
      const extra = unbound
        .filter((u) => !seen.has(u.lineUserId))
        .map<ChatConversation>((u) => ({
          id: u.lineUserId,
          customerId: null,
          customerName: u.displayName,
          lastMessageType: 'TEXT',
          lastMessage: '',
          lastMessageAt: null,
          unread: 0,
        }));
      return [...rows.map(toConversation), ...extra];
    },
  );
}

/**
 * 訊息串（舊→新）。
 * - `after`：5 秒輪詢用，只回該筆 id 之後的新訊息（mock 恆回 []）。
 * - `page`：指定 0-based 頁碼（size=100）。
 * - 兩者皆未給：載入「最新一段」——先取第 0 頁得知總頁數，多於一頁時改取最後一頁
 *   （MVP 折衷：超長對話只先顯示最近 100 筆）。
 */
export function listMessages(q: { lineUserId: string; page?: number; after?: string }): Promise<ChatMessage[]> {
  return adapt(
    () => {
      if (q.after) return [];
      return byMode({ LOCAL_SHOP: MSG_LOCAL_SHOP, GUIDE: MSG_GUIDE, CLINIC: MSG_CLINIC })[q.lineUserId] ?? [];
    },
    async () => {
      if (q.after) {
        const rows = await request<RawMessage[]>('/api/chat/messages', {
          query: { lineUserId: q.lineUserId, after: q.after },
        });
        return rows.map(toMessage);
      }
      if (q.page != null) {
        const paged = await request<Paged<RawMessage>>('/api/chat/messages', {
          query: { lineUserId: q.lineUserId, page: q.page, size: PAGE_SIZE },
        });
        return paged.content.map(toMessage);
      }
      const first = await request<Paged<RawMessage>>('/api/chat/messages', {
        query: { lineUserId: q.lineUserId, page: 0, size: PAGE_SIZE },
      });
      if (first.totalPages <= 1) return first.content.map(toMessage);
      const last = await request<Paged<RawMessage>>('/api/chat/messages', {
        query: { lineUserId: q.lineUserId, page: first.totalPages - 1, size: PAGE_SIZE },
      });
      return last.content.map(toMessage);
    },
  );
}

/**
 * 店家回覆（LINE push，佔推播額度）。額度不足時後端回 409 REQ_003
 * 「本月推播額度已用完」→ 以 ApiError 拋出，頁面把 message 原樣 toast。
 * mock：合成一筆 SHOP 訊息回傳（不寫入固定資料，行為同先前純本地 append）。
 */
export function sendMessage(p: { lineUserId: string; text: string }): Promise<ChatMessage> {
  return adapt(
    () => ({
      id: `m_local_${mockSeq++}`,
      from: 'SHOP' as const,
      type: 'TEXT' as const,
      text: p.text,
      imageUrl: '',
      at: new Date().toISOString(),
      readAt: null,
    }),
    async () => {
      const row = await request<RawMessage>('/api/chat/messages', {
        method: 'POST',
        body: JSON.stringify(p),
      });
      return toMessage(row);
    },
  );
}

/**
 * 店家傳送圖片（修復-7 / issue #15）。
 *
 * 真實鏈路兩段，缺一不可：
 *   1. POST /api/upload（multipart，bucket=chat-images，0017 migration 新增）
 *      → 取得 Storage 的 https public URL。
 *   2. POST /api/chat/messages（body 帶 imageUrl）→ 後端扣推播額度、送 LINE
 *      image message、寫 chat_messages(OUT, message_type='image')。
 * 任一段失敗都會拋 ApiError，頁面只在兩段都成功後才顯示已送出。
 *
 * 上傳走 services/upload.ts 的 uploadImage()（multipart，失敗一樣轉 ApiError）。
 *
 * mock：與 sendMessage 相同，合成一筆本地 SHOP 訊息（圖片以 objectURL 預覽）。
 */
export function sendImage(p: { lineUserId: string; file: File }): Promise<ChatMessage> {
  return adapt(
    () => ({
      id: `m_local_${mockSeq++}`,
      from: 'SHOP' as const,
      type: 'IMAGE' as const,
      text: '',
      imageUrl: URL.createObjectURL(p.file),
      at: new Date().toISOString(),
      readAt: null,
    }),
    async () => {
      const imageUrl = await uploadImage(p.file, 'chat-images');
      const row = await request<RawMessage>('/api/chat/messages', {
        method: 'POST',
        body: JSON.stringify({ lineUserId: p.lineUserId, imageUrl }),
      });
      return toMessage(row);
    },
  );
}

/** 單筆訊息標記已讀（read_at=now；已讀過不覆蓋）。mock：no-op。 */
export const markRead = (messageId: string) =>
  adapt(() => undefined, () => request<void>(`/api/chat/messages/${messageId}/read`, { method: 'POST' }));

/**
 * 把一串訊息中「顧客傳來且未讀」的逐筆 markRead（開啟對話 / 輪詢到新訊息時呼叫）。
 * 失敗不拋錯（已讀狀態下一輪 15 秒列表輪詢會自然修正）。
 */
export async function markThreadRead(messages: ChatMessage[]): Promise<void> {
  if (USE_MOCK) return;
  const unread = messages.filter((m) => m.from === 'CUSTOMER' && !m.readAt);
  await Promise.allSettled(unread.map((m) => markRead(m.id)));
}

/**
 * 未讀訊息總數（側邊欄徽章 `unreadChatBadge`，issue #34）。
 *
 * **查證結論：不補新端點。** `GET /api/chat/conversations` 已經逐對話回
 * `unread`（route 用 direction='IN' 且 read_at is null 計數，見該檔 §2），
 * 加總即是徽章要的數字；再補一支 `/api/chat/unread/count` 會變成同一件事
 * 寫兩份、兩邊各自漂移。
 *
 * 這裡不呼叫 `listConversations()`，因為那支在完整載入時會額外打
 * `/api/line-users/unbound`（尚未綁定的好友，未讀恆為 0），徽章不需要。
 */
export const unreadChatCount = () =>
  adapt<number>(
    () =>
      byMode({ LOCAL_SHOP: CONV_LOCAL_SHOP, GUIDE: CONV_GUIDE, CLINIC: CONV_CLINIC })
        .reduce((sum, c) => sum + c.unread, 0),
    async () => {
      const rows = await request<RawConversation[]>('/api/chat/conversations');
      return rows.reduce((sum, r) => sum + (r.unread ?? 0), 0);
    },
  );

/** 未綁定顧客的 LINE 好友（followed=true 且 customer_id is null）。mock：[]。 */
export const listUnboundLineUsers = () =>
  adapt<UnboundLineUser[]>(() => [], () => request<UnboundLineUser[]>('/api/line-users/unbound'));

/* ----------------------------------------------------------------- 輪詢 */

/** 對話列表輪詢間隔（§B-5.1：15 秒） */
export const CONVERSATION_POLL_MS = 15_000;
/** 開啟中對話的訊息增量輪詢間隔（§B-5.1：5 秒） */
export const MESSAGE_POLL_MS = 5_000;

/**
 * 可組合的輪詢 helper：每 intervalMs 呼叫一次 cb；`document.hidden` 時暫停，
 * 回到前景（visibilitychange）立刻補拉一次；cb 尚在執行中則跳過該輪（防重疊）。
 * 回傳 stop 函式，頁面在 useEffect 的 cleanup 呼叫。
 * mock 模式（或非瀏覽器環境）直接回 no-op，不啟動任何計時器。
 */
export function startPolling(cb: () => void | Promise<void>, intervalMs: number): () => void {
  if (USE_MOCK || typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }
  let inFlight = false;
  const run = async () => {
    if (inFlight || document.hidden) return;
    inFlight = true;
    try {
      await cb();
    } catch {
      // 輪詢失敗靜默：下一輪自動重試，不打擾使用者
    } finally {
      inFlight = false;
    }
  };
  const timer = window.setInterval(() => void run(), intervalMs);
  const onVisibilityChange = () => {
    if (!document.hidden) void run();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
