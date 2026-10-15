/**
 * LINE 行程／團次共用查詢（#1024）：「團次」指令（replyDepartures）與 AI 客服 shop context 共用同一組查詢，
 * 確保 AI 講的與顧客在 LINE 看到的團次清單一致。
 * 規則（#1022）：只取啟用中方案的團次，團次日期窗用店家時區，停用／查無方案的團次在 .limit 之前排除。
 * 查詢失敗一律回 { ok: false }，呼叫端不得把失敗當成「沒有團次」。
 */
import { departureWindow, filterListableDepartures } from './line-departures';
import { bookingCandidateSeatsLeft, normalizeMinParty, selectBookingCandidates } from '@/lib/public-departure-candidates';
import { hasStartedToday, resolvePublicTimeZone, tenantNowParts } from '@/lib/public-time-zone';
import type { PublicSeasonRow } from '@/lib/public-season-price';
import { hasSeasonalPricing, readPlanSeasons, seasonUnitPriceFor } from '@/server/public-plan-seasons';

/** 與 line-events 的 SERVICE_LIST_LIMIT 相同；團次清單上限 */
const DEPARTURE_LIMIT = 10;

/** AI shop context 用的團次上限（遠大於 LINE 清單的 10，降低 14 天內被截斷的機率；仍截斷時由 truncated 告知 AI） */
export const AI_DEPARTURE_LIMIT = 60;

/**
 * AI shop context 查詢方案的上限。PostgREST max_rows 會靜默截斷；達上限時無法證明方案清單完整
 * （hasInstantPlan、方案價格都可能漏掉）→ 視為查詢失敗（catalogUnavailable），不猜。
 */
export const TRIP_PLAN_LIMIT = 200;

