import { z } from 'zod';
import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTrip, mapTripPlan } from '@/server/mappers';
import { slugify, toStringArray } from '@/server/trip-payload';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/trips/[id] — 單一行程 + 其方案。
 * 回 `{ trip, plans }`：編輯頁一次要兩者，分兩支端點只會讓頁面多一輪 loading。
 * 跨租戶一律 404（不洩漏存在性，與 customers/services 同慣例）。
 */
export const GET = handle(async (_req, ctx: Ctx) => {
  const { id } = await (ctx.params);
  const t = await requireTenant();

  const { data: trip, error } = await t.supabase
    .from('trips').select('*').eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!trip) return fail(404, '找不到此行程', ERR.NOT_FOUND);

  const { data: plans, error: perr } = await t.supabase
    .from('trip_plans').select('*')
    .eq('tenant_id', t.tenantId).eq('trip_id', id)
    .order('sort_order', { ascending: true });
  if (perr) throw perr;

  const rows = plans ?? [];
  const prices = rows.filter((p: any) => p.active).map((p: any) => Number(p.base_price));
  return ok({
    trip: mapTrip(trip, {
      planCount: rows.length,
      minPrice: prices.length ? Math.min(...prices) : 0,
    }),
    plans: rows.map(mapTripPlan),
  });
});

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  slug: z.string().optional(),
  tagline: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  region: z.string().optional(),
  category: z.string().optional(),
  coverImageUrl: z.string().optional(),
  galleryUrls: z.array(z.string()).optional(),
  durationMinutes: z.number().int().min(0).nullable().optional(),
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

/** PUT /api/trips/[id] — 更新行程 ⚙M。只送來的欄位才更新（PATCH 語意）。 */
export const PUT = handle(async (req, ctx: Ctx) => {
  const { id } = await (ctx.params);
  const t = await requireTenant('MANAGER');
  const b = updateSchema.parse(await req.json());

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (b.title !== undefined) patch.title = b.title;
  if (b.slug !== undefined) patch.slug = slugify(b.slug, `trip-${Date.now()}`);
  if (b.tagline !== undefined) patch.tagline = b.tagline;
  if (b.summary !== undefined) patch.summary = b.summary;
  if (b.description !== undefined) patch.description = b.description;
  if (b.region !== undefined) patch.region = b.region;
  if (b.category !== undefined) patch.category = b.category;
  if (b.coverImageUrl !== undefined) patch.cover_image_url = b.coverImageUrl;
  if (b.galleryUrls !== undefined) patch.gallery = b.galleryUrls;
  if (b.durationMinutes !== undefined) patch.duration_minutes = b.durationMinutes;
  if (b.meetingPoint !== undefined) patch.meeting_point = b.meetingPoint;
  if (b.meetingPointMapUrl !== undefined) patch.meeting_point_map_url = b.meetingPointMapUrl;
  if (b.inclusions !== undefined) patch.inclusions = toStringArray(b.inclusions);
  if (b.exclusions !== undefined) patch.exclusions = toStringArray(b.exclusions);
  if (b.notices !== undefined) patch.notices = toStringArray(b.notices);
  if (b.refundRules !== undefined) patch.refund_rules = toStringArray(b.refundRules);
  if (b.safetyNotice !== undefined) patch.safety_notice = b.safetyNotice;
  if (b.goodFor !== undefined) patch.good_for = toStringArray(b.goodFor);
  if (b.faq !== undefined) patch.faq = b.faq;
  if (b.status !== undefined) patch.status = b.status;

  const { data, error } = await t.supabase.from('trips')
    .update(patch).eq('tenant_id', t.tenantId).eq('id', id).select('*').maybeSingle();
  if (error?.code === '23505') return fail(409, '此行程代碼已被使用', ERR.CONFLICT);
  if (error) throw error;
  if (!data) return fail(404, '找不到此行程', ERR.NOT_FOUND);

  return ok(mapTrip(data));
});

/** DELETE /api/trips/[id] — 刪除行程 ⚙M（方案由 FK on delete cascade 一併移除）。 */
export const DELETE = handle(async (_req, ctx: Ctx) => {
  const { id } = await (ctx.params);
  const t = await requireTenant('MANAGER');

  const { data, error } = await t.supabase.from('trips')
    .delete().eq('tenant_id', t.tenantId).eq('id', id).select('id').maybeSingle();
  if (error) throw error;
  if (!data) return fail(404, '找不到此行程', ERR.NOT_FOUND);

  return ok({ deleted: true });
});
