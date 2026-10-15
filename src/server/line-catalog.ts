/**
 * LINE 行程／團次共用查詢（#1024）：「團次」指令（replyDepartures）與 AI 客服 shop context 共用同一組查詢，
 * 確保 AI 講的與顧客在 LINE 看到的團次清單一致。
 * 規則（#1022）：只取啟用中方案的團次，團次日期窗用店家時區，停用／查無方案的團次在 .limit 之前排除。
 * 查詢失敗一律回 { ok: false }，呼叫端不得把失敗當成「沒有團次」。
 */
import { departureWindow, filterListableDepartures } from './line-departures';

/** 與 line-events 的 SERVICE_LIST_LIMIT 相同；團次清單上限 */
const DEPARTURE_LIMIT = 10;

export type CatalogTrip = { id: string; title: string };
export type CatalogPlan = {
  id: string;
  trip_id?: string | null;
  name: string;
  sales_mode?: string | null;
  active?: boolean | null;
  min_party?: number | null;
};
export type CatalogDeparture = {
  id?: string;
  trip_id: string;
  plan_id: string | null;
  departs_on: string;
  start_time?: string | null;
  capacity: number | string;
  seats_booked: number | string;
};

export type ListableDeparturesResult =
  | {
      ok: true;
      trips: CatalogTrip[];
      /** 可列團次所內嵌的啟用方案（供方案名稱／sales_mode 使用） */
      plans: CatalogPlan[];
      /** 已發布行程底下的全部啟用方案；僅在 includeTripPlans 時查詢，否則為空陣列 */
      tripPlans: CatalogPlan[];
      departures: CatalogDeparture[];
    }
  | { ok: false };

const DEPARTURE_COLUMNS = 'id, trip_id, plan_id, departs_on, start_time, capacity, seats_booked';

/**
 * 已發布行程 → 未來 14 天（店家時區）可列團次。與「團次」指令（replyDepartures）為同一組查詢：
 * 沒有已發布行程時回 ok:true 且皆空（不查後續表）；任一查詢失敗回 { ok: false }（含 tenant_settings）。
 * includeTripPlans：另查各行程的啟用方案名稱（AI shop context 用），replyDepartures 不需要。
 */
