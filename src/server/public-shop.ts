/**
 * src/server/public-shop.ts — 公開店家頁的資料來源（issue #46 第一片）
 * -----------------------------------------------------------------------------
 * ## 這個檔存在的理由
 *
 * 後台在 **7 個地方**把 `buildPublicBookingUrl()` 產生的 `/s/{shopCode}` 當成
 * 「你的公開預約網址」顯示給店家，其中兩處還是可以直接點的連結（`trips/page.tsx`
 * 與 `trips/[id]/page.tsx`）。但 `src/app/` 底下**沒有任何非 /tenant 的頁面** ——
 * 店家把那個網址傳給顧客，顧客拿到的是 404。
 *
 * 這一片讓那個網址真的打得開。依治理原則「復原而非取消」：不是把那 7 個連結拿掉，
 * 是讓它們指向的東西真的存在。
 *
 * ## ⚠️ 這是公開店家與行程資料的匿名讀取核心
 *
 * 這些查詢沒有 `requireTenant()` 閘門，所以**外洩的判準落在這個檔自己身上**。
 * 三條規則，每一條都不是形式：
 *
 * 1. **白名單欄位，不是黑名單。** 每一個 select 都逐欄列出要哪些欄位，永遠不用
 *    `select('*')`。加欄位時必須有人主動決定它可不可以公開；用 `*` 的話，日後
 *    任何一支 migration 加的欄位都會自動被公開出去，而沒有人會發現。
 * 2. **只回已發布、未停用的東西。** `trips.status = 'PUBLISHED'`、`active = true`。
 * 3. **完全不碰顧客、員工、訂單、設定祕密。** 這個檔的 select 清單裡不會出現
 *    `customers`、`staff`、`bookings`、`tenant_settings.line` 的任何加密欄位。
 *
 * ## 為什麼用 service role 而不是 anon key
 *
 * 這些表的 RLS policy 是 `is_tenant_member(tenant_id)` —— 匿名訪客不是任何租戶的
 * 成員，用 anon key 一列都讀不到。所以只能由伺服器端以 service role 讀，再由這個檔
 * 自己把範圍收窄。**這正是上面三條規則必須嚴格的原因**：service role 繞過 RLS，
 * 這裡沒收好就沒有第二道防線。
 */
import { cache } from 'react';
import { createAdminSupabase } from '@/server/supabase';
import { SHOP_CODE_PATTERN } from '@/lib/shop-code';

/** 對外公開的店家基本資料。刻意只有這幾欄。 */
export type PublicShop = {
  shopCode: string;
  name: string;
  description: string;
  phone: string;
  email: string;
  address: string;
  /** LINE 官方帳號基本 ID（例如 @abc1234x）；空字串＝店家沒填 */
  lineBasicId: string;
  businessType: string | null;
};

export type PublicDeparture = {
  id: string;
  departsOn: string;
  /** 'HH:mm'；空字串＝店家沒指定出發時間 */
  startTime: string;
  capacity: number;
  seatsBooked: number;
};

export type PublicPlan = {
  id: string;
  name: string;
  description: string;
  pricePerPerson: number;
  priceType: 'PER_PERSON' | 'PER_GROUP';
  minParty: number;
  maxParty: number;
  /**
   * #46：販售方式。只用來判斷要不要在方案旁邊顯示「申請預約」連結——
   * REQUEST 是這個切片唯一接的旅程；FIXED_DEPARTURE／INSTANT 目前仍然只能
   * 透過上方的聯絡方式（LINE／電話）詢問，該按鈕本輪不做（見檔頭）。
   */
  salesMode: 'FIXED_DEPARTURE' | 'INSTANT' | 'REQUEST';
};

export type PublicTrip = {
  id: string;
  /** 公開行程 URL 使用的租戶內 slug。 */
  slug: string;
  title: string;
  summary: string;
  location: string;
  coverImageUrl: string;
  durationHours: number | null;
  /**
   * #46：下單前必須顯示現行取消／退款政策——這是 trip 層欄位（見
   * `0089_trip_display_fields.sql`），不是逐方案設定，所以整個行程共用同一個值。
   * 值域固定在 STANDARD/FLEXIBLE/STRICT（DB check constraint），沒有第四種可能。
   */
  refundPolicyType: 'STANDARD' | 'FLEXIBLE' | 'STRICT';
  plans: PublicPlan[];
  /** 只含今天以後、未取消、未售罄的團次，最多 6 筆 */
  departures: PublicDeparture[];
};

