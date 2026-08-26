/**
 * POST /api/settings/line/owner-notify/bind — 本人自我認領。
 *
 * 規格出處（`docs/specs/dashboard.json` 逐字）：按鈕 `是我，綁定通知`、
 * 確認視窗 `確認是您本人嗎？`、成功 `綁定成功！之後有新預約會即時通知綁定的 LINE。`、
 * 失敗 `綁定失敗`。
 *
 * ⚠️ **沒有綁定碼、也沒有 webhook 分支。** issue #18 原本設計的「後台產一次性
 * 綁定碼 → 店主在 LINE 傳該碼」在規格裡毫無出處（`grep -rn '綁定碼' docs/` 零命中），
 * 已於 2026-08-25 改寫作廢。實際流程是：從已 follow 的好友清單挑自己 → 按
 * 「是我，綁定通知」→ 寫進名單。
 *
 * 與 `recipients/:id`（新增同事）的差別只在**畫面語意與文案**，寫入行為同一件事，
 * 因此兩支端點共用 `addOwnerNotifyRecipient()`（見該函式註解）。
 *
 * body = `{ lineUserId }`（我方設計，見 06 分冊 §5.5）。
 */
import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { addOwnerNotifyRecipient, getMaxRecipients } from '@/server/owner-notify';

const bodySchema = z.object({
  lineUserId: z.string().min(1, '請選擇要綁定的 LINE 好友'),
});

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const { lineUserId } = bodySchema.parse(await req.json());

  const recipient = await addOwnerNotifyRecipient(t.supabase, t.tenantId, lineUserId);
  return ok({ recipient, maxRecipients: await getMaxRecipients(t.supabase, t.tenantId) });
});