export async function loadListableDepartures(
  admin: any,
  tenantId: string,
  logTag = 'loadListableDepartures',
  limit = DEPARTURE_LIMIT,
  options: { includeTripPlans?: boolean } = {},
): Promise<ListableDeparturesResult> {
  const { data: tripRows, error: tripError } = await admin
    .from('trips')
    .select('id, title')
    .eq('tenant_id', tenantId)
    .eq('status', 'PUBLISHED');
  if (tripError) {
    console.error(`[line] ${logTag} 查詢 trips 失敗`, tripError);
    return { ok: false };
  }
  const trips = (tripRows ?? []) as CatalogTrip[];
  if (!trips.length) return { ok: true, trips: [], plans: [], tripPlans: [], departures: [] };
  const tripIds = trips.map((t) => t.id);

  // 日期窗用店家時區（tenant_settings.basic.timezone，#1022）。
  // 查詢失敗（error 或 throw）不可假設台北：非台北店家會得到錯誤日期窗，一律 ok:false。
  // 只有「查詢成功但沒設定／設定無效」才由 resolvePublicTimeZone 回退 Asia/Taipei。
  let timeZoneSetting: unknown;
  try {
    const { data: settingsRow, error: settingsQueryError } = await admin
      .from('tenant_settings').select('basic').eq('tenant_id', tenantId).maybeSingle();
    if (settingsQueryError) {
      console.error(`[line] ${logTag} 查詢 tenant_settings 失敗`, settingsQueryError);
      return { ok: false };
    }
    timeZoneSetting = (settingsRow as { basic?: { timezone?: unknown } } | null)?.basic?.timezone;
  } catch (settingsError) {
    console.error(`[line] ${logTag} 查詢 tenant_settings 失敗`, settingsError);
    return { ok: false };
  }
  const { from, to } = departureWindow(Date.now(), timeZoneSetting);

  // 啟用方案的過濾在資料庫端以關聯完成（trip_plans!inner + trip_plans.active），不再把方案 id 清單塞進 URL，
  // 也不受方案查詢 max_rows 截斷影響；停用方案的團次在 .limit 之前就被排除，不會擠掉可報名的團次（#1022）。
  // 查詢 A＝有方案的團次（內嵌方案供名稱／sales_mode 使用），查詢 B＝無方案（plan_id is null）的團次；
  // 兩者各自 limit 後合併排序再截斷。
  const [withPlanRes, noPlanRes] = await Promise.all([
    admin
      .from('trip_departures')
      .select(`${DEPARTURE_COLUMNS}, trip_plans!inner(id, name, sales_mode, active)`)
      .eq('tenant_id', tenantId)
      .eq('status', 'OPEN')
      .in('trip_id', tripIds)
      .gte('departs_on', from)
      .lte('departs_on', to)
      .eq('trip_plans.active', true)
      .order('departs_on', { ascending: true })
      .limit(limit),
    admin
      .from('trip_departures')
      .select(DEPARTURE_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('status', 'OPEN')
      .in('trip_id', tripIds)
      .gte('departs_on', from)
      .lte('departs_on', to)
      .is('plan_id', null)
      .order('departs_on', { ascending: true })
      .limit(limit),
  ]);
  if (withPlanRes.error || noPlanRes.error) {
    console.error(`[line] ${logTag} 查詢 trip_departures 失敗`, withPlanRes.error ?? noPlanRes.error);
    return { ok: false };
  }

  const planRows: CatalogPlan[] = [];
  const withPlan = ((withPlanRes.data ?? []) as any[]).map((row) => {
    const { trip_plans: embedded, ...d } = row;
    const plan = Array.isArray(embedded) ? embedded[0] : embedded;
    if (plan?.id) planRows.push({ id: plan.id, name: plan.name, sales_mode: plan.sales_mode, active: plan.active === true });
    return d;
  });
  const merged = [...withPlan, ...((noPlanRes.data ?? []) as any[])]
    .sort((x, y) => String(x.departs_on).localeCompare(String(y.departs_on))
      || String(x.start_time ?? '').localeCompare(String(y.start_time ?? '')))
    .slice(0, limit);

  let tripPlans: CatalogPlan[] = [];
  if (options.includeTripPlans) {
    const { data: tripPlanRows, error: tripPlanError } = await admin
      .from('trip_plans')
      .select('id, trip_id, name, sales_mode, active')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .in('trip_id', tripIds);
    if (tripPlanError) {
      console.error(`[line] ${logTag} 查詢 trip_plans 失敗`, tripPlanError);
      return { ok: false };
    }
    tripPlans = ((tripPlanRows ?? []) as CatalogPlan[]).filter((p) => p.active === true);
  }

  return {
    ok: true,
    trips,
    plans: planRows,
    tripPlans,
    departures: filterListableDepartures(merged as CatalogDeparture[], planRows),
  };
}

export type CatalogLabels = {
  seatsLeft: (n: number) => string;
  full: string;
};

/** 團次一行：日期 時間 行程名 (方案名) 剩餘名額／額滿；與 replyDepartures 的行文字一致（不含直達連結）。 */
export function formatDepartureLine(
  d: CatalogDeparture,
  titleById: ReadonlyMap<string, string>,
  planNameById: ReadonlyMap<string, string>,
  labels: CatalogLabels,
): string {
  // capacity - seats_booked 可能因為並發而暫時為負；夾到 0，不顯示「剩 -1 位」
  const left = Math.max(0, Number(d.capacity) - Number(d.seats_booked));
  const time = typeof d.start_time === 'string' ? ` ${d.start_time.slice(0, 5)}` : '';
  const planName = d.plan_id ? planNameById.get(d.plan_id) : undefined;
  const plan = planName ? `（${planName}）` : '';
  const seats = left > 0 ? labels.seatsLeft(left) : labels.full;
  return `${d.departs_on}${time} ${titleById.get(d.trip_id) ?? ''}${plan}　${seats}`;
}

/** 行程一行：行程名 + 其啟用方案名稱（不含價格——季節定價判定留給輪播，不在此重算）。 */
export function formatTripLine(trip: CatalogTrip, plans: CatalogPlan[]): string {
  const names = plans.filter((p) => p.trip_id === trip.id).map((p) => p.name).filter(Boolean);
  return names.length ? `${trip.title} · ${names.join('、')}` : trip.title;
}

export type ShopCatalogContext = {
  trips: string[];
  departures: string[];
  catalogUnavailable: boolean;
};

/** 查詢結果 → shop context 欄位；查詢失敗時 catalogUnavailable 為 true、清單為空。 */
export function buildCatalogContext(result: ListableDeparturesResult, labels: CatalogLabels): ShopCatalogContext {
  if (!result.ok) return { trips: [], departures: [], catalogUnavailable: true };
  const titleById = new Map(result.trips.map((t) => [t.id, t.title] as const));
  const planNameById = new Map(result.plans.map((p) => [p.id, p.name] as const));
  return {
    trips: result.trips.map((t) => formatTripLine(t, result.tripPlans)),
    departures: result.departures.map((d) => formatDepartureLine(d, titleById, planNameById, labels)),
    catalogUnavailable: false,
  };
}