export type PublicTripDetailDeparture = {
  id: string;
  departsOn: string;
  startTime: string;
  seatsLeft: number;
  /* #11／19 分冊 §2.1：固定團次成團資訊。canonical 值為 null／缺少時前端不顯示該項。 */
  /** 建立團次時 snapshot 的最低成團人數（`min_to_depart_snapshot`）。 */
  minToDepart?: number | null;
  /**
   * 剩餘名額為 0（客滿）。刻意**不**輸出「目前成團人數」：18 §5 規定容量占用與成團計數是
   * 兩本帳，成團計數須由 qualifying TourOrders 現算；canonical migrations 沒有權威的
   * 計數欄位／view／function，`seats_booked` 含未付款占位，不得拿來當成團人數或推算尚差。
   */
  soldOut?: true;
  /** 成團截止時間（ISO，`formation_deadline_at`）。 */
  formationDeadlineAt?: string | null;
  /** `formation_status`：COLLECTING／FORMED／REVIEW_REQUIRED／AT_RISK／FAILED。 */
  formationStatus?: string | null;
};

export type PublicTripDetailPlan = PublicPlan & {
  departures: PublicTripDetailDeparture[];
  /** True only when more AVAILABLE (sellable) rows may exist beyond what is listed. */
  departuresMayBeTruncated: boolean;
  /** 只代表有「客滿」列因顯示上限被略過；不代表還有可售團次未列出。 */
  soldOutOmitted?: boolean;
  /** 超過可查團次的方案數上限：此方案未載入團次，前端不提供入口並請旅客聯絡店家。 */
  departuresNotLoaded?: true;
};

export type PublicTripDetails = {
  shop: PublicShop;
  trip: {
    id: string;
    slug: string;
    title: string;
    tagline: string;
    summary: string;
    description: string;
    region: string;
    category: string;
    location: string;
    coverImageUrl: string;
    galleryUrls: string[];
    durationHours: number | null;
    meetingPoint: string;
    meetingPointMapUrl: string;
    inclusions: string[];
    exclusions: string[];
    notices: string[];
    safetyNotice: string;
    refundPolicyType: 'STANDARD' | 'FLEXIBLE' | 'STRICT';
    plans: PublicTripDetailPlan[];
    /** 方案數達到讀取上限（10 頁 × 200 筆）且最後一頁仍是滿頁，方案清單可能被截斷。 */
    plansMayBeTruncated?: true;
  };
};

export type PublicService = {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  price: number;
};

export type PublicShopData = {
  shop: PublicShop;
  trips: PublicTrip[];
  services: PublicService[];
  /**
   * 內部用租戶 id（issue #23 推廣成效埋點需要）——刻意放在頂層而不是 `shop`
   * 裡面：`shop` 是「這個檔頭三條規則要守住的、真的會被序列化進公開 HTML 的
   * 白名單欄位」，`tenantId` 不在那份白名單上，只給呼叫端（頁面自己的
   * server-side 埋點與同一請求內的公開詳情查詢使用，不代表它可以被當成公開資料
   * 隨意渲染出去。
   */
  tenantId: string;
};

/** 一個行程最多顯示幾個近期團次——公開頁不是後台，不需要全部列出來。 */
const MAX_DEPARTURES_PER_TRIP = 6;
/** 詳情頁每個方案最多顯示的近期團次。 */
const MAX_DETAIL_DEPARTURES_PER_PLAN = 6;
/**
 * 詳情頁讀取方案時每頁列數與最多頁數（防止超過 PostgREST 列數上限被靜默截斷，也避免無限迴圈）。
 * 10 頁 × 200 筆＝單一行程 2000 個啟用方案，遠高於實際業務上限（一個行程不會有這麼多方案）；
 * 真的到達上限時以 plansMayBeTruncated 誠實標示，而不是靜默截斷。
 */
