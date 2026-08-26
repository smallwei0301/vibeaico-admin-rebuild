/**
 * GET /api/settings/line/owner-notify/line-users — 可加入通知名單的 LINE 好友清單。
 *
 * 規格出處：`docs/specs/dashboard.json` 的 `jsApiCalls`
 * `/api/settings/line/owner-notify/line-users`，渲染成一個下拉選單，
 * 空集合時的逐字文案是 `尚無可加入的 LINE 好友`（`<option>`）。
 *
 * 回傳的是「已加入好友（`line_users.followed = true`）**且尚未在名單中**」的人。
 * 已在名單中的人被排除掉——留著會讓下拉選出來的人一加就撞 409。
 */
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { listBindableLineUsers } from '@/server/owner-notify';

export const GET = handle(async () => {
  const t = await requireTenant();
  return ok({ lineUsers: await listBindableLineUsers(t.supabase, t.tenantId) });
});
