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
 * POST /api/settings/line/owner-notify/recipients — 測試專用：把一筆**已確認**
 * 的邀請落地成正式接收者，模擬本人已經在 LINE 上按下確認（Issue #18「add
 * after bind-confirm」的驗收路徑）。
 *
 * 正式流程下，這件事只能由本人在 LINE 上按下確認、經 webhook postback
 * （`src/server/line-events.ts` → `confirmOwnerNotifyBind`）完成——那條路徑用
 * service-role admin client，因為 webhook 沒有登入 session。這支端點不是第二
 * 條正式入口：Final Risk 覆核（PR #519）指出，若不加閘門，任何 OWNER 都能繞過
 * 「本人確認」直接把自己選的好友加進通知名單，與 Issue #18 Owner 已裁示的
 * canonical flow 相衝。因此僅在非 production 且明確開啟
 * `OWNER_NOTIFY_TEST_CONFIRM_ENABLED` 時才存在，比照
 * `src/app/api/line/webhook/[shopCode]/route.ts` 的 `LINE_WEBHOOK_DRAIN_ENABLED`
 * 閘門寫法；生產環境下這支端點回 404，驗收只能真的走簽章 webhook postback。
 */
function isTestConfirmEnabled() {
  return process.env.NODE_ENV !== 'production' && process.env.OWNER_NOTIFY_TEST_CONFIRM_ENABLED === 'true';
}

export const POST = handle(async (req) => {
  if (!isTestConfirmEnabled()) {
    throw new ApiHttpError(404, '找不到該資源', ERR.NOT_FOUND);
  }
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
