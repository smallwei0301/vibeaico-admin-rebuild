import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';
import { confirmOwnerNotifyBind, removeAllOwnerNotifyRecipients } from '@/server/owner-notify';

const bodySchema = z.object({
  requestId: z.string().uuid(),
  lineUserId: z.string().min(1),
});

/**
 * POST /api/settings/line/owner-notify/recipients — 把一筆**已確認**的邀請
 * 落地成正式接收者（Issue #18「add after bind-confirm」）。
 *
 * 正常流程下，這件事是本人在 LINE 上按下確認按鈕、由 webhook postback
 * （`src/server/line-events.ts` → `confirmOwnerNotifyBind`）直接完成，不會經過
 * 這支 HTTP 端點——那條路徑用 service-role admin client，因為 webhook 沒有
 * 登入 session。
 *
 * 這支端點存在的理由：這個 repo 沒有可在單元測試／Playwright E2E 中重放的真
 * LINE webhook 環境（Issue 本文「Explicitly OUT of scope」也點名了這件事），
 * 呼叫它等同「模擬本人已經在 LINE 上按下確認」，讓驗收流程（加入→切換→移除
 * →遞補主要）可以端到端測試，而不必假造一個 webhook 請求。它與
 * `confirmOwnerNotifyBind` 走同一段商業邏輯（同一函式），不是第二套實作。
 * `lineUserId` 必須與該筆待確認請求相符——不能單靠 requestId 猜對象。
 */
export const POST = handle(async (req) => {
  const t = await requireTenant('OWNER');
  const b = bodySchema.parse(await req.json());
  const admin = createAdminSupabase();
  const result = await confirmOwnerNotifyBind(admin, t.tenantId, b.requestId, b.lineUserId);
  if (!result.ok) {
    const message = result.reason === 'LIMIT_REACHED'
      ? '老闆通知名單已達上限（3 位）'
      : result.reason === 'EXPIRED'
        ? '邀請已過期，請重新發起'
        : '邀請已不存在或對象不符';
    throw new ApiHttpError(409,
      message,
      result.reason === 'LIMIT_REACHED' ? ERR.OWNER_NOTIFY_LIMIT : ERR.OWNER_NOTIFY_BIND_INVALID);
  }
  return ok();
});

/** DELETE /api/settings/line/owner-notify/recipients — 一次清空整份名單（remove-all）。 */
export const DELETE = handle(async () => {
  const t = await requireTenant('OWNER');
  await removeAllOwnerNotifyRecipients(t.supabase, t.tenantId);
  return ok();
});
