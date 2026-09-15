import { adapt, request } from '@/lib/api';
import type { BusinessType } from '@/config/modes';
import { MOCK_MODE } from '@/mock';

/**
 * 外部行事曆訂閱（/tenant/calendar-sync 頁「匯入外部行事曆」區塊，Issue #21）。
 * real 分支打 `/api/external-calendars`；mock 分支維持一份 per-mode 的假倉庫
 * （延遲初始化，呼叫當下才讀 `MOCK_MODE`——`src/mock/index.ts` 檔頭那條規則：
 * 絕不可在 module scope 凍結某一種業態的資料），新增/刪除在同一頁面 session
 * 內可讀回，行為與 `bookings.ts` 的 block-times mock store 同一套道理。
 *
 * `lastSyncStatus` 誠實反映三態：'NEVER_SYNCED'（尚未同步，`lastSyncedAt` 必為
 * null）／'OK'（`lastSyncedAt` 是上次成功時間）／'ERROR'（`lastSyncError` 帶
 * 真實錯誤訊息，`lastSyncedAt` 維持上一次成功的時間，不因這次失敗而清空——見
 * `src/server/external-calendar-sync.ts` 的失敗路徑）。
 */
export type ExternalCalendarSubscription = {
  id: string;
  staffId: string | null;
  name: string;
  icsUrl: string;
  lastSyncedAt: string | null;
  lastSyncStatus: 'NEVER_SYNCED' | 'OK' | 'ERROR';
  lastSyncError: string | null;
  active: boolean;
  createdAt: string;
};

const mockStore = new Map<BusinessType, ExternalCalendarSubscription[]>();

function seedForMode(): ExternalCalendarSubscription[] {
  return [
    {
      id: 'ec_1', staffId: null, name: 'Booking.com 名單',
      icsUrl: 'https://calendar.google.com/calendar/ical/demo/private-abc/basic.ics',
      lastSyncedAt: '2026-08-20T09:15:00+08:00', lastSyncStatus: 'OK', lastSyncError: null,
      active: true, createdAt: '2026-08-01T00:00:00+08:00',
    },
    {
      id: 'ec_2', staffId: null, name: '老闆私人行程',
      icsUrl: 'https://calendar.google.com/calendar/ical/demo/private-xyz/basic.ics',
      lastSyncedAt: null, lastSyncStatus: 'ERROR', lastSyncError: '無法連線到來源伺服器',
      active: true, createdAt: '2026-08-10T00:00:00+08:00',
    },
  ];
}

function getMockState(): ExternalCalendarSubscription[] {
  const mode = MOCK_MODE;
  let state = mockStore.get(mode);
  if (!state) {
    state = seedForMode();
    mockStore.set(mode, state);
  }
  return state;
}

export const listExternalCalendars = () =>
  adapt<ExternalCalendarSubscription[]>(
    () => [...getMockState()],
    () => request<ExternalCalendarSubscription[]>('/api/external-calendars'),
  );

export const createExternalCalendar = (input: { name: string; icsUrl: string; staffId?: string | null }) =>
  adapt<{ id: string }>(
    () => {
      const state = getMockState();
      const id = `ec_new_${state.length + 1}_${Date.now()}`;
      state.push({
        id, staffId: input.staffId ?? null, name: input.name, icsUrl: input.icsUrl,
        lastSyncedAt: null, lastSyncStatus: 'NEVER_SYNCED', lastSyncError: null,
        active: true, createdAt: new Date().toISOString(),
      });
      return { id };
    },
    () => request<{ id: string }>('/api/external-calendars', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );

export const deleteExternalCalendar = (id: string) =>
  adapt<void>(
    () => {
      const state = getMockState();
      const idx = state.findIndex((x) => x.id === id);
      if (idx >= 0) state.splice(idx, 1);
      return undefined;
    },
    () => request<void>(`/api/external-calendars/${id}`, { method: 'DELETE' }),
  );
