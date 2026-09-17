/**
 * 預約加購（issue #17）型別 — PREPARE 階段獨立檔案。
 *
 * 為什麼不放進 `src/lib/types.ts`：#530 staged schema release 政策
 * （`scripts/agents/schema-staged-release-policy.mjs`）要求「同一個 PR 裡
 * migration 與 Product runtime 一起出現」時，被改到的每一個 runtime path
 * （`src/(app|components|config|features|lib|pages|server|services)/**`）
 * 裡的每一個 export 都必須被 default-off gate 擋住。`src/lib/types.ts` 是
 * 純 type 檔但仍落在 `lib/**` 這個受掃檔案清單裡，而且它沒有任何
 * function-shaped export 可以掛 gate（純 type/interface 不是「可呼叫的
 * entry」），會被判定成「沒有任何受 gate 控制的 exported entry」而擋下整個
 * PR；即使技術上繞得過去，牽動這個全域共用契約檔也會讓既有欄位的下游全部
 * 重新過一次 diff 審查，違反 PREPARE 階段「範圍收斂到全新、彼此獨立檔案」
 * 的精神。`src/types/` 不在上面那個 runtimePath 正則涵蓋的清單內，因此完全
 * 不會被這個 guard 掃到，是本階段安放新型別最乾淨的位置。等 ACTIVATE PR
 * 真正接線時，這裡的型別可以照原計畫搬進 `src/lib/types.ts`（extend-only）。
 */

/** C+ 業績歸戶三態；staff_id=null 不得同時代表 INHERIT 與 NONE，見 0119 migration 檔頭。 */
export type BookingAddonPerformanceMode = 'INHERIT' | 'SPECIFIC_STAFF' | 'NONE';

/** 消費明細通知的實際結果；notified='NONE' 時代表沒有要求通知（見 0082 canonical 值域）。 */
export type BookingAddonNotifiedOutcome =
  'NONE' | 'LINE' | 'NO_LINE' | 'NOT_CONFIGURED' | 'QUOTA_EXCEEDED' | 'FAILED';

export type BookingAddon = {
  id: string;
  bookingId: string;
  serviceId: string | null;
  name: string;
  price: number;
  quantity: number;
  durationMinutes: number;
  /** 執行人員（僅紀錄「誰做的」，不參與業績歸戶——業績歸戶看 performanceMode/performanceStaffId） */
  staffId: string | null;
  staffName: string | null;
  appliedAmount: number;
  appliedMinutes: number;
  performanceMode: BookingAddonPerformanceMode;
  performanceStaffId: string | null;
  performanceStaffName: string | null;
  notificationRequested: boolean;
  notified: BookingAddonNotifiedOutcome;
  createdAt: string;
};

export type CreateBookingAddonPayload = {
  serviceId?: string | null;
  name: string;
  price: number;
  quantity: number;
  durationMinutes: number;
  staffId?: string | null;
  performanceMode: BookingAddonPerformanceMode;
  performanceStaffId?: string | null;
  notify: boolean;
  /** 由呼叫端（未來 AddonModal 開啟時）產生一次、同一次送出/重試流程沿用同一把。 */
  idempotencyKey: string;
};

export type CreateBookingAddonResult = {
  id: string;
  appliedAmount: number;
  appliedMinutes: number;
  finalPrice: number;
  durationMinutes: number;
  endAt: string;
  performanceMode: BookingAddonPerformanceMode;
  performanceStaffId: string | null;
  notified: BookingAddonNotifiedOutcome;
  /** true = 這把 idempotency key 先前已經成功過，本次是回放，沒有再次套用金額或通知顧客。 */
  replayed: boolean;
};

export type DeleteBookingAddonResult = {
  finalPrice: number;
  durationMinutes: number;
  endAt: string;
  alreadyDeleted: boolean;
};
