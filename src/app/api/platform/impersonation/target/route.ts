import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requirePlatformAdmin } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';

/**
 * GET /api/platform/impersonation/target?guide=…｜?tenantId=… —— 確認畫面要顯示哪一家店。
 *
 * ⚠️ 21 分冊 §2.1 原本只列了 start／end／current 三支。實作時發現少了這一支，
 * 確認畫面就只能寫「你要進入：（不知道哪一家）」——那等於沒有確認畫面。
 * 補上並在此註明，不當作原規格已有。
 *
 * 只回店名與代碼，不回這家店的任何業務資料：這一步的問題是「我要進的是不是這家」，
 * 不是「這家店裡有什麼」。
 */
const querySchema = z
  .object({
    guide: z.string().uuid().optional(),
    tenantId: z.string().uuid().optional(),
  })
  .refine((q) => Boolean(q.guide) !== Boolean(q.tenantId), {
    message: '請指定 guide 或 tenantId 其中一個',
  });

export const GET = handle(async (req) => {
  await requirePlatformAdmin();
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

  const admin = createAdminSupabase();
  let query = admin.from('tenants').select('id, name, shop_code, business_type');
  query = q.tenantId ? query.eq('id', q.tenantId) : query.eq('midao_guide_id', q.guide!);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new ApiHttpError(
      404,
      q.guide ? '這位導遊尚未對應到任何店家' : '找不到該店家',
      ERR.NOT_FOUND,
    );
  }
  return ok({
    tenantId: data.id,
    tenantName: data.name,
    shopCode: data.shop_code,
    businessType: data.business_type,
  });
});
