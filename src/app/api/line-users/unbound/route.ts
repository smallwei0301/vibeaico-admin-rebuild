import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * GET /api/line-users/unbound — followed=true 且 customer_id is null
 * （04 分冊 §B-5.1，綁定顧客用的候選清單）。加入時間新→舊。
 */
export const GET = handle(async () => {
  const t = await requireTenant();

  const { data, error } = await t.supabase
    .from('line_users')
    .select('line_user_id, display_name, picture_url, created_at')
    .eq('tenant_id', t.tenantId)
    .eq('followed', true)
    .is('customer_id', null)
    .order('created_at', { ascending: false });
  if (error) throw error;

  return ok(
    (data ?? []).map((r) => ({
      lineUserId: r.line_user_id as string,
      displayName: (r.display_name ?? '') as string,
      pictureUrl: (r.picture_url ?? '') as string,
      createdAt: r.created_at as string,
    })),
  );
});
