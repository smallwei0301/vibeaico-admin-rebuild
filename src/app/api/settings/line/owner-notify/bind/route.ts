import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { initiateOwnerNotifyBind } from '@/server/owner-notify';

const bodySchema = z.object({ lineUserId: z.string().min(1, '請選擇一位 LINE 好友') });

/**
 * POST /api/settings/line/owner-notify/bind — 發起「本人確認」邀請（Issue #18）。
 * 只推一則帶確認按鈕的訊息並記一筆待確認請求；**這支端點不會把人加進名單**——
 * 真正加入要等本人在 LINE 上按下確認（webhook postback → confirmOwnerNotifyBind，
 * 見 `src/server/line-events.ts`）。要求 OWNER：這是店家團隊通知名單，比顧客端
 * 設定更敏感。
 */
export const POST = handle(async (req) => {
  const t = await requireTenant('OWNER');
  const b = bodySchema.parse(await req.json());
  const result = await initiateOwnerNotifyBind(t.supabase, t.tenantId, t.tenantName, b.lineUserId);
  return ok(result);
});
