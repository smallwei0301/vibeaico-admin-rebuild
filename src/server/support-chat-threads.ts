/**
 * src/server/support-chat-threads.ts — 客服對話串（issue #25 B 段）
 * -----------------------------------------------------------------------------
 * 規格：`docs/decisions/2026-09-11-support-chat-human-escalation.md`。
 *
 * ⚠️ 與 `src/server/support-chat.ts`（`/api/support-chat/ask` 的自助查詢規則）
 * 完全不同的模組：那支唯讀、不寫資料；這裡是「留言 → 持久化 → 通知平台」。
 * 兩者刻意分檔，避免日後有人以為它們共用同一套規則。
 *
 * 這一層一律用 `t.supabase`（帶 session 的 client，RLS 把關），不使用
 * `createAdminSupabase()`——0116 migration 的政策集合已經足以讓一般店員
 * 讀寫自己店的 thread／訊息，沒有理由繞過 RLS 多一個攻擊面。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiHttpError, ERR } from './http';
import { sendSupportChatNotifyEmail, type EmailSendResult } from './email/send';
import { serverEnv } from '@/config/env';

export type SupportChatThreadStatus = 'OPEN' | 'CLOSED';
export type SupportChatNotifyStatus = 'SENT' | 'FAILED' | 'SKIPPED_NO_KEY' | 'SKIPPED_NO_RECIPIENT';
export type SupportChatSenderRole = 'TENANT' | 'PLATFORM';

export interface SupportChatThreadSummary {
  id: string;
  subject: string;
  status: SupportChatThreadStatus;
  notifyStatus: SupportChatNotifyStatus;
  lastMessageAt: string;
  unread: boolean;
  createdAt: string;
}

export interface SupportChatMessage {
  id: string;
  senderRole: SupportChatSenderRole;
  senderEmail: string;
  body: string;
  createdAt: string;
}

export interface SupportChatThreadDetail extends SupportChatThreadSummary {
  messages: SupportChatMessage[];
}

/** 送出結果——`SENT`/`FAILED`/`SKIPPED_*` 直接對應 `notify_status`，供 UI 顯示誠實文案。 */
function toNotifyStatus(r: EmailSendResult): SupportChatNotifyStatus {
  return r; // EmailSendResult 的三個值與 SupportChatNotifyStatus 的子集逐字相同
}

/** 依租戶列出自己的客服對話串，依最後訊息時間新到舊排序。 */
export async function listThreads(
  supabase: SupabaseClient, tenantId: string,
): Promise<SupportChatThreadSummary[]> {
  const { data, error } = await supabase
    .from('support_chat_threads')
    .select('id, subject, status, notify_status, last_message_at, tenant_read_at, created_at')
    .eq('tenant_id', tenantId)
    .order('last_message_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    subject: r.subject as string,
    status: r.status as SupportChatThreadStatus,
    notifyStatus: r.notify_status as SupportChatNotifyStatus,
    lastMessageAt: r.last_message_at as string,
    unread: !r.tenant_read_at || new Date(r.last_message_at as string) > new Date(r.tenant_read_at as string),
    createdAt: r.created_at as string,
  }));
}

/**
 * 讀取單一 thread 的訊息，並在同一次呼叫中把 `tenant_read_at` 標記為現在——
 * 這是 widget「看到自己送出的歷史」同時也是「已讀」判定的唯一入口。
 */
export async function getThreadDetail(
  supabase: SupabaseClient, tenantId: string, threadId: string,
): Promise<SupportChatThreadDetail> {
  const { data: thread, error: terr } = await supabase
    .from('support_chat_threads')
    .select('id, subject, status, notify_status, last_message_at, tenant_read_at, created_at')
    .eq('tenant_id', tenantId)
    .eq('id', threadId)
    .maybeSingle();
  if (terr) throw terr;
  if (!thread) throw new ApiHttpError(404, '找不到這個客服對話串', ERR.NOT_FOUND);

  const { data: messages, error: merr } = await supabase
    .from('support_chat_messages')
    .select('id, sender_role, sender_email, body, created_at')
    .eq('tenant_id', tenantId)
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  if (merr) throw merr;

  const now = new Date().toISOString();
  // 標記已讀失敗不影響讀取結果本身——已讀狀態只是 UI 的未讀角標，不是這支端點
  // 的主要目的；但仍要留 log，免得「已讀」悄悄永遠停在 false 卻無人知道。
  const { error: rerr } = await supabase
    .from('support_chat_threads')
    .update({ tenant_read_at: now })
    .eq('tenant_id', tenantId)
    .eq('id', threadId);
  if (rerr) console.error('[support-chat] 標記已讀失敗', tenantId, threadId, rerr);

  return {
    id: thread.id as string,
    subject: thread.subject as string,
    status: thread.status as SupportChatThreadStatus,
    notifyStatus: thread.notify_status as SupportChatNotifyStatus,
    lastMessageAt: thread.last_message_at as string,
    unread: false, // 剛標記過已讀
    createdAt: thread.created_at as string,
    messages: (messages ?? []).map((m) => ({
      id: m.id as string,
      senderRole: m.sender_role as SupportChatSenderRole,
      senderEmail: m.sender_email as string,
      body: m.body as string,
      createdAt: m.created_at as string,
    })),
  };
}

export interface CreateThreadInput {
  tenantId: string;
  shopCode: string;
  shopName: string;
  userId: string;
  userEmail: string;
  subject: string;
  body: string;
  appUrl: string;
}

