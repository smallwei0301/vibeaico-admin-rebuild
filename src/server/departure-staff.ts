/**
 * src/server/departure-staff.ts — 團次導遊指派（issue #37 §3、§4）
 * -----------------------------------------------------------------------------
 * 這裡放三件事：0/1/2+ 的自動適應、儲存前的撞班驗證、以及把指派寫進
 * `trip_departure_staff`。`src/server/staff-availability.ts` 只負責「誰在什麼時候
 * 有空」，這個檔負責「這一團該由誰帶、能不能存」。
 *
 * ## 0/1/2+ 為什麼在 server 而不是只在 UI
 *
 * Owner 2026-08-27 裁示「不做 SOLO／TEAM 開關；UI 依 active+bookable 導遊數量自動
 * 適應」。UI 自動適應的代價是**請求裡可能沒有 primaryStaffId**——單人店的畫面根本
 * 不會顯示選擇器。那個情況下 server 必須自己解析出唯一導遊並正式寫進
 * `trip_departure_staff`，而不是建立一個「未指派」的團次然後在畫面上假裝有人帶。
 *
 * 三種情況（§3）：
 *
 *   - **0 位**：OPEN 團次不得建立，回可理解的「請先新增導遊」，不產生未指派半成品。
 *   - **1 位**：server 自動套用唯一導遊為 PRIMARY。
 *   - **2 位以上**：必須明講 `primaryStaffId`；`assistantStaffIds[]` 選填。
 *
 * ⚠️ 「0 位擋 OPEN」只擋 OPEN。CLOSED／CANCELLED 團次允許沒有導遊——它們不收報名，
 * 擋下來只會讓店家連「先把舊團關掉」都做不到。
 *
 * ## 相容策略：既有團次可以是「未指派」，但編輯過就不行了
 *
 * `10-TOUR-DOMAIN.md` §1.3 有兩句，兩句都要照做：
 *
 *   1. 「既有團次可暫時誠實顯示『未指派』」——所以本檔**不替任何舊資料補主導遊**，
 *      讀出來是 null 就是 null。
 *   2. 「但新建或**重新編輯**且狀態為 OPEN 的團次，完成後必須有一位 PRIMARY」——
 *      所以更新一個 OPEN 團次時同樣會要求 PRIMARY，即使這次請求沒碰指派欄位。
 *
 * 第 2 條只會咬到「2 位以上導遊 ＋ 舊的未指派 ＋ 狀態 OPEN」這一種組合：單人店在
 * 上一步就自動補上了，而 2 位以上的店畫面本來就顯示選擇器。錯誤訊息會明講是
 * 「這個團次目前是未指派」，不是丟一句看不懂的「請指定」。
 *
 * 請求沒帶的指派欄位一律**沿用既有值**，不當成「清空」——否則一次「只改名額」的
 * 儲存會把既有的協同導遊靜默刪掉。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiHttpError, ERR, STAFF_OCCUPIED_MESSAGE } from '@/server/http';
import { createAdminSupabase } from '@/server/supabase';
import {
  CONFLICT_REASON_TEXT, departureInterval, departureSnapshotMinutes, findStaffConflicts, loadStaffLoad,
  type Interval, type StaffConflict,
} from '@/server/staff-availability';

export type AssignmentInput = {
  primaryStaffId?: string | null;
  assistantStaffIds?: string[];
};

export type ResolvedAssignment = {
  primaryStaffId: string | null;
  assistantStaffIds: string[];
};

/** 同租戶可接案（active + bookable）的人員 id，依名稱排序讓「唯一一位」是穩定的。 */
export async function bookableStaffIds(supabase: SupabaseClient, tenantId: string): Promise<string[]> {
  const { data, error } = await supabase.from('staff').select('id, name')
    .eq('tenant_id', tenantId).eq('active', true).eq('bookable', true)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((s) => s.id);
}

export async function staffNames(
  supabase: SupabaseClient, tenantId: string, ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from('staff').select('id, name')
    .eq('tenant_id', tenantId).in('id', ids);
  if (error) throw error;
  return new Map((data ?? []).map((s) => [s.id as string, (s.name ?? '') as string]));
}

/**
 * 把請求裡的指派意圖，套上 0/1/2+ 規則變成實際要寫入的指派。
 *
 * 純函式：`bookable` 由呼叫端查好傳進來，讓這條規則本身可以被單元測試直接驗證。
 * `status` 參與判斷是因為「0 位導遊」只擋 OPEN（見檔頭）。
 */