export type CatalogTrip = { id: string; title: string };
export type CatalogPlan = {
  id: string;
  trip_id?: string | null;
  name: string;
  sales_mode?: string | null;
  active?: boolean | null;
  min_party?: number | null;
  /** 方案基本價（trip_plans.price_per_person）；季節定價方案只是基本價，不是確定售價 */
  price_per_person?: number | string | null;
  price_type?: string | null;
  /** 啟用中的季節（僅 tripPlans，由 readPlanSeasons 載入，與預約頁同一份資料） */
  seasons?: PublicSeasonRow[];
  /** 季節資料可能不完整（查詢失敗或落在分頁截斷點）；此時視為季節定價且解析不出 unitPrice */
  seasonsIncomplete?: boolean;
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
      /** 查詢 A／B 任一取滿 limit，或合併後被截斷 → 清單不完整，未列出的日期不代表沒開團 */
      truncated: boolean;
      /** 截斷時清單涵蓋到的最後日期；未截斷為 undefined */
      lastListedDate?: string;
      /** 查詢用的日期窗（店家時區，YYYY-MM-DD）；沒有已發布行程時不查詢，故為 undefined */
      window?: { from: string; to: string };
      /** 查詢當下的店家時區「現在」（日期＋HH:mm）；AI context 用它排除今天已開始的團次 */
      now?: { today: string; hm: string };
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
  options: { includeTripPlans?: boolean; timeZone?: string } = {},
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
  if (!trips.length) return { ok: true, trips: [], plans: [], tripPlans: [], departures: [], truncated: false };
  const tripIds = trips.map((t) => t.id);

  // 日期窗用店家時區（tenant_settings.basic.timezone，#1022）。
  // 查詢失敗（error 或 throw）不可假設台北：非台北店家會得到錯誤日期窗，一律 ok:false。
  // 只有「查詢成功但沒設定／設定無效」才由 resolvePublicTimeZone 回退 Asia/Taipei。
  // 呼叫端已持有 basic.timezone 時（options.timeZone）直接用，不再重複查 tenant_settings。
  let timeZoneSetting: unknown = options.timeZone;
  if (options.timeZone === undefined) try {
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
  const nowMs = Date.now();
  const { from, to } = departureWindow(nowMs, timeZoneSetting);
  const now = tenantNowParts(resolvePublicTimeZone(timeZoneSetting), nowMs);

  // 啟用方案的過濾在資料庫端以關聯完成（trip_plans!inner + trip_plans.active），不再把方案 id 清單塞進 URL，
  // 也不受方案查詢 max_rows 截斷影響；停用方案的團次在 .limit 之前就被排除，不會擠掉可報名的團次（#1022）。
  // 查詢 A＝有方案的團次（內嵌方案供名稱／sales_mode 使用），查詢 B＝無方案（plan_id is null）的團次；
  // 兩者各自 limit 後合併排序再截斷。
  const [withPlanRes, noPlanRes] = await Promise.all([
    admin
      .from('trip_departures')
      .select(`${DEPARTURE_COLUMNS}, trip_plans!inner(id, name, sales_mode, active, min_party)`)
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
    if (plan?.id) planRows.push({ id: plan.id, name: plan.name, sales_mode: plan.sales_mode, active: plan.active === true, min_party: plan.min_party });
    return d;
  });
  const noPlan = (noPlanRes.data ?? []) as any[];
  const sorted = [...withPlan, ...noPlan]
    .sort((x, y) => String(x.departs_on).localeCompare(String(y.departs_on))
      || String(x.start_time ?? '').localeCompare(String(y.start_time ?? '')));
  const merged = sorted.slice(0, limit);
  // 任一查詢取滿 limit → 該查詢後面還有團次沒被撈到；其最後一筆日期之後的清單不完整。
  const fullQueryLastDates = [withPlan, noPlan]
    .filter((rows) => rows.length >= limit)
    .map((rows) => String(rows[rows.length - 1].departs_on));
  const truncated = fullQueryLastDates.length > 0 || sorted.length > merged.length;
  let lastListedDate: string | undefined;
  if (truncated) {
    const candidates = [...fullQueryLastDates];
    if (merged.length) candidates.push(String(merged[merged.length - 1].departs_on));
    lastListedDate = candidates.sort()[0];
  }

  let tripPlans: CatalogPlan[] = [];
  if (options.includeTripPlans) {
    const { data: tripPlanRows, error: tripPlanError } = await admin
      .from('trip_plans')
      .select('id, trip_id, name, sales_mode, active, min_party, price_per_person, price_type')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .in('trip_id', tripIds)
      .order('id', { ascending: true })
      .limit(TRIP_PLAN_LIMIT);
    if (tripPlanError) {
      console.error(`[line] ${logTag} 查詢 trip_plans 失敗`, tripPlanError);
      return { ok: false };
    }
    // 取滿上限＝可能被 max_rows／limit 截斷，無法證明方案清單完整 → 不猜，整體視為不可用。
    if ((tripPlanRows ?? []).length >= TRIP_PLAN_LIMIT) {
      console.error(`[line] ${logTag} trip_plans 取滿 ${TRIP_PLAN_LIMIT} 列，無法證明完整`);
      return { ok: false };
    }
    tripPlans = ((tripPlanRows ?? []) as CatalogPlan[]).filter((p) => p.active === true);
    // 季節資料與預約頁／LINE 輪播同一個 reader（readPlanSeasons，依 100 個方案分塊）；
    // reader 查詢失敗會降級為「全部不完整」；throw 時該塊方案同樣視為不完整。
    const seasonInfo = new Map<string, { seasons: PublicSeasonRow[]; incomplete: boolean }>();
    for (let i = 0; i < tripPlans.length; i += 100) {
      const chunk = tripPlans.slice(i, i + 100).map((p) => p.id);
      try {
        const reader = await readPlanSeasons(admin, tenantId, chunk);
        for (const id of chunk) seasonInfo.set(id, { seasons: reader.byPlan.get(id) ?? [], incomplete: reader.isIncomplete(id) });
      } catch (seasonError) {
        console.error(`[line] ${logTag} 查詢 trip_plan_seasons 失敗`, seasonError);
        for (const id of chunk) seasonInfo.set(id, { seasons: [], incomplete: true });
      }
    }
    tripPlans = tripPlans.map((p) => {
      const info = seasonInfo.get(p.id);
      return info ? { ...p, seasons: info.seasons, seasonsIncomplete: info.incomplete } : p;
    });
  }

  return {
    ok: true,
    trips,
    plans: planRows,
    tripPlans,
    departures: filterListableDepartures(merged as CatalogDeparture[], planRows),
    truncated,
    ...(lastListedDate ? { lastListedDate } : {}),
    window: { from, to },
    now,
  };
}

/** INSTANT 方案名稱後的標示：公開頁不列固定團次，時段需與店家確認。 */
export const INSTANT_PLAN_MARK = '（需與店家確認時段）';
/**
 * 團次落在預約頁／申請頁「每個方案前 MAX_BOOKING_CANDIDATE_DEPARTURES 個候選」之外：旅客選不到，
 * 但不可從清單移除（移除會讓該日期落入「窗內未列出 → 沒開團」），改列出並請顧客聯絡店家；不寫名額。
 */
export const BEYOND_CANDIDATES_MARK = '（請聯絡店家確認）';

/** 方案價格不能給確定數字時（季節定價、價格 ≤0 或無法解析）的標示；與公開頁「價格依出發日期而定」語意一致。 */
export const PRICE_BY_DATE_MARK = '（價格依日期而定，請見預約頁或聯絡店家）';

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
  seatsOverride?: string,
): string {
  // capacity - seats_booked 可能因為並發而暫時為負；夾到 0，不顯示「剩 -1 位」
  const left = Math.max(0, Number(d.capacity) - Number(d.seats_booked));
  const time = typeof d.start_time === 'string' ? ` ${d.start_time.slice(0, 5)}` : '';
  const planName = d.plan_id ? planNameById.get(d.plan_id) : undefined;
  const plan = planName ? `（${planName}）` : '';
  const seats = seatsOverride ?? (left > 0 ? labels.seatsLeft(left) : labels.full);
  return `${d.departs_on}${time} ${titleById.get(d.trip_id) ?? ''}${plan}　${seats}`;
}

