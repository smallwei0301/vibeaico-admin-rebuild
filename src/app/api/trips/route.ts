import { z } from 'zod';
import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTrip } from '@/server/mappers';
import { slugify, toStringArray } from '@/server/trip-payload';
import { taipeiTodayDateString } from '@/server/tz';

/**
 * GET /api/trips — 行程列表（10 分冊 §5，Phase 8a）。
 *
 * planCount / minPrice / upcomingDepartureCount 是列表要顯示的衍生欄位，靠一次
 * join 帶回 trip_plans 與 trip_departures 後在記憶體聚合——行程數量是
 * 「一個導遊的商品目錄」等級（十來筆），不值得為它建 view 或做 N+1 查詢。
 *
 * 「即將出團」的定義：`departs_on >= 今天（台北）` 且 `status = 'OPEN'`。
 * CLOSED/CANCELLED 的團次不算——列表那一欄要回答的是「還有幾團可以賣」。
 */
export const GET = handle(async () => {
  const t = await requireTenant();

  const today = taipeiTodayDateString();
  const { data, error } = await t.supabase
    .from('trips')
    .select('*, trip_plans(base_price, active), trip_departures(departs_on, status)')
    .eq('tenant_id', t.tenantId)
    .order('updated_at', { ascending: false });
  if (error) throw error;

  return ok(
    (data ?? []).map((r: any) => {
      const plans: any[] = Array.isArray(r.trip_plans) ? r.trip_plans : [];
      const prices = plans.filter((p) => p.active).map((p) => Number(p.base_price));
      const departures: any[] = Array.isArray(r.trip_departures) ? r.trip_departures : [];
      return mapTrip(r, {
        planCount: plans.length,
        minPrice: prices.length ? Math.min(...prices) : 0,
        upcomingDepartureCount: departures.filter(
          (d) => d.status === 'OPEN' && String(d.departs_on) >= today,
        ).length,
      });
    }),
  );
});

/** POST /api/trips — 建立行程 ⚙M。 */
const createSchema = z.object({
  title: z.string().min(1, '請輸入行程名稱'),
  slug: z.string().optional(),
  tagline: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  region: z.string().optional(),
  category: z.string().optional(),
  coverImageUrl: z.string().optional(),
  galleryUrls: z.array(z.string()).optional(),
  durationMinutes: z.number().int().min(0).optional(),
  meetingPoint: z.string().optional(),
  meetingPointMapUrl: z.string().optional(),
  inclusions: z.array(z.string()).optional(),
  exclusions: z.array(z.string()).optional(),
  notices: z.array(z.string()).optional(),
  refundRules: z.array(z.string()).optional(),
  safetyNotice: z.string().optional(),
  goodFor: z.array(z.string()).optional(),
  faq: z.array(z.object({ q: z.string(), a: z.string() })).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
});

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const b = createSchema.parse(await req.json());

  const { data, error } = await t.supabase.from('trips').insert({
    tenant_id: t.tenantId,
    slug: slugify(b.slug || b.title, `trip-${Date.now()}`),
    title: b.title,
    tagline: b.tagline ?? '',
    summary: b.summary ?? '',
    description: b.description ?? '',
    region: b.region ?? '',
    category: b.category ?? '',
    cover_image_url: b.coverImageUrl ?? '',
    gallery: b.galleryUrls ?? [],
    duration_minutes: b.durationMinutes ?? null,
    meeting_point: b.meetingPoint ?? '',
    meeting_point_map_url: b.meetingPointMapUrl ?? '',
    inclusions: toStringArray(b.inclusions),
    exclusions: toStringArray(b.exclusions),
    notices: toStringArray(b.notices),
    refund_rules: toStringArray(b.refundRules),
    safety_notice: b.safetyNotice ?? '',
    good_for: toStringArray(b.goodFor),
    faq: b.faq ?? [],
    status: b.status ?? 'DRAFT',
  }).select('*').single();

  // 同一租戶內 slug 唯一（migration 0016 的 unique(tenant_id, slug)）
  if (error?.code === '23505') return fail(409, '此行程代碼已被使用', ERR.CONFLICT);
  if (error) throw error;

  return ok(mapTrip(data, { planCount: 0, minPrice: 0 }));
});
