/**
 * GET /api/cron/tour-order-expiry — 逾期未付款旅遊訂單釋放名額（10 分冊 §3）。
 *
 * ⚠️ 這支原本是**佔位路由**，驗完 Bearer 就回
 * `{ skipped: true, reason: 'tour tables not built (Phase 10)' }`。
 * 那句理由在 `0066` 建好 trips/plans/departures 之後就已經半假、在 `0087` 建好
 * `tour_orders` 之後完全不成立——留著它，畫面上的排程看起來在跑，實際上每天回一句
 * 「表還沒建」。#8-B 讓它真的做事。
 *
 * 邏輯（10 分冊 §3 的表格）：
 *   綠界（線上刷卡） hold_expires_at = 下單 + 30 分鐘
 *   匯款             hold_expires_at = 下單 + 3 天（租戶可設定）
 *   LINE / 手動單    hold_expires_at = null → **不自動過期**，由導遊管理
 *
 * 所以這支不自己算期限，只認 `hold_expires_at`：**是誰、依什麼規則寫進那個欄位，
 * 是建單端的事**。cron 重新推導一次期限的話，兩邊規則一旦分歧，訂單會在導遊完全
 * 沒預期的時間被取消。
 *
 * 每一筆都走 `cancel_tour_order` rpc —— 改狀態與釋放名額同一交易，且該 rpc 自己
 * 擋掉已是終態的單，所以本 cron 重跑不會重複釋放名額（回 false 就跳過）。
 *
 * 單筆失敗只 log 不中斷整批（07 分冊慣例）。回 { scanned, cancelled }。
 */
import { NextResponse } from 'next/server';
import { createAdminSupabase } from '@/server/supabase';

export const runtime = 'nodejs';

/** 一輪最多處理的筆數：避免單次執行時間失控，剩下的下一輪接手（不會漏，只是慢） */
const BATCH_LIMIT = 500;

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return new Response('unauthorized', { status: 401 });

  const admin = createAdminSupabase();
  const nowIso = new Date().toISOString();

  // 只掃 PENDING 且已過期。CONFIRMED（已收款）永遠不被 cron 取消——
  // 那是店家的錢已經收了，自動取消等於替他退團。
  const { data: rows, error } = await admin
    .from('tour_orders')
    .select('id, tenant_id')
    .eq('status', 'PENDING')
    .not('hold_expires_at', 'is', null)
    .lt('hold_expires_at', nowIso)
    .order('hold_expires_at', { ascending: true })
    .limit(BATCH_LIMIT);
  if (error) {
    console.error('[cron] tour-order-expiry: 查詢 tour_orders 失敗', error);
    return new Response('query failed', { status: 500 });
  }

  let cancelled = 0;
  for (const row of rows ?? []) {
    try {
      const { data: released, error: rpcError } = await admin.rpc('cancel_tour_order', {
        p_tenant: row.tenant_id,
        p_order: row.id,
        p_reason: '未在保留期限內完成付款，系統自動取消',
      });
      if (rpcError) throw rpcError;
      if (released === true) cancelled++;
    } catch (e) {
      console.error('[cron] tour-order-expiry: 取消失敗', row.tenant_id, row.id, e);
    }
  }

  return NextResponse.json({ scanned: rows?.length ?? 0, cancelled });
}
