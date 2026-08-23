// GET /api/points/balance — {balance} = 該租戶 tenant_point_transactions 最新
// 一筆（created_at desc）的 balance_after；無紀錄 = 0（04 分冊 §B-4）。
// 排序補 id desc 打平同毫秒並發（與 0012 transfer_tenant_points rpc 的取法一致）。
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

export const GET = handle(async () => {
  const t = await requireTenant();

  const { data, error } = await t.supabase
    .from('tenant_point_transactions')
    .select('balance_after')
    .eq('tenant_id', t.tenantId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;

  return ok({ balance: data?.balance_after ?? 0 });
});
