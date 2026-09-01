import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { ChatConversation } from '@/services/chat';
import {
  filterGuideConversations,
  isCurrentGuideConversationRequest,
  selectGuideWaitingConversations,
} from '@/lib/guide-messages';

const conversation = (overrides: Partial<ChatConversation> = {}): ChatConversation => ({
  id: 'chat-1',
  customerId: 'customer-1',
  customerName: '林小明',
  lastMessageType: 'TEXT',
  lastMessage: '想問這週六還有位子嗎？',
  lastMessageAt: '2026-09-01T09:00:00.000Z',
  unread: 1,
  ...overrides,
});

describe('GUIDE message inbox selectors (#66 Phase F)', () => {
  it('orders waiting conversations by real latest activity and caps the action list at three', () => {
    const rows = [
      conversation({ id: 'old', lastMessageAt: '2026-09-01T07:00:00.000Z', unread: 5 }),
      conversation({ id: 'latest', lastMessageAt: '2026-09-01T09:00:00.000Z', unread: 1 }),
      conversation({ id: 'middle', lastMessageAt: '2026-09-01T08:00:00.000Z', unread: 2 }),
      conversation({ id: 'read', lastMessageAt: '2026-09-01T10:00:00.000Z', unread: 0 }),
    ];

    expect(selectGuideWaitingConversations(rows, 3).map((row) => row.id))
      .toEqual(['latest', 'middle', 'old']);
    expect(selectGuideWaitingConversations(rows, 2).map((row) => row.id))
      .toEqual(['latest', 'middle']);
  });

  it('filters by waiting state and searches only returned conversation facts', () => {
    const rows = [
      conversation({ id: 'a', customerName: '陳小美', lastMessage: '想預約賞鯨', unread: 2 }),
      conversation({ id: 'b', customerName: '黃大明', lastMessage: '收到，謝謝', unread: 0 }),
    ];

    expect(filterGuideConversations(rows, 'WAITING').map((row) => row.id)).toEqual(['a']);
    expect(filterGuideConversations(rows, 'ALL', '賞鯨').map((row) => row.id)).toEqual(['a']);
    expect(filterGuideConversations(rows, 'ALL', '不存在')).toEqual([]);
  });
  it('rejects stale conversation responses after a quick switch', () => {
    expect(isCurrentGuideConversationRequest(3, 3, 'chat-a', 'chat-a')).toBe(true);
    expect(isCurrentGuideConversationRequest(3, 4, 'chat-a', 'chat-a')).toBe(false);
    expect(isCurrentGuideConversationRequest(3, 3, 'chat-a', 'chat-b')).toBe(false);
    expect(isCurrentGuideConversationRequest(3, 3, 'chat-a', null)).toBe(false);

    const source = readFileSync('src/components/guide/GuideMessagesView.tsx', 'utf8');
    expect(source).toContain('listLoadSequence');
    expect(source).toContain('sendSequence');
    expect(source).toContain('isCurrentGuideConversationRequest');
  });

});
