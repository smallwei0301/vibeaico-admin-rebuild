// src/server/external-calendars.ts — external_calendars CRUD 共用邏輯（Issue #21）。
//
// 這裡只放「CRUD route 直接會用到」的 schema／select／mapping，sync 本身（ICS
// 抓取＋解析＋寫回快取）在 `src/server/external-calendar-sync.ts`，兩者分開是
// 因為 CRUD 用 session-bound client（RLS 生效），sync 用 service role
// （cron 沒有使用者 session，且 sync rpc 本身是 service-role-only）。
import { z } from 'zod';

export type ExternalCalendarStatus = 'NEVER_SYNCED' | 'OK' | 'ERROR';

export type ExternalCalendarRow = {
  id: string;
  tenant_id: string;
  staff_id: string | null;
  name: string;
  ics_url: string;
  last_synced_at: string | null;
  last_sync_status: ExternalCalendarStatus;
  last_sync_error: string | null;
  active: boolean;
  created_at: string;
};

export type ExternalCalendar = {
  id: string;
  staffId: string | null;
  name: string;
  icsUrl: string;
  lastSyncedAt: string | null;
  lastSyncStatus: ExternalCalendarStatus;
  lastSyncError: string | null;
  active: boolean;
  createdAt: string;
};

export const EXTERNAL_CALENDAR_SELECT =
  'id, tenant_id, staff_id, name, ics_url, last_synced_at, last_sync_status, last_sync_error, active, created_at';

export function mapExternalCalendar(row: ExternalCalendarRow): ExternalCalendar {
  return {
    id: row.id,
    staffId: row.staff_id,
    name: row.name,
    icsUrl: row.ics_url,
    lastSyncedAt: row.last_synced_at,
    lastSyncStatus: row.last_sync_status,
    lastSyncError: row.last_sync_error,
    active: row.active,
    createdAt: row.created_at,
  };
}

/**
 * `ics_url` 的形狀驗證：只是 zod `.url()` 加上 scheme 限制——**不是** SSRF 防護
 * 本身（那必須在真正發出請求的當下靠 DNS 解析做，見
 * `src/server/ssrf-guard.ts` 檔頭），這裡只擋掉一望即知不可能是合法 ICS 來源
 * 的輸入（空字串、`javascript:`、`file://`……），減少明顯垃圾寫進資料庫。
 */
export const externalCalendarWriteSchema = z.object({
  name: z.string().trim().min(1, '請輸入名稱').max(100),
  icsUrl: z.string().trim().url('請輸入合法的網址').refine(
    (v) => /^https?:\/\//i.test(v),
    '僅支援 http(s) 網址',
  ),
  staffId: z.string().uuid().nullable().optional(),
});
