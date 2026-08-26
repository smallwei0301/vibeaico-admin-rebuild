/**
 * POST   /api/settings/line/owner-notify/recipients/:id — 加入通知名單
 * DELETE /api/settings/line/owner-notify/recipients/:id — 移出通知名單
 *
 * 規格出處：`docs/specs/dashboard.json` 的 `jsApiCalls` 有
 * `/api/settings/line/owner-notify/recipients/`（**尾斜線＝路徑帶 `${id}` 樣板**）；
 * 逐字文案：`新增接收者`、`確認將此人加入通知名單？`、
 * `確定將此人移出通知名單？其他接收者不受影響。`、`已移除接收者`。
 *
 * `:id` 是什麼（**我方設計**，規格只留下路徑樣板）：用 **`line_user_id`**。
 * 理由：加入時畫面手上只有好友清單（`line-users` 回的是 `lineUserId`），
 * 若加入用 lineUserId、移除用另一種 id，同一條路徑會有兩種鍵，前端得記兩套。
 *
 * 移除規則（規格逐字，實作在 `removeOwnerNotifyRecipient`）：
 *  - 非主要 → 其他接收者不受影響
 *  - 主要   → 下一位（最早加入者）自動遞補為主要
 *  - 最後一位 → 名單為空，之後不再發送（規格逐字：「這是最後一位接收者，
 *    移除後將不再收到 LINE 即時通知。」）
 */
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import {
  addOwnerNotifyRecipient, getMaxRecipients, removeOwnerNotifyRecipient,
} from '@/server/owner-notify';

export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;

  const recipient = await addOwnerNotifyRecipient(t.supabase, t.tenantId, id);
  return ok({ recipient, maxRecipients: await getMaxRecipients(t.supabase, t.tenantId) });
});

export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;

  const { promoted } = await removeOwnerNotifyRecipient(t.supabase, t.tenantId, id);
  return ok({ promoted });
});
