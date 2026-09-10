import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { loadTenantImpersonationLog } from '@/server/platform-admin';

/**
 * GET /api/settings/impersonation-log —— 店家自己查得到平台進來過幾次、做了什麼。
 *
 * 這是 Owner 2026-08-27 裁示裡「**租戶可查紀錄**」那一句的落點。
 *
 * ⚠️ 用呼叫端帶 session 的 client（RLS `is_tenant_member(tenant_id)` 把關），
 * **不用 service role**——一支「讓租戶看自己紀錄」的端點如果繞過 RLS，
 * 那就是又一條需要自己小心的租戶邊界。
 *
 * 需 `MANAGER` 以上：這份紀錄會揭露平台曾經看過哪些頁面。
 */
export const GET = handle(async () => {
  const t = await requireTenant('MANAGER');
  const log = await loadTenantImpersonationLog(t.supabase, t.tenantId);
  return ok({
    sessions: log.sessions.map((s: any) => ({
      id: s.id,
      reason: s.reason,
      startedAt: s.started_at,
      expiresAt: s.expires_at,
      endedAt: s.ended_at,
    })),
    actions: log.actions.map((a: any) => ({
      id: a.id,
      sessionId: a.session_id,
      method: a.method,
      path: a.path,
      status: a.status,
      at: a.at,
    })),
  });
});
