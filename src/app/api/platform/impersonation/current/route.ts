import { handle, ok } from '@/server/http';
import { requireUser } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';
import { loadActiveImpersonation } from '@/server/platform-admin';

/**
 * GET /api/platform/impersonation/current —— 目前是否代入中。
 *
 * 沒有代入中回 `{ active: false }` 而不是 404：這支端點的問題是「現在是什麼狀態」，
 * 「不是代入中」是一個合法答案，不是找不到資源。
 * 版面用它決定要不要顯示橫幅，所以任何登入者都可以問。
 */
export const GET = handle(async () => {
  const { user } = await requireUser();
  const impersonation = await loadActiveImpersonation(user.id);
  if (!impersonation) return ok({ active: false });

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from('tenants')
    .select('name, shop_code')
    .eq('id', impersonation.tenantId)
    .maybeSingle();
  if (error) throw error;

  return ok({
    active: true,
    tenantId: impersonation.tenantId,
    tenantName: (data?.name as string) ?? '',
    shopCode: (data?.shop_code as string) ?? '',
    expiresAt: impersonation.expiresAt,
  });
});
