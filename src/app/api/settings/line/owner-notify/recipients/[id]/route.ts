import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { removeOwnerNotifyRecipient, updateOwnerNotifyRecipient } from '@/server/owner-notify';

const bodySchema = z.object({
  notifyNewBooking: z.boolean().optional(),
  notifyCancel: z.boolean().optional(),
  // 只允許 true：拿掉主要一律靠移除該人或把別人指定為主要（DB 部分唯一索引
  // 也只擋「兩個人同時是主要」，不擋「沒有人是主要」——那是移除最後一位時
  // 的合法狀態，對應「移除最後一位接收者就停止所有老闆 LINE 通知」）。
  isPrimary: z.literal(true).optional(),
});

/** PATCH /api/settings/line/owner-notify/recipients/:id — 切換事件開關／指定主要。 */
export const PATCH = handle(async (req, { params }) => {
  const t = await requireTenant('OWNER');
  const { id } = await params;
  const b = bodySchema.parse(await req.json());
  await updateOwnerNotifyRecipient(t.supabase, t.tenantId, id, b);
  return ok();
});

/** DELETE /api/settings/line/owner-notify/recipients/:id — 移除單一接收者，主要遞補。 */
export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant('OWNER');
  const { id } = await params;
  await removeOwnerNotifyRecipient(t.supabase, t.tenantId, id);
  return ok();
});
