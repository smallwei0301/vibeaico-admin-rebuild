import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { hydrateTourOrders } from '@/server/tour-orders';
import { ApiHttpError, ERR } from '@/server/http';
import { GuideReportRangeError, MAX_ROWS, createdRangeBounds } from '@/server/guide-report';
import { loadRepeatCustomerIds } from '@/server/guide-report-repeat';
import { resolvePublicTimeZone } from '@/lib/public-time-zone';

// #43 Final Risk F1：orderId 完全由 client 控制（GUIDE 收件匣 deep link 的 query string），
// 沒驗證時傳一個非 uuid 值會讓 Postgres 直接回 22P02，`handle()` 把它變成 500——但這其實是
// 畸形輸入，應該 400。比照 `/api/bookings` 的 `bookingId`（同一份合約的等價欄位）用
// `z.string().uuid()`；只驗這一個欄位，不把整支路由改寫成 zod schema，避免為了一個 400
// 擴大這支 PR 的範圍。驗證失敗要讓 ZodError 往外丟給 `handle()` 轉 400——不能吞掉當成
// 沒帶 orderId，否則 deep link 打錯字會無聲地退回整頁列表，比報錯更難查。
const orderIdSchema = z.string().uuid().optional();

// #45 報表下鑽：status／tripId／createdFrom／createdTo 全由 client 控制，一律 zod 驗證（非法 → 400）。
// createdFrom/createdTo 為 YYYY-MM-DD，語意＝訂單建立時間落在「租戶時區」[from 00:00, to+1 00:00)，
// 與 /api/reports/guide 同一套界線（createdRangeBounds），所以報表上的數字點進來筆數一致。
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const drilldownSchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED']).optional(),
  tripId: z.string().uuid().optional(),
  planId: z.string().uuid().optional(),
  /** 只列非取消訂單（報表的訂單數／人數／來源口徑）；與 status=CANCELLED 互相矛盾 → 400 */
  activeOnly: z.literal('1').optional(),
  /** 只列「重複旅客」的訂單（口徑同報表）；必須同時帶 createdFrom／createdTo */
  repeatCustomers: z.literal('1').optional(),
  source: z.enum(['MIDAO', 'VIBEAI_SHOP', 'LINE', 'MANUAL']).optional(),
  createdFrom: z.string().regex(DATE_RE, 'createdFrom 需為 YYYY-MM-DD').optional(),
  createdTo: z.string().regex(DATE_RE, 'createdTo 需為 YYYY-MM-DD').optional(),
});

/**
 * GET /api/tour-orders — 旅遊訂單分頁清單（#8-B，10 分冊 §5）。
 *
 * `/tenant/tour-orders` 頁**早就接好這支 service**（`listTourOrders`），
 * 但在 `tour_orders` 表落地之前這支路由不存在，呼叫一律 404 —— 接線在、鏈路不通。
 *
 * 讀取面**不帶 `requireFeature`**：與 `/api/trips` 等五支 GET 一致（#8-A 的
 * read-contract 修正），退訂後店家仍讀得到自己的歷史訂單，只是不能再建新單。
 * 租戶隔離由 `requireTenant()` ＋ 明確的 `tenant_id` 過濾負責。
 */
