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
 * ## ⚠️ 這是整個專案第一個「不需要登入就能打到」的資料路徑
 *
 * 其餘 163 支 API route 全部經過 `requireTenant()`。這裡沒有那道閘門，所以**外洩的
 * 判準完全落在這個檔自己身上**。三條規則，每一條都不是形式：
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
import { createAdminSupabase } from '@/server/supabase';

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
  minParty: number;
  maxParty: number;
};

export type PublicTrip = {
  id: string;
  title: string;
  summary: string;
  location: string;
  coverImageUrl: string;
  durationHours: number | null;
  plans: PublicPlan[];
  /** 只含今天以後、未取消、未售罄的團次，最多 6 筆 */
  departures: PublicDeparture[];
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
};

/** 一個行程最多顯示幾個近期團次——公開頁不是後台，不需要全部列出來。 */
const MAX_DEPARTURES_PER_TRIP = 6;

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

/**
 * 讀一家店的公開資料。找不到、或該店沒有任何可公開內容時回 null（呼叫端轉 404）。
 *
 * ⚠️ 這裡刻意**不**因為「店家存在但沒有上架任何行程」而回 null —— 那會讓剛註冊
 * 還沒建行程的店家，把自己的公開網址傳出去時拿到 404，而他完全不知道為什麼。
 * 空的店家頁會誠實顯示「這家店還沒有上架的行程」。
 */
export async function loadPublicShop(shopCode: string): Promise<PublicShopData | null> {
  const admin = createAdminSupabase();

  // ① 店家 ＋ 公開的基本設定。白名單欄位；tenant_settings 只取 basic 與 line 兩塊，
  //    而 line 那塊底下只會用到 lineBasicId（見下方），加密欄位一概不取。
  const { data: tenantRow, error: tenantError } = await admin
    .from('tenants')
    .select('id, shop_code, name, business_type, tenant_settings(basic, line)')
    .eq('shop_code', shopCode)
    .maybeSingle();
  // PB-023：丟掉 error 會讓「查詢失敗」冒充「查無此店」，於是一次 DB 故障就會讓
  // 所有店家的公開頁一起變成 404，而錯誤訊息是「找不到這家店」——完全誤導。
  if (tenantError) throw tenantError;
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

  const tenantId = tenantRow.id as string;
  const today = taipeiToday();

  // ② 已發布的行程 ＋ 其方案。`status = 'PUBLISHED'` 是這裡的閘門：草稿與封存
  //    的行程不得出現在公開頁上。
  const [{ data: tripRows, error: tripError }, { data: serviceRows, error: serviceError }] =
    await Promise.all([
      admin.from('trips')
        .select('id, title, summary, location, cover_image_url, duration_hours')
        .eq('tenant_id', tenantId).eq('status', 'PUBLISHED')
        .order('created_at', { ascending: false }),
      admin.from('services')
        .select('id, name, description, duration_minutes, price')
        .eq('tenant_id', tenantId).eq('active', true)
        .order('sort_order', { ascending: true }),
    ]);
  if (tripError) throw tripError;
  if (serviceError) throw serviceError;

  const tripIds = (tripRows ?? []).map((t) => t.id as string);

  const [{ data: planRows, error: planError }, { data: departureRows, error: departureError }] =
    tripIds.length === 0
      ? [{ data: [], error: null }, { data: [], error: null }]
      : await Promise.all([
        admin.from('trip_plans')
          .select('id, trip_id, name, description, price_per_person, min_party, max_party')
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
  if (planError) throw planError;
  if (departureError) throw departureError;

  const plansByTrip = new Map<string, PublicPlan[]>();
  for (const row of planRows ?? []) {
    const list = plansByTrip.get(row.trip_id as string) ?? [];
    list.push({
      id: row.id as string,
      name: (row.name as string) ?? '',
      description: (row.description as string) ?? '',
      pricePerPerson: Number(row.price_per_person ?? 0),
      minParty: Number(row.min_party ?? 1),
      maxParty: Number(row.max_party ?? 1),
    });
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
    title: (row.title as string) ?? '',
    summary: (row.summary as string) ?? '',
    location: (row.location as string) ?? '',
    coverImageUrl: (row.cover_image_url as string) ?? '',
    durationHours: row.duration_hours == null ? null : Number(row.duration_hours),
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

  return { shop, trips, services };
}
