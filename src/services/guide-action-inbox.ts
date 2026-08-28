import { adapt, request } from '@/lib/api';
import type { GuideActionInbox } from '@/server/guide-action-inbox';

const EMPTY_INBOX: GuideActionInbox = { immediate: [], today: [], upcoming: [] };

/** GUIDE 首頁只讀取推導結果；mock 模式沒有真實狀態，因此誠實顯示空收件匣。 */
export const getGuideActionInbox = () => adapt<GuideActionInbox>(
  () => EMPTY_INBOX,
  () => request<GuideActionInbox>('/api/guide-action-inbox'),
);