export const GET = handle(async (req) => {
  const t = await requireTenant();
  const url = new URL(req.url);
  const page = Math.max(0, Number(url.searchParams.get('page') ?? 0) || 0);
  const size = Math.min(100, Math.max(1, Number(url.searchParams.get('size') ?? 20) || 20));
  const paymentStatus = url.searchParams.get('paymentStatus');
  const keyword = (url.searchParams.get('keyword') ?? '').trim();
  // GUIDE 收件匣 REFUND_PENDING 卡片的 deep link（#43 類別 5）以 orderId 精準撈一筆，
  // 比照 `/api/bookings` 的 `bookingId`——`.eq('tenant_id', ...)` 已經先套用，這裡再加
  // `.eq('id', orderId)` 不會、也不能繞過租戶邊界：跨租戶的 id 一律撈不到任何列。
  // 非 uuid 值在這裡就擋下（400），不留給 Postgres 的 22P02 變成 500（Final Risk F1）。
  const q = drilldownSchema.parse({
    status: url.searchParams.get('status') || undefined,
    tripId: url.searchParams.get('tripId') || undefined,
    planId: url.searchParams.get('planId') || undefined,
    activeOnly: url.searchParams.get('activeOnly') || undefined,
    repeatCustomers: url.searchParams.get('repeatCustomers') || undefined,
    source: url.searchParams.get('source') || undefined,
    createdFrom: url.searchParams.get('createdFrom') || undefined,
    createdTo: url.searchParams.get('createdTo') || undefined,
  });
  const status = q.status;
  const orderId = orderIdSchema.parse(url.searchParams.get('orderId') ?? undefined);
  const excludeCancelled = q.activeOnly === '1' || q.repeatCustomers === '1';
  if (excludeCancelled && status === 'CANCELLED') {
    throw new ApiHttpError(400, 'status=CANCELLED 與 activeOnly／repeatCustomers（排除取消訂單）互相矛盾', ERR.VALIDATION);
  }
  if (q.repeatCustomers === '1' && !(q.createdFrom && q.createdTo)) {
    throw new ApiHttpError(400, 'repeatCustomers 必須同時帶 createdFrom 與 createdTo', ERR.VALIDATION);
  }

  let bounds: { gteIso?: string; ltIso?: string } = {};
  if (q.createdFrom || q.createdTo) {
    const { data: settings, error: se } = await t.supabase
      .from('tenant_settings').select('basic').eq('tenant_id', t.tenantId).maybeSingle();
    if (se) throw se;
    const zone = resolvePublicTimeZone((settings?.basic as { timezone?: unknown } | null)?.timezone);
    try {
      bounds = createdRangeBounds(q.createdFrom, q.createdTo, zone);
    } catch (e) {
      if (e instanceof GuideReportRangeError) throw new ApiHttpError(400, e.message, ERR.VALIDATION);
      throw e;
    }
  }

  // 所有篩選集中在這一處，一般清單與「重複旅客」候選查詢共用；tenant_id 一律先套用。
  const filtered = (columns: string, opts?: { count: 'exact' }) => {
    let query = t.supabase.from('tour_orders').select(columns, opts).eq('tenant_id', t.tenantId);
    if (orderId) query = query.eq('id', orderId);
    if (status) query = query.eq('status', status);
    if (excludeCancelled) query = query.neq('status', 'CANCELLED');
    if (q.tripId) query = query.eq('trip_id', q.tripId);
    if (q.planId) query = query.eq('plan_id', q.planId);
    if (bounds.gteIso) query = query.gte('created_at', bounds.gteIso);
    if (bounds.ltIso) query = query.lt('created_at', bounds.ltIso);
    if (q.source) query = query.eq('source', q.source);
    if (paymentStatus) query = query.eq('payment_status', paymentStatus);
    // 顧客姓名與電話存在 contact jsonb 裡，訂單編號是欄位——兩者都要搜得到。
    if (keyword) {
      const like = `%${keyword}%`;
      query = query.or(
        `order_no.ilike.${like},contact->>name.ilike.${like},contact->>phone.ilike.${like}`,
      );
    }
    return query;
  };

  let data: Record<string, unknown>[] | null;
  let count: number | null;
  if (q.repeatCustomers === '1') {
    // 重複旅客集合與報表同一支（loadRepeatCustomerIds → repeatCustomerIdSet）；其餘篩選再縮小清單。
    const repeatIds = await loadRepeatCustomerIds(t.supabase, t.tenantId, bounds.gteIso as string, bounds.ltIso as string);
    const cand: { id: string; customer_id: string | null; created_at: string }[] = [];
    let lastId: string | null = null;
    let scanned = 0;
    for (;;) {
      let cq = filtered('id, customer_id, created_at');
      if (lastId) cq = cq.gt('id', lastId);
      const { data: pg, error: ce } = await cq.order('id', { ascending: true }).limit(1000);
      if (ce) throw ce;
      const rowsPage = (pg ?? []) as unknown as typeof cand;
      cand.push(...rowsPage.filter((r) => r.customer_id && repeatIds.has(r.customer_id)));
      if (rowsPage.length < 1000) break;
      lastId = rowsPage[rowsPage.length - 1].id;
      scanned += rowsPage.length;
      if (scanned >= MAX_ROWS) throw new ApiHttpError(422, '區間內訂單過多，請縮短日期區間', ERR.REPORT_RANGE_TOO_LARGE);
    }
    cand.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : (a.id < b.id ? 1 : -1)));
    count = cand.length;
    const pageIds = cand.slice(page * size, page * size + size).map((r) => r.id);
    if (pageIds.length === 0) {
      data = [];
    } else {
      const { data: rows, error: re } = await t.supabase.from('tour_orders').select('*')
        .eq('tenant_id', t.tenantId).in('id', pageIds);
      if (re) throw re;
      const byId = new Map(((rows ?? []) as Record<string, unknown>[]).map((r) => [r.id as string, r]));
      data = pageIds.map((id) => byId.get(id)).filter((r): r is Record<string, unknown> => !!r);
    }
  } else {
    const res = await filtered('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * size, page * size + size - 1);
    if (res.error) throw res.error;
    data = res.data as unknown as Record<string, unknown>[] | null;
    count = res.count;
  }

  const content = await hydrateTourOrders(t.supabase, t.tenantId, data ?? []);
  const totalElements = count ?? content.length;
  return ok({
    content,
    totalElements,
    totalPages: Math.max(1, Math.ceil(totalElements / size)),
    number: page,
    size,
  });
});
