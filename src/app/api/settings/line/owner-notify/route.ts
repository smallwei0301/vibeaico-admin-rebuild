import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { getOwnerNotifyOverview } from '@/server/owner-notify';

/**
 * GET /api/settings/line/owner-notify — 老闆通知總覽（Issue #18）：目前名單、
 * 上限、以及**實測**的 LINE provider 連線狀態（不是「有存 Token 就宣稱已連線」）。
 *
 * POST — 重新檢測 provider 連線狀態（畫面上的「重新檢查」按鈕，不落任何庫）。
 */
export const GET = handle(async () => {
  const t = await requireTenant();
  return ok(await getOwnerNotifyOverview(t.supabase, t.tenantId));
});

export const POST = handle(async () => {
  const t = await requireTenant();
  return ok(await getOwnerNotifyOverview(t.supabase, t.tenantId));
});
