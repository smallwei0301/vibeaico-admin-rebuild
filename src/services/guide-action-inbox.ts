import { adapt, request } from '@/lib/api';
import type { GuideActionInbox } from '@/lib/types';

const EMPTY_INBOX: GuideActionInbox = { immediate: [], today: [], upcoming: [] };

/** mock 模式沒有可回查的旅遊真實狀態，因此誠實回傳空收件匣。 */
export const getGuideActionInbox = () => adapt<GuideActionInbox>(
  () => EMPTY_INBOX,
  () => request<GuideActionInbox>('/api/guide/action-inbox'),
);