/**
 * 建立客服對話串＋第一則訊息，並嘗試通知平台管理者。
 *
 * 通知信寄送失敗（含信箱未設定）**不**讓這支函式丟例外——thread／訊息已經
 * 成功寫入是既成事實，不能因為通知信的問題把已經保存的留言變不存在。
 * 呼叫端（route）把回傳的 `notifyStatus` 原樣交給前端，由前端誠實顯示。
 */
export async function createThread(
  supabase: SupabaseClient, input: CreateThreadInput,
): Promise<SupportChatThreadDetail> {
  const { data: thread, error: terr } = await supabase
    .from('support_chat_threads')
    .insert({
      tenant_id: input.tenantId,
      subject: input.subject,
      created_by: input.userId,
      created_by_email: input.userEmail,
      tenant_read_at: new Date().toISOString(), // 建立者本人視為已讀自己剛送出的內容
    })
    .select('id, subject, status, last_message_at, created_at')
    .single();
  if (terr) throw terr;

  const { data: message, error: merr } = await supabase
    .from('support_chat_messages')
    .insert({
      thread_id: thread.id,
      tenant_id: input.tenantId,
      sender_role: 'TENANT',
      sender_email: input.userEmail,
      body: input.body,
    })
    .select('id, sender_role, sender_email, body, created_at')
    .single();
  if (merr) throw merr;

  const notifyStatus = await notifyPlatform(supabase, {
    tenantId: input.tenantId,
    threadId: thread.id as string,
    shopCode: input.shopCode,
    shopName: input.shopName,
    senderEmail: input.userEmail,
    subject: input.subject,
    body: input.body,
    appUrl: input.appUrl,
  });

  return {
    id: thread.id as string,
    subject: thread.subject as string,
    status: thread.status as SupportChatThreadStatus,
    notifyStatus,
    lastMessageAt: thread.last_message_at as string,
    unread: false,
    createdAt: thread.created_at as string,
    messages: [{
      id: message.id as string,
      senderRole: message.sender_role as SupportChatSenderRole,
      senderEmail: message.sender_email as string,
      body: message.body as string,
      createdAt: message.created_at as string,
    }],
  };
}

interface NotifyParams {
  tenantId: string;
  threadId: string;
  shopCode: string;
  shopName: string;
  senderEmail: string;
  subject: string;
  body: string;
  appUrl: string;
}

/**
 * 未設定 `PLATFORM_SUPPORT_NOTIFY_EMAIL` 時 fail-closed：**不寄信**，但已經
 * 成功寫入的 thread／訊息完全不受影響——這是 Issue #25 明文要求的行為，
 * 不得把「平台信箱還沒設定」變成「店家的留言不見了」。
 */
async function notifyPlatform(
  supabase: SupabaseClient, p: NotifyParams,
): Promise<SupportChatNotifyStatus> {
  const to = serverEnv.PLATFORM_SUPPORT_NOTIFY_EMAIL;
  const notifyStatus: SupportChatNotifyStatus = to
    ? toNotifyStatus(await sendSupportChatNotifyEmail(to, {
        shopName: p.shopName,
        shopCode: p.shopCode,
        senderEmail: p.senderEmail,
        subject: p.subject,
        body: p.body,
        threadId: p.threadId,
        appUrl: p.appUrl,
      }))
    : 'SKIPPED_NO_RECIPIENT';

  const { error } = await supabase
    .from('support_chat_threads')
    .update({ notify_status: notifyStatus })
    .eq('tenant_id', p.tenantId)
    .eq('id', p.threadId);
  if (error) console.error('[support-chat] 寫入 notify_status 失敗', p.tenantId, p.threadId, error);

  return notifyStatus;
}

export interface AddMessageInput {
  tenantId: string;
  threadId: string;
  userEmail: string;
  body: string;
}

/** 在既有 thread 追加一則店家留言（第一版不再重複寄通知信——見檔頭決策文件）。 */
export async function addMessage(
  supabase: SupabaseClient, input: AddMessageInput,
): Promise<SupportChatMessage> {
  const { data: thread, error: terr } = await supabase
    .from('support_chat_threads')
    .select('id')
    .eq('tenant_id', input.tenantId)
    .eq('id', input.threadId)
    .maybeSingle();
  if (terr) throw terr;
  if (!thread) throw new ApiHttpError(404, '找不到這個客服對話串', ERR.NOT_FOUND);

  const { data: message, error: merr } = await supabase
    .from('support_chat_messages')
    .insert({
      thread_id: input.threadId,
      tenant_id: input.tenantId,
      sender_role: 'TENANT',
      sender_email: input.userEmail,
      body: input.body,
    })
    .select('id, sender_role, sender_email, body, created_at')
    .single();
  if (merr) throw merr;

  const now = new Date().toISOString();
  const { error: uerr } = await supabase
    .from('support_chat_threads')
    .update({ last_message_at: now, tenant_read_at: now })
    .eq('tenant_id', input.tenantId)
    .eq('id', input.threadId);
  if (uerr) console.error('[support-chat] 更新 last_message_at 失敗', input.tenantId, input.threadId, uerr);

  return {
    id: message.id as string,
    senderRole: message.sender_role as SupportChatSenderRole,
    senderEmail: message.sender_email as string,
    body: message.body as string,
    createdAt: message.created_at as string,
  };
}