/** 方案是否為季節定價（與公開頁／LINE 輪播同一個 hasSeasonalPricing）；未載入季節資料的方案視為非季節。 */
function planIsSeasonal(p: CatalogPlan): boolean {
  return hasSeasonalPricing({ seasons: p.seasons ?? [], incomplete: p.seasonsIncomplete === true });
}

/** 方案價格片段：確定價（非季節、> 0）→「NT$1,280/人」或「NT$18,000/團」；其餘不給數字，改標價格依日期而定。 */
function planPriceText(p: CatalogPlan): string {
  if (p.price_per_person === undefined) return '';
  const price = Number(p.price_per_person);
  if (planIsSeasonal(p) || !Number.isFinite(price) || price <= 0) return PRICE_BY_DATE_MARK;
  return ` NT$${price.toLocaleString('zh-TW')}/${p.price_type === 'PER_GROUP' ? '團' : '人'}`;
}

/** 行程一行：行程名 + 其啟用方案名稱與價格（價格口徑同公開頁／LINE 輪播：季節定價或價格 ≤0 不給確定數字）。 */
export function formatTripLine(trip: CatalogTrip, plans: CatalogPlan[]): string {
  const names = plans
    .filter((p) => p.trip_id === trip.id)
    .filter((p) => p.name)
    // INSTANT 方案不列固定團次（公開頁：尚未開放線上預約，請先聯絡店家確認可預約時段），讓 AI 能分辨
    .map((p) => `${p.name}${planPriceText(p)}${p.sales_mode === 'INSTANT' ? INSTANT_PLAN_MARK : ''}`);
  return names.length ? `${trip.title} · ${names.join('、')}` : trip.title;
}

export type ShopCatalogContext = {
  trips: string[];
  departures: string[];
  catalogUnavailable: boolean;
  /** 團次清單被截斷時，清單涵蓋到的最後日期（之後的日期不可說成沒開團） */
  departuresTruncatedAfter?: string;
  /** 有行程目錄時的日期窗（today = from，店家時區） */
  departureWindow?: { today: string; from: string; to: string };
  /** 任一啟用中方案為 INSTANT（公開頁不列固定團次、需聯絡店家確認時段）；此時未列出的日期不得說成沒開團 */
  hasInstantPlan?: boolean;
};

