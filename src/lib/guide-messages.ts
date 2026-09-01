import type { ChatConversation } from '@/services/chat';

export type GuideMessageFilter = 'ALL' | 'WAITING';

function timestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * GUIDE inbox ordering is derived only from conversation facts returned by the
 * chat service: newest activity first, then unread count and stable identity.
 */
export function compareGuideConversations(
  a: ChatConversation,
  b: ChatConversation,
): number {
  return timestamp(b.lastMessageAt) - timestamp(a.lastMessageAt)
    || b.unread - a.unread
    || a.customerName.localeCompare(b.customerName, 'zh-Hant')
    || a.id.localeCompare(b.id);
}

export function filterGuideConversations(
  conversations: readonly ChatConversation[],
  filter: GuideMessageFilter = 'ALL',
  query = '',
): ChatConversation[] {
  const needle = query.trim().toLocaleLowerCase();
  return conversations
    .filter((conversation) => filter !== 'WAITING' || conversation.unread > 0)
    .filter((conversation) => {
      if (!needle) return true;
      return [conversation.customerName, conversation.lastMessage]
        .some((value) => value.toLocaleLowerCase().includes(needle));
    })
    .slice()
    .sort(compareGuideConversations);
}

export function selectGuideWaitingConversations(
  conversations: readonly ChatConversation[],
  limit = 3,
): ChatConversation[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 3;
  return filterGuideConversations(conversations, 'WAITING').slice(0, safeLimit);
}
