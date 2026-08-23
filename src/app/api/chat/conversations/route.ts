import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * GET /api/chat/conversations（04 分冊 §B-5 / §B-5.1）。
 * line_users（followed=true）加最後訊息與未讀數（chat_messages direction='IN'
 * 且 read_at is null 的筆數）。`?since=<ISO>` → 只回該時間後有新訊息的對話
 * （15 秒輪詢用）。
 *
 * 實作備註（無 conversations view，MVP 用三段查詢在 JS 聚合）：
 * 1. line_users followed=true。
 * 2. 未讀：direction='IN' 且 read_at null 的列（自然是小集合），JS 分組計數。
 * 3. 最後訊息：抓該店最近 1000 筆訊息 desc，每個 line_user_id 取第一筆；
 *    超出掃描窗（最後訊息比最近 1000 筆更舊）的對話 lastMessage 顯示為空，
 *    屬可接受的 MVP 折衷。
 */

const querySchema = z.object({
  since: z.string().datetime({ offset: true }).optional(),
});

const SCAN_LIMIT = 1000;

function contentText(content: any): string {
  if (typeof content?.text === 'string') return content.text;
  return '';
}

export const GET = handle(async (req) => {
  const t = await requireTenant();
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

  const { data: users, error: e0 } = await t.supabase
    .from('line_users')
    .select('line_user_id, display_name, picture_url, customer_id, created_at')
    .eq('tenant_id', t.tenantId)
    .eq('followed', true);
  if (e0) throw e0;

  let visible = users ?? [];

  // since：只留該時間後有新訊息的對話
  if (q.since) {
    const { data: fresh, error: e1 } = await t.supabase
      .from('chat_messages')
      .select('line_user_id')
      .eq('tenant_id', t.tenantId)
      .gt('created_at', q.since)
      .limit(SCAN_LIMIT);
    if (e1) throw e1;
    const freshIds = new Set((fresh ?? []).map((r) => r.line_user_id));
    visible = visible.filter((u) => freshIds.has(u.line_user_id));
  }

  if (visible.length === 0) return ok([]);

  const ids = visible.map((u) => u.line_user_id);

  // 未讀數（IN 且未讀）
  const { data: unreadRows, error: e2 } = await t.supabase
    .from('chat_messages')
    .select('line_user_id')
    .eq('tenant_id', t.tenantId)
    .eq('direction', 'IN')
    .is('read_at', null)
    .in('line_user_id', ids)
    .limit(SCAN_LIMIT);
  if (e2) throw e2;
  const unread = new Map<string, number>();
  for (const r of unreadRows ?? [])
    unread.set(r.line_user_id, (unread.get(r.line_user_id) ?? 0) + 1);

  // 最後訊息（掃描最近 SCAN_LIMIT 筆，各對話取第一筆）
  const { data: recent, error: e3 } = await t.supabase
    .from('chat_messages')
    .select('line_user_id, message_type, content, created_at')
    .eq('tenant_id', t.tenantId)
    .in('line_user_id', ids)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(SCAN_LIMIT);
  if (e3) throw e3;
  const last = new Map<string, { message_type: string; content: any; created_at: string }>();
  for (const r of recent ?? [])
    if (!last.has(r.line_user_id)) last.set(r.line_user_id, r);

  const conversations = visible.map((u) => {
    const lm = last.get(u.line_user_id);
    return {
      lineUserId: u.line_user_id,
      displayName: u.display_name ?? '',
      pictureUrl: u.picture_url ?? '',
      customerId: u.customer_id ?? null,
      lastMessageType: (lm?.message_type ?? 'text').toUpperCase(),
      lastMessage: lm ? contentText(lm.content) : '',
      lastMessageAt: lm?.created_at ?? null,
      unread: unread.get(u.line_user_id) ?? 0,
    };
  });

  // 最後訊息時間新→舊；沒訊息的排最後（依加入時間新→舊）
  conversations.sort((a, b) => {
    if (a.lastMessageAt && b.lastMessageAt)
      return a.lastMessageAt < b.lastMessageAt ? 1 : -1;
    if (a.lastMessageAt) return -1;
    if (b.lastMessageAt) return 1;
    return 0;
  });

  return ok(conversations);
});