const DETAIL_PLAN_PAGE_SIZE = 200;
const MAX_DETAIL_PLAN_PAGES = 10;
/** 詳情頁每個方案最多額外列出的客滿團次（不占上面的可售名額）。 */
const MAX_DETAIL_SOLD_OUT_PER_PLAN = 6;
/**
 * Scan future OPEN rows per plan so sold-out dates cannot hide a later available date.
 * A bounded scan protects public request latency; the UI marks the list when rows remain.
 */
const DETAIL_DEPARTURE_PAGE_SIZE = 120;
const MAX_DETAIL_DEPARTURE_SCAN_PER_PLAN = 600;
/**
 * 只有排序後的前 N 個方案會查團次；其餘方案照樣列出，但標 departuresNotLoaded、不查團次。
 * 單一匿名請求的團次查詢數上限：N × (掃描 600/120 = 5 頁 + 1 次 lookahead) = 30 × 6 = 180
 * （另加方案分頁最多 10 次、行程 1 次、店家 1 次），不再隨方案數（最多 2000）放大。
 */
const MAX_DETAIL_PLANS_WITH_DEPARTURES = 30;
/** 匿名請求一次最多同時對幾個方案查團次；方案數無上限，不得全數同時扇出。 */
const DETAIL_PLAN_QUERY_CONCURRENCY = 3;

/**
 * 有上限的併發 map：輸出順序與 items 相同；任一項 reject 則整體 reject（fail-closed，
 * 並停止啟動尚未開始的項目）。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index], index);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

/**
 * ⚠️ 店家代碼的形狀與長度上限由 `@/lib/shop-code` 統一提供，**每一個會寫入
 * `tenants.shop_code` 的入口**（註冊 API、設定 API）與註冊頁的前端驗證都用同一個
 * 常數 —— 存得進資料庫的代碼，這一頁就一定打得開。那個檔的檔頭寫了為什麼要收斂成
 * 一份（規則曾經散在四處且不一致，會造出「後台顯示的網址永遠 404」的店家）。
 *
 * 在這裡先擋掉不合形狀的字串，不是輸入驗證的潔癖：這條路徑以 service role 存取
 * 資料庫。少了這一道，一個 2000 字元的亂碼
 * 網址也會換到一次 service-role 查詢。
 */

/**
 * 把 PostgREST 的錯誤物件包成真正的 `Error`。
 *
 * ⚠️ 這不是美化，是資訊洩漏的修補。supabase-js 的 error 是一個 **plain object**
 * （`{message, details, hint, code}`），不是 `Error` 實例。Next 對 page 的 render
 * 錯誤會壓成 digest，但 `generateMetadata` 丟出的錯誤**不會**——它被逐字序列化進
 * 公開 HTML 的 RSC payload：
 *
 *   `8:{"metadata":"$undefined","error":{"message":"…","hint":"…"}}`
 *
 * PostgREST 的 `message` / `details` 可能含表名、欄位名、SQL 片段與 `Key (…)=(…)`。
 * 對匿名訪客而言那是內部結構的洩漏。包成 `Error` 之後訊息固定，真正的原因放在
 * `cause` 裡留給伺服器日誌。
 */
function queryFailed(stage: string, cause: unknown): Error {
  return new Error(`PUBLIC_SHOP_QUERY_FAILED:${stage}`, { cause });
}

/**
 * 台北「今天」的日期字串。
 *
 * ⚠️ 用 UTC 的 `toISOString().slice(0,10)` 會在台北時間 00:00–08:00 之間算成
 * 「昨天」，於是已經出發的團次還會出現在公開頁上。這個 +8 與
 * `src/server/staff-availability.ts` 是同一個常數來源的道理。
 */
