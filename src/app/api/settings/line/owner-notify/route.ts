/**
 * GET    /api/settings/line/owner-notify — 狀態＋接收者清單＋maxRecipients
 * DELETE /api/settings/line/owner-notify — 解除全部接收者的綁定
 *
 * 規格出處：`docs/specs/dashboard.json` 的 `jsApiCalls` 有 `/api/settings/line/owner-notify`；
 * 「解除全部」的逐字文案是 `確定解除全部 ${n} 位接收者的綁定？之後不會再收到 LINE
 * 即時通知。` 與 `已解除綁定`。契約（method 與 body 形狀）見 06 分冊 §5.5，
 * **標明為我方設計**——規格只記錄路徑字串，不記錄 method 與形狀（14 分冊 §9.4）。
 *
 * ⚠️ 原站**沒有**獨立的 toggle 端點（`jsApiCalls` 全文沒有 `toggle`）。
 * 「關掉通知」＝移除接收者（單筆或全部），不是另一顆開關。不得自行補一支 toggle。
 */
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { clearOwnerNotifyRecipients, getOwnerNotifyState } from '@/server/owner-notify';

export const GET = handle(async () => {
  const t = await requireTenant();
  return ok(await getOwnerNotifyState(t.supabase, t.tenantId));
});

export const DELETE = handle(async () => {
  const t = await requireTenant('MANAGER');
  const removed = await clearOwnerNotifyRecipients(t.supabase, t.tenantId);
  return ok({ removed });
});