/** 查詢結果 → shop context 欄位；查詢失敗時 catalogUnavailable 為 true、清單為空。 */
export function buildCatalogContext(result: ListableDeparturesResult, labels: CatalogLabels): ShopCatalogContext {
  if (!result.ok) return { trips: [], departures: [], catalogUnavailable: true };
  const titleById = new Map(result.trips.map((t) => [t.id, t.title] as const));
  const planNameById = new Map(result.plans.map((p) => [p.id, p.name] as const));
  const planById = new Map(result.plans.map((p) => [p.id, p] as const));
  const tripPlanById = new Map(result.tripPlans.map((p) => [p.id, p] as const));
  // 「可報名團次」須與公開頁同規則（只套用在 AI context；replyDepartures 直接用 result.departures，行為不變）。
  // 截斷判定（truncated／lastListedDate）已在 loadListableDepartures 以原始列算好，這裡的過濾不影響它。
  // 預約頁每個方案只提供前 MAX_BOOKING_CANDIDATE_DEPARTURES 個候選團次（selectBookingCandidates，依 departs_on、start_time、id）：
  // 在此對每個 plan_id 用同一個函式算出候選集合，集合外但仍屬候選（未開始、未額滿）的團次改標示請聯絡店家。
  const now = result.now;
  const inCandidates = new Set<CatalogDeparture>();
  const byPlan = new Map<string, CatalogDeparture[]>();
  if (now) {
    for (const d of result.departures) {
      if (!d.plan_id) continue;
      const list = byPlan.get(d.plan_id) ?? [];
      list.push(d);
      byPlan.set(d.plan_id, list);
    }
    for (const list of byPlan.values()) {
      list.sort((x, y) => String(x.departs_on).localeCompare(String(y.departs_on))
        || String(x.start_time ?? '').localeCompare(String(y.start_time ?? ''))
        || String(x.id ?? '').localeCompare(String(y.id ?? '')));
      for (const c of selectBookingCandidates(list, now)) inCandidates.add(c.row);
    }
  }
  const beyondCandidates = new Set<CatalogDeparture>();
  const aiDepartures = result.departures.flatMap((d): CatalogDeparture[] => {
    // 公開頁看不到 plan_id 為 null 的團次 → AI 也不列為可報名（只影響 AI；replyDepartures 不變）。
    if (!d.plan_id) return [];
    const plan = d.plan_id ? planById.get(d.plan_id) : undefined;
    // 對應 public-shop.ts hasPublicDepartureList／selectPlansWithDepartures：INSTANT 方案的 OPEN 團次是手動／私人用途，公開頁不列。
    if (plan?.sales_mode === 'INSTANT') return [];
    // 對應 public-shop.ts hasStartedToday 排除（今天已到開始時間；start_time 為 null 維持列出）。
    if (result.now && hasStartedToday(d, result.now)) return [];
    // 對應 public-booking-price.ts isDepartureBookableOnPage 的價格條件：季節定價方案的該團次必須解析得出 unitPrice
    // （seasonUnitPriceFor，與預約頁同一份季節資料）；季節資料不完整時解析不出 → 預約頁拒絕，AI 不得宣稱可報名。
    const priceInfo = tripPlanById.get(d.plan_id);
    const priceUnresolved = !!priceInfo && planIsSeasonal(priceInfo)
      && seasonUnitPriceFor(
        { seasons: priceInfo.seasons ?? [], incomplete: priceInfo.seasonsIncomplete === true },
        d.departs_on, Number(priceInfo.price_per_person ?? 0),
      ) === undefined;
    // 對應 public-departure-candidates.ts candidateIsBookable／public-booking-price.ts isDepartureBookableOnPage：
    if (now && (!inCandidates.has(d) || priceUnresolved) && bookingCandidateSeatsLeft(d, now) !== null) {
      beyondCandidates.add(d);
      return [d];
    }
    // 剩餘名額 < 方案最低人數，預約頁不可預選 → 不得描述為可報名，改以「額滿」標示（與公開頁客滿一致，不提供名額數字）。
    const left = Number(d.capacity) - Number(d.seats_booked);
    // REQUEST 方案公開頁不顯示 belowMinParty、RequestForm 也不停用 → 照常列出剩餘名額。
    if (plan?.sales_mode !== 'REQUEST' && left > 0 && left < normalizeMinParty(plan?.min_party)) return [{ ...d, seats_booked: d.capacity }];
    return [d];
  });
  return {
    trips: result.trips.map((t) => formatTripLine(t, result.tripPlans)),
    departures: aiDepartures.map((d) => formatDepartureLine(d, titleById, planNameById, labels, beyondCandidates.has(d) ? BEYOND_CANDIDATES_MARK : undefined)),
    catalogUnavailable: false,
    ...(result.tripPlans.some((p) => p.sales_mode === 'INSTANT') ? { hasInstantPlan: true } : {}),
    ...(result.window ? { departureWindow: { today: result.window.from, ...result.window } } : {}),
    ...(result.truncated && result.lastListedDate ? { departuresTruncatedAfter: result.lastListedDate } : {}),
  };
}

/**
 * 執行 catalog 查詢並組成 shop context；查詢 throw 一律視為 catalogUnavailable，
 * 不讓整個 AI 回覆因為 supabase 直接拋錯而失敗。
 */
export async function buildTourCatalogContext(
  load: () => Promise<ListableDeparturesResult>,
  labels: CatalogLabels,
): Promise<ShopCatalogContext> {
  try {
    return buildCatalogContext(await load(), labels);
  } catch (error) {
    console.error('[line] buildTourCatalogContext 查詢拋錯', error);
    return { trips: [], departures: [], catalogUnavailable: true };
  }
}
