import { adapt, request } from '@/lib/api';
import type { SupportAnswer } from '@/server/support-chat';

/**
 * 後台右下角小幫手的資料進出口。
 *
 * 修好前的病：`SupportChatWidget` 的 `send()` 只把訊息 append 到本地 state 就結束，
 * 沒有端點、沒有回覆、店家也沒有任何方式知道自己被已讀不回——而那個元件掛在
 * **後台每一頁**上，開場白還宣稱「可以幫您查 LINE 狀態、推播額度…」。
 *
 * 現在它真的會回答，資料來自 `tenant_settings` / `push_quota_usage` /
 * `feature_subscriptions` 三張真表（詳見 `src/server/support-chat.ts` 檔頭）。
 */
export type { SupportAnswer, SupportFact, SupportIntent } from '@/server/support-chat';

/**
 * mock 分支刻意只回 `UNSUPPORTED` 的那一則。
 *
 * 骨架模式沒有租戶、沒有資料庫，任何「LINE 已設定」「本月剩 187 則」都會是憑空
 * 捏造的數字——那正是這個 PR 在修的病。回「我看不懂」是這個模式下唯一為真的答案。
 */
export async function askSupport(question: string): Promise<SupportAnswer> {
  return adapt<SupportAnswer>(
    () => ({
      intent: 'UNSUPPORTED',
      answer:
        '目前是無後端的展示模式，小幫手查不到任何真實資料，所以不回答。連上後端後它會真的查 LINE 串接狀態、本月推播額度、方案與權益到期。',
      facts: [],
      links: [],
    }),
    () =>
      request<SupportAnswer>('/api/support-chat/ask', {
        method: 'POST',
        body: JSON.stringify({ question }),
      }),
  );
}
