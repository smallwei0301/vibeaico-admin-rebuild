/**
 * GET /api/cron/tour-order-expiry — 逾期未付款旅遊訂單釋放名額【佔位】。
 *
 * 正式邏輯屬 Phase 10（docs/integration/10-TOUR-DOMAIN.md §3）：
 *   - 綠界（線上刷卡）：下單 + 30 分鐘未付 → 釋放名額、訂單 CANCELLED
 *   - 匯款：下單 + 3 天未付 → 同上（hold_expires_at 名額保留期限）
 * tour_orders / trip_departures 等表尚未建（Phase 10 才落地），此端點先佔住
 * vercel.json 的 cron 排程位（30 * * * *，每小時），驗證 Bearer 後直接回報跳過。
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return new Response('unauthorized', { status: 401 });

  return NextResponse.json({ skipped: true, reason: 'tour tables not built (Phase 10)' });
}