export function resolveAssignment(input: {
  requested: AssignmentInput;
  bookable: string[];
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  /** 既有指派；更新既有團次且請求未帶任何指派欄位時沿用。 */
  existing?: ResolvedAssignment;
}): ResolvedAssignment {
  const { requested, bookable, status } = input;

  // 請求沒帶的欄位沿用既有指派（更新既有團次時），而不是被當成「清空」。
  const assistants = [...new Set(requested.assistantStaffIds ?? input.existing?.assistantStaffIds ?? [])];
  let primary = requested.primaryStaffId !== undefined
    ? requested.primaryStaffId
    : input.existing?.primaryStaffId ?? null;

  if (bookable.length === 0) {
    if (status === 'OPEN') {
      throw new ApiHttpError(400, '目前沒有可接案的導遊，請先在「員工」新增一位可接案人員後再開團', ERR.VALIDATION);
    }
    return { primaryStaffId: null, assistantStaffIds: [] };
  }

  // 1 位：畫面不顯示選擇器，所以請求裡不會有 primaryStaffId——由 server 補上。
  if (bookable.length === 1 && primary == null && assistants.length === 0) {
    primary = bookable[0];
  }

  // §1.3：「新建或**重新編輯**且狀態為 OPEN 的團次，完成後必須有一位 PRIMARY。」
  // 所以這一條在更新時同樣成立——一個舊的未指派 OPEN 團次被編輯過之後，就不該
  // 再是未指派。單人店在上面那一步已自動補上，只有 2 位以上的店會走到這裡，
  // 而那種店的畫面本來就會顯示選擇器。訊息必須說清楚為什麼，不能只回「請指定」。
  if (status === 'OPEN' && primary == null) {
    throw new ApiHttpError(
      400,
      '開放報名的團次必須指定一位主導遊；這個團次目前是未指派，請一併選擇主導遊後再儲存',
      ERR.VALIDATION,
    );
  }

  if (primary != null && assistants.includes(primary)) {
    throw new ApiHttpError(400, '同一位導遊不能同時是主導遊與協同導遊', ERR.VALIDATION);
  }

  return { primaryStaffId: primary, assistantStaffIds: assistants };
}

/** 指派涉及的所有人員必須同租戶、active、bookable。跨租戶 id 一律拒絕（§5.4）。 */
export function assertStaffBelongsToTenant(assignment: ResolvedAssignment, bookable: string[]): void {
  const pool = new Set(bookable);
  const ids = [assignment.primaryStaffId, ...assignment.assistantStaffIds].filter((v): v is string => !!v);
  for (const id of ids) {
    if (!pool.has(id)) {
      throw new ApiHttpError(404, '找不到此服務人員，或該人員目前不可接案', ERR.NOT_FOUND);
    }
  }
}

export type ConflictDetail = StaffConflict & { staffName: string; text: string };

/** 把衝突清單變成一句店家看得懂的話。§5.1：不只回 409，要說明來源與時間。 */
export function describeConflicts(details: ConflictDetail[]): string {
  return details.map((d) => `${d.staffName || d.staffId}：${d.text}`).join('；');
}

/**
 * 儲存前的撞班檢查。前端只做提示，**這裡才是權威**——兩個管理者同時操作時，
 * 前端看到的可用性早就過期了（§5.1 最後一句）。
 */
export async function checkAssignmentConflicts(
  supabase: SupabaseClient,
  tenantId: string,
  assignment: ResolvedAssignment,
  slot: Interval,
  shiftDate: string,
  options: { excludeDepartureId?: string } = {},
): Promise<ConflictDetail[]> {
  const ids = [assignment.primaryStaffId, ...assignment.assistantStaffIds].filter((v): v is string => !!v);
  if (ids.length === 0) return [];
  const load = await loadStaffLoad(supabase, tenantId, slot.start, slot.end, options);
  const conflicts = findStaffConflicts(ids, slot, shiftDate, load);
  if (conflicts.length === 0) return [];
  const names = await staffNames(supabase, tenantId, conflicts.map((c) => c.staffId));
  return conflicts.map((c) => ({
    ...c,
    staffName: names.get(c.staffId) ?? '',
    text: CONFLICT_REASON_TEXT[c.reason],
  }));
}

/** 導遊撞班的 409；`staffId` 取自 DB 例外 detail（拿得到時），讓 batch 能記錄實際撞班的導遊。 */
export class StaffOccupiedError extends ApiHttpError {
  constructor(public staffId?: string) {
    super(409, STAFF_OCCUPIED_MESSAGE, ERR.STAFF_OCCUPIED);
  }
}

export const STAFF_UNAVAILABLE_MESSAGE = '導遊已停用或不存在，請重新選擇';

function staffIdFromDetail(error: unknown): string | undefined {
  try {
    const detail = (error as { details?: string | null })?.details;
    const id = detail ? (JSON.parse(detail) as { staffId?: unknown }).staffId : undefined;
    return typeof id === 'string' ? id : undefined;
  } catch {
    return undefined;
  }
}

/** DB 排他衝突：SQLSTATE P0020／message STAFF_OCCUPIED（0138 之後），或排他約束 23P01。 */
export function isStaffOccupiedError(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null | undefined;
  return !!e && (e.code === 'P0020' || e.code === '23P01' || String(e.message ?? '').includes('STAFF_OCCUPIED'));
}

