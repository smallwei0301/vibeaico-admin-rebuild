/**
 * Service boundary for support-chat 客服對話串（issue #25 B 段）。
 *
 * ⚠️ 與 `src/services/support-chat.ts`（`askSupport()`，自助查詢）是兩支不同
 * 服務：那支唯讀、不持久化；這裡是「轉人工」之後的客服案件／訊息，見
 * `docs/decisions/2026-09-11-support-chat-human-escalation.md`。
 *
 * mock 分支維持一個模組內的記憶體清單（session 內持續，重新整理頁面才會重置，
 * 與骨架模式下其他「新增後在畫面上看得到」的功能一致），讓 widget 在
 * `NEXT_PUBLIC_USE_MOCK=true` 也能展示「店家自己送出的歷史」——不像
 * `submitBugReport()` 只需要回一個假 id，這裡的驗收要求看得到列表與明細，
 * 所以不能只回傳空殼。
 */
import { adapt, delay, request } from '@/lib/api';
import type {
  SupportChatThreadSummary, SupportChatThreadDetail, SupportChatMessage,
} from '@/lib/types';

export type { SupportChatThreadSummary, SupportChatThreadDetail, SupportChatMessage };

export type CreateSupportChatThreadInput = { subject: string; body: string };
export type AddSupportChatMessageInput = { body: string };

let mockNextId = 1;
const mockThreads: SupportChatThreadDetail[] = [];

/** 骨架模式下沒有真的信箱可寄，一律回這個誠實值——與 real 分支「未設定信箱」同一個狀態碼。 */
const MOCK_NOTIFY_STATUS = 'SKIPPED_NO_RECIPIENT' as const;

export const listSupportChatThreads = () =>
  adapt<SupportChatThreadSummary[]>(
    async () => {
      await delay();
      return mockThreads.map(({ messages: _messages, ...summary }) => summary);
    },
    () => request<{ threads: SupportChatThreadSummary[] }>('/api/support-chat/threads')
      .then((r) => r.threads),
  );

export const getSupportChatThread = (threadId: string) =>
  adapt<SupportChatThreadDetail>(
    async () => {
      await delay();
      const found = mockThreads.find((t) => t.id === threadId);
      if (!found) throw new Error('找不到這個客服對話串');
      found.unread = false;
      return found;
    },
    () => request<SupportChatThreadDetail>(`/api/support-chat/threads/${threadId}`),
  );

export const createSupportChatThread = (input: CreateSupportChatThreadInput) =>
  adapt<SupportChatThreadDetail>(
    async () => {
      await delay();
      const now = new Date().toISOString();
      const thread: SupportChatThreadDetail = {
        id: `sct_mock_${mockNextId++}`,
        subject: input.subject,
        status: 'OPEN',
        notifyStatus: MOCK_NOTIFY_STATUS,
        lastMessageAt: now,
        unread: false,
        createdAt: now,
        messages: [{
          id: `scm_mock_${mockNextId++}`,
          senderRole: 'TENANT',
          senderEmail: 'demo@example.com',
          body: input.body,
          createdAt: now,
        }],
      };
      mockThreads.unshift(thread);
      return thread;
    },
    () => request<SupportChatThreadDetail>('/api/support-chat/threads', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );

export const addSupportChatMessage = (threadId: string, input: AddSupportChatMessageInput) =>
  adapt<SupportChatMessage>(
    async () => {
      await delay();
      const found = mockThreads.find((t) => t.id === threadId);
      if (!found) throw new Error('找不到這個客服對話串');
      const now = new Date().toISOString();
      const message: SupportChatMessage = {
        id: `scm_mock_${mockNextId++}`,
        senderRole: 'TENANT',
        senderEmail: 'demo@example.com',
        body: input.body,
        createdAt: now,
      };
      found.messages.push(message);
      found.lastMessageAt = now;
      return message;
    },
    () => request<SupportChatMessage>(`/api/support-chat/threads/${threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );
