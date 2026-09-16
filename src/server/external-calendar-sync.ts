// src/server/external-calendar-sync.ts — 單一 external_calendars 訂閱的同步邏輯
// （Issue #21）：安全抓取 ICS → 解析 → 原子替換快取，或誠實記錄失敗並保留舊快取。
//
// 呼叫端（cron route）逐一呼叫 `syncExternalCalendar`，每一筆都各自 try/catch
// 隔離——見 `src/app/api/cron/external-calendars-sync/route.ts`。這個檔案本身
// 對單一筆呼叫**不丟例外**：所有可預期的失敗（SSRF 擋下、抓取失敗、解析失敗、
// rpc 失敗）都被吃下來，轉成 `{ ok: false, error }` 回傳，理由是「一個來源壞了
// 不能讓呼叫端不小心忘記包 try/catch 就整個中斷」——雖然 cron route 自己也有包
// try/catch（雙保險，PB 系列教訓：光靠呼叫端記得包不夠可靠）。
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchTextWithSsrfGuard, SsrfBlockedError } from './ssrf-guard';
import { parseIcs } from './ics-parser';

export type ExternalCalendarSubscription = {
  id: string;
  tenantId: string;
  icsUrl: string;
};

export type SyncResult =
  | { ok: true; eventCount: number }
  | { ok: false; error: string };

/**
 * 跨租戶抓出所有 `active=true` 的訂閱（cron 用）。刻意用 service role：cron
 * 沒有任何使用者 session，且要一次看到全部租戶。
 */
export async function listActiveExternalCalendars(
  admin: SupabaseClient,
): Promise<ExternalCalendarSubscription[]> {
  const { data, error } = await admin
    .from('external_calendars')
    .select('id, tenant_id, ics_url')
    .eq('active', true);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id as string,
    tenantId: r.tenant_id as string,
    icsUrl: r.ics_url as string,
  }));
}

export async function syncExternalCalendar(
  admin: SupabaseClient,
  subscription: ExternalCalendarSubscription,
): Promise<SyncResult> {
  let icsText: string;
  try {
    icsText = await fetchTextWithSsrfGuard(subscription.icsUrl);
  } catch (error) {
    const message = error instanceof SsrfBlockedError
      ? error.message
      : `抓取 ICS 失敗：${error instanceof Error ? error.message : String(error)}`;
    return recordFailure(admin, subscription, message);
  }

  let events;
  try {
    events = parseIcs(icsText);
  } catch (error) {
    return recordFailure(
      admin, subscription,
      `解析 ICS 失敗：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const payload = events.map((e) => ({
    uid: e.uid, title: e.title, start_at: e.startAt, end_at: e.endAt, all_day: e.allDay,
  }));

  const { error: rpcError } = await admin.rpc('sync_replace_external_calendar_events', {
    p_external_calendar_id: subscription.id,
    p_tenant_id: subscription.tenantId,
    p_events: payload,
  });
  if (rpcError) {
    // rpc 本身失敗（例如 subscription 剛好被刪除）：一樣走失敗記錄路徑，
    // 舊快取（如果還存在）不受影響——這支 rpc 失敗代表它完全沒有執行過任何
    // delete/insert（整個 function body 在同一個 transaction 內）。
    return recordFailure(admin, subscription, `寫入快取失敗：${rpcError.message}`);
  }

  return { ok: true, eventCount: payload.length };
}

async function recordFailure(
  admin: SupabaseClient,
  subscription: ExternalCalendarSubscription,
  message: string,
): Promise<SyncResult> {
  const { error } = await admin.rpc('mark_external_calendar_sync_error', {
    p_external_calendar_id: subscription.id,
    p_tenant_id: subscription.tenantId,
    p_error: message,
  });
  if (error) {
    // 連「記錄失敗」這件事本身都失敗了（理論上只會是資料庫本身有問題）——
    // 仍然誠實回報原始失敗訊息，不要因為記錄失敗而掩蓋真正的錯誤原因。
    console.error('[external-calendar-sync] mark_external_calendar_sync_error 失敗', error);
  }
  return { ok: false, error: message };
}
