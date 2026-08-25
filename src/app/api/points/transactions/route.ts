// GET /api/points/transactions — 分頁 Paged<PointTransaction>（04 分冊 §B-4）。
// 資料源 tenant_point_transactions（店家平台點數錢包），created_at desc。
import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { pageRange, toPaged, pageSizeSchema } from '@/server/paging';
import { mapPointTransaction } from '@/server/mappers';

const querySchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  size: pageSizeSchema(20),
});

export const GET = handle(async (req) => {
  const t = await requireTenant();
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const { from, to, page, size } = pageRange(q.page, q.size);

  const { data, count, error } = await t.supabase
    .from('tenant_point_transactions')
    .select('*', { count: 'exact' })
    .eq('tenant_id', t.tenantId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to);
  if (error) throw error;

  return ok(toPaged((data ?? []).map(mapPointTransaction), count, page, size));
});
