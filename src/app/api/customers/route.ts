import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { isFeatureActive } from '@/server/features';
import { pageRange, toPaged, pageSizeSchema } from '@/server/paging';
import { mapCustomer } from '@/server/mappers';

/**
 * GET /api/customers — 資料源 customers_view（02 分冊 §0007，已含
 * membership_level_name / booking_count / total_spent / last_visit_at / at_risk）。
 * query 對照 src/services/customers.ts 的 CustomerQuery。
 */
const querySchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  size: pageSizeSchema(20),
  keyword: z.string().optional(),
  atRisk: z.coerce.boolean().optional(),
  levelId: z.string().uuid().optional(),
  tag: z.string().optional(),
  minSpent: z.coerce.number().optional(),
  maxSpent: z.coerce.number().optional(),
  minVisits: z.coerce.number().optional(),
});

export const GET = handle(async (req) => {
  const t = await requireTenant();
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const { from, to, page, size } = pageRange(q.page, q.size);

  let query = t.supabase
    .from('customers_view')
    .select('*', { count: 'exact' })
    .eq('tenant_id', t.tenantId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (q.atRisk) query = query.eq('at_risk', true);
  if (q.levelId) query = query.eq('membership_level_id', q.levelId);
  // §5 閘門（09 分冊）：ADVANCED_CUSTOMER 未訂閱時「忽略」進階篩選參數
  // （tag / minSpent / maxSpent / minVisits），不整條擋（列表本身是免費功能）。
  const advancedCustomer =
    (q.tag || q.minSpent != null || q.maxSpent != null || q.minVisits != null)
      ? await isFeatureActive(t.tenantId, 'ADVANCED_CUSTOMER')
      : false;
  if (advancedCustomer && q.tag) query = query.contains('tags', [q.tag]);
  if (advancedCustomer && q.minSpent != null) query = query.gte('total_spent', q.minSpent);
  if (advancedCustomer && q.maxSpent != null) query = query.lte('total_spent', q.maxSpent);
  if (advancedCustomer && q.minVisits != null) query = query.gte('booking_count', q.minVisits);
  if (q.keyword) query = query.or(`name.ilike.%${q.keyword}%,phone.ilike.%${q.keyword}%`);

  const { data, count, error } = await query;
  if (error) throw error;
  return ok(toPaged(data.map(mapCustomer), count, page, size));
});

/**
 * POST /api/customers — 新增顧客。gender 空字串（Gender 型別含 ''）與
 * birthday/membershipLevelId 空字串一律存 null（enum/date/外鍵欄位不接受 ''）。
 */
const genderInput = z.union([z.literal(''), z.enum(['MALE', 'FEMALE', 'OTHER'])]).optional();

const bodySchema = z.object({
  name: z.string().min(1, '請輸入姓名'),
  phone: z.string().optional(),
  email: z.string().optional(),
  gender: genderInput,
  birthday: z.string().optional(),
  note: z.string().optional(),
  tags: z.array(z.string()).optional(),
  membershipLevelId: z.string().optional(),
});

export const POST = handle(async (req) => {
  const t = await requireTenant();
  const b = bodySchema.parse(await req.json());

  /*
   * 「預設等級」（`membership_levels.is_default`，migration 0022 / issue #35）。
   * 原站該欄位的標籤逐字是「設為預設等級（**新顧客自動套用**）」
   * （docs/specs/membership-levels.json 的 levelModal.isDefault），所以旗標存下來
   * 之後，新顧客沒有指定等級時就要套用它——否則畫面上那句括號是一個程式沒做的
   * 宣稱（CLAUDE.md「Never fabricate a known」）。
   * 只在呼叫端**沒有**指定 membershipLevelId 時套用；停用（active=false）的等級
   * 不套用。
   */
  let levelId: string | null = b.membershipLevelId ? b.membershipLevelId : null;
  if (!levelId) {
    const { data: def, error: dErr } = await t.supabase
      .from('membership_levels').select('id')
      .eq('tenant_id', t.tenantId).eq('is_default', true).eq('active', true)
      .maybeSingle();
    if (dErr) throw dErr;
    levelId = def?.id ?? null;
  }

  const { data, error } = await t.supabase
    .from('customers')
    .insert({
      tenant_id: t.tenantId,
      name: b.name,
      phone: b.phone ?? '',
      email: b.email ?? '',
      gender: b.gender ? b.gender : null,
      birthday: b.birthday ? b.birthday : null,
      note: b.note ?? '',
      tags: b.tags ?? [],
      membership_level_id: levelId,
    })
    .select('id')
    .single();
  if (error) throw error;

  return ok({ id: data.id });
});
