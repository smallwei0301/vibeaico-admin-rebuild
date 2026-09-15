import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { listOwnerNotifyLineUserCandidates } from '@/server/owner-notify';

/**
 * GET /api/settings/line/owner-notify/line-users — 可挑選的 LINE 好友（Issue #18）：
 * 該店已加入的好友，扣掉已在正式名單中的；若已有進行中的邀請，帶回其 id
 * 讓畫面顯示「邀請中」而不是讓店家重覆點擊發起。
 */
export const GET = handle(async () => {
  const t = await requireTenant();
  return ok(await listOwnerNotifyLineUserCandidates(t.supabase, t.tenantId));
});