function taipeiToday(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 台北「現在」：同一個時間來源切出日期與 HH:mm，避免兩者跨午夜不一致。 */
function taipeiNowParts(): { today: string; hm: string } {
  const iso = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  return { today: iso.slice(0, 10), hm: iso.slice(11, 16) };
}

/**
 * 今天（台北）且開始時間已到或已過的團次不可列出。
 * `start_time` 為 null 的今天團次維持列出：沒有開始時間，無法判定是否已開始。
 * 明天以後的團次不受影響。（預約頁／reserve_seats 的權威檢查是既有行為，不在此處理。）
 */
function hasStartedToday(
  row: { departs_on?: unknown; start_time?: unknown },
  now: { today: string; hm: string },
): boolean {
  if (row.departs_on !== now.today) return false;
  if (row.start_time == null) return false;
  return String(row.start_time).slice(0, 5) <= now.hm;
}

async function loadPublicShopCore(
  admin: ReturnType<typeof createAdminSupabase>,
  shopCode: string,
): Promise<{ shop: PublicShop; tenantId: string } | null> {
  if (!SHOP_CODE_PATTERN.test(shopCode)) return null;

  // ① 店家 ＋ 公開的基本設定。白名單欄位；tenant_settings 只取 basic 與 line 兩塊，
  //    而 line 那塊底下只會用到 lineBasicId（見下方），加密欄位一概不取。
  const { data: tenantRow, error: tenantError } = await admin
    .from('tenants')
    .select('id, shop_code, name, business_type, tenant_settings(basic, line)')
    .eq('shop_code', shopCode)
    .maybeSingle();
  // PB-023：丟掉 error 會讓「查詢失敗」冒充「查無此店」，於是一次 DB 故障就會讓
  // 所有店家的公開頁一起變成 404，而錯誤訊息是「找不到這家店」——完全誤導。
  if (tenantError) throw queryFailed('tenants', tenantError);
  if (!tenantRow) return null;

  const rawSettings = (tenantRow as Record<string, unknown>).tenant_settings;
  const settings = (Array.isArray(rawSettings) ? rawSettings[0] : rawSettings) as
    | { basic?: Record<string, unknown>; line?: Record<string, unknown> }
    | null
    | undefined;
  const basic = settings?.basic ?? {};

  const shop: PublicShop = {
    shopCode: tenantRow.shop_code as string,
    name: (basic.tenantName as string) || (tenantRow.name as string),
    description: (basic.tenantDescription as string) ?? '',
    phone: (basic.tenantPhone as string) ?? '',
    email: (basic.tenantEmail as string) ?? '',
    address: (basic.tenantAddress as string) ?? '',
    // 只取這一個欄位。channelSecret / channelAccessToken 是加密祕密，永遠不出現在這裡。
    lineBasicId: (settings?.line?.lineBasicId as string) ?? '',
    businessType: (tenantRow.business_type as string | null) ?? null,
  };

  return { shop, tenantId: tenantRow.id as string };
}

function mapPublicPlan(row: Record<string, unknown>): PublicPlan {
  return {
    id: row.id as string,
    name: (row.name as string) ?? '',
    description: (row.description as string) ?? '',
    pricePerPerson: Number(row.price_per_person ?? 0),
    priceType: row.price_type === 'PER_GROUP' ? 'PER_GROUP' : 'PER_PERSON',
    minParty: Number(row.min_party ?? 1),
    maxParty: Number(row.max_party ?? 1),
    salesMode: row.sales_mode === 'INSTANT' || row.sales_mode === 'REQUEST'
      ? row.sales_mode : 'FIXED_DEPARTURE',
  };
}

/**
 * 讀一家店的公開資料。找不到、或該店沒有任何可公開內容時回 null（呼叫端轉 404）。
 *
 * ⚠️ 這裡刻意**不**因為「店家存在但沒有上架任何行程」而回 null —— 那會讓剛註冊
 * 還沒建行程的店家，把自己的公開網址傳出去時拿到 404，而他完全不知道為什麼。
 * 空的店家頁會誠實顯示「這家店還沒有上架的行程」。
 */
async function loadPublicShopUncached(shopCode: string): Promise<PublicShopData | null> {
  if (!SHOP_CODE_PATTERN.test(shopCode)) return null;

  const admin = createAdminSupabase();
  const core = await loadPublicShopCore(admin, shopCode);
  if (!core) return null;
  const { shop, tenantId } = core;
  const today = taipeiToday();

  // ② 已發布的行程 ＋ 其方案。`status = 'PUBLISHED'` 是這裡的閘門：草稿與封存
  //    的行程不得出現在公開頁上。
  const [{ data: tripRows, error: tripError }, { data: serviceRows, error: serviceError }] =
    await Promise.all([
      admin.from('trips')
        // #46：多取 refund_policy_type，讓公開頁在下單前就顯示現行取消／退款政策
        // （原本只有送出 REQUEST 申請的表單頁才看得到）。仍是白名單 select。
        .select('id, slug, title, summary, location, cover_image_url, duration_hours, refund_policy_type')
        .eq('tenant_id', tenantId).eq('status', 'PUBLISHED')
        .order('created_at', { ascending: false }),
      admin.from('services')
        .select('id, name, description, duration_minutes, price')
        .eq('tenant_id', tenantId).eq('active', true)
        .order('sort_order', { ascending: true }),
    ]);
  if (tripError) throw queryFailed('trips', tripError);
  if (serviceError) throw queryFailed('services', serviceError);

  const tripIds = (tripRows ?? []).map((t) => t.id as string);

  const [{ data: planRows, error: planError }, { data: departureRows, error: departureError }] =
    tripIds.length === 0
      ? [{ data: [], error: null }, { data: [], error: null }]
      : await Promise.all([
        admin.from('trip_plans')
          // #46：多取 sales_mode，判斷要不要顯示「申請預約」連結。仍是白名單
          // select，不用 `*`——這是全站唯一不需要登入就能打到的資料路徑，
          // 加欄位必須有人主動決定它可不可以公開（見檔頭三條規則）。
          .select('id, trip_id, name, description, price_per_person, price_type, min_party, max_party, sales_mode')
          .eq('tenant_id', tenantId).in('trip_id', tripIds).eq('active', true)
          .order('sort_order', { ascending: true }),
        admin.from('trip_departures')
          .select('id, trip_id, departs_on, start_time, capacity, seats_booked')
          .eq('tenant_id', tenantId).in('trip_id', tripIds)
          // 只有還在賣的團次：OPEN。CLOSED（停售）與 CANCELLED（取消）都不列。
          .eq('status', 'OPEN')
          // 已經出發的不列。用台北今天比對，不是 UTC。
          .gte('departs_on', today)
          .order('departs_on', { ascending: true })
          .order('start_time', { ascending: true, nullsFirst: true }),
      ]);
  if (planError) throw queryFailed('trip_plans', planError);
  if (departureError) throw queryFailed('trip_departures', departureError);

  const plansByTrip = new Map<string, PublicPlan[]>();
  for (const row of planRows ?? []) {
    const list = plansByTrip.get(row.trip_id as string) ?? [];
    list.push(mapPublicPlan(row));
    plansByTrip.set(row.trip_id as string, list);
  }

  const departuresByTrip = new Map<string, PublicDeparture[]>();
  for (const row of departureRows ?? []) {
    const tripId = row.trip_id as string;
    const list = departuresByTrip.get(tripId) ?? [];
    const capacity = Number(row.capacity ?? 0);
    const seatsBooked = Number(row.seats_booked ?? 0);
    // 額滿的不列：公開頁列一個買不到的團次只會讓顧客白跑一趟。
    // （後台仍看得到它，那是店家要的資訊。）
    if (seatsBooked >= capacity) continue;
    if (list.length >= MAX_DEPARTURES_PER_TRIP) continue;
    list.push({
      id: row.id as string,
      departsOn: row.departs_on as string,
      startTime: row.start_time == null ? '' : String(row.start_time).slice(0, 5),
      capacity,
      seatsBooked,
    });
    departuresByTrip.set(tripId, list);
  }

  const trips: PublicTrip[] = (tripRows ?? []).map((row) => ({
    id: row.id as string,
    slug: (row.slug as string) ?? '',
    title: (row.title as string) ?? '',
    summary: (row.summary as string) ?? '',
    location: (row.location as string) ?? '',
    // This loader is also used by Server Components. Return only validated HTTPS media
    // URLs so Next's development RSC diagnostics cannot serialize a raw unsafe value.
    coverImageUrl: safePublicHttpsUrl(row.cover_image_url),
    durationHours: row.duration_hours == null ? null : Number(row.duration_hours),
    refundPolicyType: row.refund_policy_type === 'FLEXIBLE' || row.refund_policy_type === 'STRICT'
      ? row.refund_policy_type : 'STANDARD',
    plans: plansByTrip.get(row.id as string) ?? [],
    departures: departuresByTrip.get(row.id as string) ?? [],
  }));

  const services: PublicService[] = (serviceRows ?? []).map((row) => ({
    id: row.id as string,
    name: (row.name as string) ?? '',
    description: (row.description as string) ?? '',
    durationMinutes: Number(row.duration_minutes ?? 0),
    price: Number(row.price ?? 0),
  }));

  return { shop, trips, services, tenantId };
}

/**
 * 讀一家店的公開資料（同一次請求內只會真的查一次）。
 *
 * ⚠️ `cache()` 不是效能微調，是修一個實測到的重複查詢：`generateMetadata` 與頁面
 * 本身**各呼叫一次** `loadPublicShop`，而 Next 的 request memoization 只對 `fetch()`
 * 生效，supabase-js 不在內。所以在包上這一層之前，一個 200 請求其實是最多 **10 次**
 * service-role 查詢，不是 5 次——對一個匿名就打得到、又沒有 rate limit 的頁面，
 * 這個倍數是實質的。
 *
 * `cache()` 的作用域是**單一請求**，不會跨請求把資料留下來，所以店家一改內容就
 * 立刻反映在下一個訪客身上。
 */
export const loadPublicShop = cache(loadPublicShopUncached);

function queryTripDetailsFailed(stage: string, cause: unknown): Error {
  return new Error(`PUBLIC_TRIP_DETAILS_QUERY_FAILED:${stage}`, { cause });
}

function safePublicHttpsUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function publicStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim()).filter(Boolean);
}

