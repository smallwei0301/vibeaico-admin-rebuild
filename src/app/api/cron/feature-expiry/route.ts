/**
 * GET /api/cron/feature-expiry — 功能訂閱到期副作用（09 分冊 §6，07 分冊 crons）。
 * 每日執行（vercel.json：0 17 * * * = 台北 01:00）。
 *
 * 逐店處理 expires_at < now() 的訂閱列：
 *  1. COUPON_SYSTEM 到期 → 該店 PUBLISHED 票券改 PAUSED + auto_paused_by_feature=true
 *  2. PRODUCT_SALES 到期 → 該店 active 商品改 active=false + auto_paused_by_feature=true
 *  3. 其他功能到期不動資料（原站原則：資料保留、對外功能暫停），§5 閘門自然失效。
 *
 * 冪等：update 條件本身帶 status='PUBLISHED' / active=true，已 PAUSED / 已下架的
 * 列不會再被匹配，重跑不會重複計數（計數 = update 實際受影響列數）。
 * 單店失敗只 log，不中斷整批（07 分冊慣例）。
 */
import { NextResponse } from 'next/server';
import { createAdminSupabase } from '@/server/supabase';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return new Response('unauthorized', { status: 401 });

  const admin = createAdminSupabase();
  const nowIso = new Date().toISOString();

  // 全部已到期的訂閱列（不限功能碼——processedTenants 統計逐店處理的範圍）
  const { data: expired, error } = await admin
    .from('feature_subscriptions')
    .select('tenant_id, code')
    .not('expires_at', 'is', null)
    .lt('expires_at', nowIso);
  if (error) {
    console.error('[cron] feature-expiry: 查詢到期訂閱失敗', error);
    return new Response('query failed', { status: 500 });
  }

  const tenants = [...new Set((expired ?? []).map((r) => r.tenant_id as string))];
  let pausedCoupons = 0;
  let pausedProducts = 0;

  for (const tenantId of tenants) {
    const codes = new Set(
      (expired ?? []).filter((r) => r.tenant_id === tenantId).map((r) => r.code as string),
    );
    try {
      if (codes.has('COUPON_SYSTEM')) {
        const { data: rows, error: eC } = await admin
          .from('coupons')
          .update({ status: 'PAUSED', auto_paused_by_feature: true })
          .eq('tenant_id', tenantId)
          .eq('status', 'PUBLISHED')
          .select('id');
        if (eC) throw eC;
        pausedCoupons += (rows ?? []).length;
      }
      if (codes.has('PRODUCT_SALES')) {
        const { data: rows, error: eP } = await admin
          .from('products')
          .update({ active: false, auto_paused_by_feature: true })
          .eq('tenant_id', tenantId)
          .eq('active', true)
          .select('id');
        if (eP) throw eP;
        pausedProducts += (rows ?? []).length;
      }
    } catch (e) {
      console.error('[cron] feature-expiry: 單店處理失敗', tenantId, e);
    }
  }

  return NextResponse.json({ processedTenants: tenants.length, pausedCoupons, pausedProducts });
}