/**
 * 覆寫某一團的指派。
 *
 * 呼叫 `replace_trip_departure_staff`（0131）：刪除與插入在**同一個交易**。先前 app 端分兩次請求
 * 先刪後插，插入被 0138 占用 trigger 擋下時，刪除已 commit，導遊會被清空；改為 RPC 後失敗即整體回滾，
 * 原指派原封不動。RPC 只授權 service_role，所以這裡用 admin client；租戶授權已由呼叫端的
 * `requireTenantManager()` 完成，RPC 另以 `p_tenant` 做同租戶檢查。
 *
 * ⚠️ 每團最多一位 PRIMARY 與同人不得重複由 RPC／DB 保證；違反一律轉成可讀的 409 而不是 500。
 * 導遊撞班（P0020，或既有排他約束 23P01）轉成 409 `STAFF_OCCUPIED`。
 */
export async function writeAssignment(
  _supabase: SupabaseClient,
  tenantId: string,
  departureId: string,
  assignment: ResolvedAssignment,
): Promise<void> {
  const { error } = await createAdminSupabase().rpc('replace_trip_departure_staff', {
    p_tenant: tenantId,
    p_departure: departureId,
    p_primary: assignment.primaryStaffId,
    p_assistants: assignment.assistantStaffIds,
  });
  if (!error) return;
  if (isStaffOccupiedError(error)) throw new StaffOccupiedError(staffIdFromDetail(error));
  // 預檢之後導遊才被停用或刪除的競態：RPC 以 P0002 STAFF_NOT_FOUND 拒絕，回 409 而不是 500。
  if (String(error.message ?? '').includes('STAFF_NOT_FOUND')) {
    throw new ApiHttpError(409, STAFF_UNAVAILABLE_MESSAGE, ERR.CONFLICT);
  }
  if (error.code === '23505' || String(error.message ?? '').includes('DUPLICATE_STAFF_ASSIGNMENT')) {
    throw new ApiHttpError(409, '同一團次已有主導遊，或同一位導遊被重複指派', ERR.CONFLICT);
  }
  throw error;
}

/**
 * 新建團次後指派失敗時，移除剛建立、尚無導遊與訂單的團次，避免留下「沒有導遊的半成品」
 * （issue #37 §3）。刪除失敗只記 log，仍由呼叫端拋出原始錯誤。
 */
export async function discardUnassignedDeparture(
  supabase: SupabaseClient, tenantId: string, departureId: string,
): Promise<void> {
  const { error } = await supabase.from('trip_departures').delete()
    .eq('tenant_id', tenantId).eq('id', departureId);
  if (error) console.error('[departure-staff] 指派失敗後移除團次也失敗', departureId, error);
}

/** 讀回一團的指派（含姓名），給列表與編輯頁用。 */
export async function readAssignments(
  supabase: SupabaseClient, tenantId: string, departureIds: string[],
): Promise<Map<string, ResolvedAssignment & { primaryStaffName: string; assistantStaffNames: string[] }>> {
  const result = new Map<string, ResolvedAssignment & { primaryStaffName: string; assistantStaffNames: string[] }>();
  if (departureIds.length === 0) return result;
  const { data, error } = await supabase.from('trip_departure_staff')
    .select('departure_id, staff_id, role, staff(name)')
    .eq('tenant_id', tenantId).in('departure_id', departureIds);
  if (error) throw error;
  for (const id of departureIds) {
    result.set(id, { primaryStaffId: null, primaryStaffName: '', assistantStaffIds: [], assistantStaffNames: [] });
  }
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const entry = result.get(String(row.departure_id));
    if (!entry) continue;
    const staff = (Array.isArray(row.staff) ? row.staff[0] : row.staff) as undefined | { name: string };
    const name = staff?.name ?? '';
    if (row.role === 'PRIMARY') {
      entry.primaryStaffId = String(row.staff_id);
      entry.primaryStaffName = name;
    } else {
      entry.assistantStaffIds.push(String(row.staff_id));
      entry.assistantStaffNames.push(name);
    }
  }
  return result;
}

/**
 * 團次的佔用區間 ＋ 它所屬的台北日期（班表判斷用）。
 *
 * 時長＝`departureSnapshotMinutes(plan.duration_minutes, trips.duration_hours)`：與 #46 DB 建團時 snapshot 的公式相同
 * （行程時長未知則整日）。給 `planId` 才讀方案；沒給則只看行程 `duration_hours`（舊行為）。
 */
export async function departureSlot(
  supabase: SupabaseClient, tenantId: string, tripId: string,
  departsOn: string, startTime: string | null,
  source: { planId?: string } = {},
): Promise<Interval & { wholeDay: boolean; shiftDate: string }> {
  const { data, error } = await supabase.from('trips').select('duration_hours')
    .eq('tenant_id', tenantId).eq('id', tripId).maybeSingle();
  if (error) throw error;
  const durationHours = data?.duration_hours ?? null;
  let durationMinutes: number | null | undefined;
  if (source.planId) {
    const { data: plan, error: planError } = await supabase.from('trip_plans').select('duration_minutes')
      .eq('tenant_id', tenantId).eq('id', source.planId).maybeSingle();
    if (planError) throw planError;
    durationMinutes = departureSnapshotMinutes(
      (plan as { duration_minutes?: number | null } | null)?.duration_minutes, durationHours);
  }
  const interval = departureInterval({ departsOn, startTime, durationHours, durationMinutes });
  return { ...interval, shiftDate: departsOn };
}