function publicLines(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

const PUBLIC_TRIP_DETAILS_COLUMNS = [
  'id', 'slug', 'title', 'tagline', 'summary', 'description',
  'location', 'cover_image_url', 'gallery', 'duration_hours', 'meeting_point',
  'meeting_point_map_url', 'includes', 'exclusions', 'notices', 'notes',
  'refund_policy_type',
] as const;

async function loadPublicTripDetailsUncached(
  shopCode: string,
  slug: string,
): Promise<PublicTripDetails | null> {
  // 只讀店家本身（tenant＋公開設定 allowlist），不讀全店行程清單：全店查詢會被
  // PostgREST 1000 列上限靜默截斷，較舊的已發布行程會誤回 404。
  if (!slug || slug.length > 160 || slug.trim() !== slug) return null;
  const admin = createAdminSupabase();
  const core = await loadPublicShopCore(admin, shopCode);
  if (!core) return null;
  const shopData = core;

  const { data: rawRow, error } = await admin.from('trips')
    .select(PUBLIC_TRIP_DETAILS_COLUMNS.join(', '))
    .eq('tenant_id', shopData.tenantId)
    .eq('slug', slug)
    .eq('status', 'PUBLISHED')
    .maybeSingle();
  if (error) throw queryTripDetailsFailed('trips', error);
  const row = rawRow as Record<string, unknown> | null;
  if (!row) return null;
  const tripId = row.id as string;

  const now = taipeiNowParts();

  // trip_plans 以穩定排序（sort_order、id）分頁讀到底；範圍限定 tenant、trip、active。
  const planRows: Array<Record<string, unknown>> = [];
  let plansMayBeTruncated = false;
  for (let page = 0; page < MAX_DETAIL_PLAN_PAGES; page += 1) {
    const from = page * DETAIL_PLAN_PAGE_SIZE;
    const { data: pageRows, error: planError } = await admin.from('trip_plans')
      .select('id, trip_id, name, description, price_per_person, price_type, min_party, max_party, sales_mode')
      .eq('tenant_id', shopData.tenantId)
      .eq('trip_id', tripId)
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + DETAIL_PLAN_PAGE_SIZE - 1);
    if (planError) throw queryTripDetailsFailed('trip_plans', planError);
    const got = (pageRows ?? []) as unknown as Array<Record<string, unknown>>;
    planRows.push(...got);
    if (got.length < DETAIL_PLAN_PAGE_SIZE) break;
    if (page === MAX_DETAIL_PLAN_PAGES - 1) {
      plansMayBeTruncated = true;
      console.warn('public trip details: plan page limit reached');
    }
  }
  const plans: PublicPlan[] = planRows.map((r) => mapPublicPlan(r));

  const plansWithDepartures = plans.slice(0, MAX_DETAIL_PLANS_WITH_DEPARTURES);
  const planDepartureResults = await mapWithConcurrency(plansWithDepartures, DETAIL_PLAN_QUERY_CONCURRENCY, async (plan) => {
    const departures: PublicTripDetailDeparture[] = [];
    let offset = 0;
    let scanned = 0;
    let exhausted = false;
    let soldOutCount = 0;
    let skippedSoldOut = false;
    // 已確認「本頁剩下未列出的列」中有可售團次。
    let unlistedSellable = false;
    const availableCount = () => departures.length - soldOutCount;

    // Query each plan independently. A busy plan must not consume another plan's window.
    while (availableCount() < MAX_DETAIL_DEPARTURES_PER_PLAN
      && scanned < MAX_DETAIL_DEPARTURE_SCAN_PER_PLAN) {
      const pageSize = Math.min(
        DETAIL_DEPARTURE_PAGE_SIZE,
        MAX_DETAIL_DEPARTURE_SCAN_PER_PLAN - scanned,
      );
      const { data, error: departureError } = await admin.from('trip_departures')
        .select('id, departs_on, start_time, capacity, seats_booked, min_to_depart_snapshot, formation_deadline_at, formation_status')
        .eq('tenant_id', shopData.tenantId)
        .eq('trip_id', tripId)
        .eq('plan_id', plan.id)
        .eq('status', 'OPEN')
        .gte('departs_on', now.today)
        .order('departs_on', { ascending: true })
        .order('start_time', { ascending: true, nullsFirst: true })
        .order('id', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (departureError) throw queryTripDetailsFailed('trip_departures', departureError);

      const rows = data ?? [];
      scanned += rows.length;
      offset += rows.length;
      for (let index = 0; index < rows.length; index += 1) {
        const departure = rows[index];
        // 今天已到開始時間的團次不列出，也不計入可售或客滿（游標仍以已讀列數前進）。
        if (hasStartedToday(departure, now)) continue;
        const capacity = Number(departure.capacity ?? 0);
        const seatsBooked = Number(departure.seats_booked ?? 0);
        const soldOut = seatsBooked >= capacity;
        // canonical 19 §2.1：旅客要能分辨「客滿」，所以客滿團次保留並標示 soldOut（不提供動作）。
        // 客滿團次不占可售名額上限；另設上限避免整頁被客滿團次佔滿。
        if (soldOut) {
          if (soldOutCount >= MAX_DETAIL_SOLD_OUT_PER_PLAN) { skippedSoldOut = true; continue; }
          soldOutCount += 1;
        }
        departures.push({
          id: departure.id as string,
          departsOn: departure.departs_on as string,
          startTime: departure.start_time == null ? '' : String(departure.start_time).slice(0, 5),
          seatsLeft: soldOut ? 0 : capacity - seatsBooked,
          ...(soldOut ? { soldOut: true } : {}),
          // M1：成團欄位只對 FIXED_DEPARTURE 輸出，REQUEST／INSTANT 的輸出不帶，
          // 以免與 seatsLeft 合併後被反推出 capacity／占位資訊。
          ...(plan.salesMode === 'FIXED_DEPARTURE' ? {
            minToDepart: Number.isInteger(departure.min_to_depart_snapshot) && Number(departure.min_to_depart_snapshot) >= 1
              ? Number(departure.min_to_depart_snapshot) : null,
            formationDeadlineAt: typeof departure.formation_deadline_at === 'string'
              && departure.formation_deadline_at ? departure.formation_deadline_at : null,
            formationStatus: typeof departure.formation_status === 'string' ? departure.formation_status : null,
          } : {}),
        });
        if (availableCount() >= MAX_DETAIL_DEPARTURES_PER_PLAN) {
          // 檢查本頁剩下的列：有可售 → 確認還有未列出的可售團次；其餘為略過的客滿列。
          for (const rest of rows.slice(index + 1)) {
            if (hasStartedToday(rest, now)) continue;
            if (Number(rest.seats_booked ?? 0) < Number(rest.capacity ?? 0)) unlistedSellable = true;
            else skippedSoldOut = true;
          }
          break;
        }
      }

      if (rows.length < pageSize) {
        exhausted = true;
        break;
      }
    }

    // The loop stopped before exhausting the rows (six sellable listed, or the scan limit hit).
    // `departuresMayBeTruncated` is true ONLY when a row we can see confirms an unlisted SELLABLE
    // departure (seats_booked < capacity): either in the remainder of the last page (above) or in one
    // lookahead page past everything examined. If everything seen is sold out we cannot confirm more
    // sellable dates, so it stays false and the sold-out rows are reported via `soldOutOmitted`.
    // Trade-off: a sellable departure beyond the lookahead page is not detected. The flag now only
    // drives the "partial dates" hint copy; it never opens the booking CTA (see
    // hasBookableListedDeparture), so the conservative choice cannot lead to an empty booking page.
    let mayBeTruncated = unlistedSellable;
    if (!exhausted && !unlistedSellable) {
      const { data, error: lookaheadError } = await admin.from('trip_departures')
        .select('id, capacity, seats_booked, departs_on, start_time')
        .eq('tenant_id', shopData.tenantId)
        .eq('trip_id', tripId)
        .eq('plan_id', plan.id)
        .eq('status', 'OPEN')
        .gte('departs_on', now.today)
        .order('departs_on', { ascending: true })
        .order('start_time', { ascending: true, nullsFirst: true })
        .order('id', { ascending: true })
        .range(offset, offset + DETAIL_DEPARTURE_PAGE_SIZE - 1);
      if (lookaheadError) throw queryTripDetailsFailed('trip_departures', lookaheadError);
      const ahead = (data ?? []).filter((row) => !hasStartedToday(row, now));
      mayBeTruncated = ahead.some(
        (row) => Number(row.seats_booked ?? 0) < Number(row.capacity ?? 0),
      );
      if (ahead.length > 0 && !mayBeTruncated) skippedSoldOut = true;
    }

    return [plan.id, {
      departures,
      mayBeTruncated,
      soldOutOmitted: skippedSoldOut,
    }] as const;
  });
  const departuresByPlan = new Map(planDepartureResults);

  const gallery = publicStringList(row.gallery)
    .map(safePublicHttpsUrl).filter(Boolean);
  return {
    shop: shopData.shop,
    trip: {
      id: row.id as string,
      slug: row.slug as string,
      title: (row.title as string) ?? '',
      tagline: (row.tagline as string) ?? '',
      summary: (row.summary as string) ?? '',
      description: (row.description as string) ?? '',
      // canonical trips 無 region／category 欄；型別契約保留 string，回空字串，避免前端重複顯示 location。
      region: '',
      category: '',
      location: (row.location as string) ?? '',
      coverImageUrl: safePublicHttpsUrl(row.cover_image_url),
      galleryUrls: gallery,
      durationHours: row.duration_hours == null ? null : Number(row.duration_hours),
      meetingPoint: (row.meeting_point as string) ?? '',
      meetingPointMapUrl: safePublicHttpsUrl(row.meeting_point_map_url),
      inclusions: publicLines(row.includes),
      exclusions: publicStringList(row.exclusions),
      notices: publicStringList(row.notices),
      safetyNotice: (row.notes as string) ?? '',
      refundPolicyType: row.refund_policy_type === 'FLEXIBLE' || row.refund_policy_type === 'STRICT'
        ? row.refund_policy_type : 'STANDARD',
      plans: plans.map((plan) => ({
        ...plan,
        departures: departuresByPlan.get(plan.id)?.departures ?? [],
        departuresMayBeTruncated: departuresByPlan.get(plan.id)?.mayBeTruncated ?? false,
        ...(departuresByPlan.get(plan.id)?.soldOutOmitted ? { soldOutOmitted: true } : {}),
        ...(departuresByPlan.has(plan.id) ? {} : { departuresNotLoaded: true as const }),
      })),
      ...(plansMayBeTruncated ? { plansMayBeTruncated: true as const } : {}),
    },
  };
}

/**
 * 讀取已發布行程的旅客詳情。每個請求都重新讀取公開來源；`loadPublicShop()` 的
 * React cache 只在同一個請求內合併 metadata/page 查詢，不會跨訪客保留即時團次資料。
 */
export const loadPublicTripDetails = cache(loadPublicTripDetailsUncached);
