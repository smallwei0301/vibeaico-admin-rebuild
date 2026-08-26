import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { mapMembershipLevel } from '@/server/mappers';

/**
 * GET /api/membership-levels — membership_levels + customer_count（依
 * membership_level_id 分組計數 customers）。全量小表，一次抓 customers 的
 * membership_level_id 在記憶體分組（同 coupons 端點手法）。全量不分頁，
 * sort_order asc。
 */
export const GET = handle(async () => {
  const t = await requireTenant();

  const [{ data: levels, error: e1 }, { data: customers, error: e2 }] = await Promise.all([
    t.supabase
      .from('membership_levels')
      .select('*')
      .eq('tenant_id', t.tenantId)
      .order('sort_order', { ascending: true }),
    t.supabase
      .from('customers')
      .select('membership_level_id')
      .eq('tenant_id', t.tenantId)
      .not('membership_level_id', 'is', null),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const counts = new Map<string, number>();
  for (const c of customers ?? []) {
    counts.set(c.membership_level_id, (counts.get(c.membership_level_id) ?? 0) + 1);
  }

  return ok(
    (levels ?? []).map((r: any) => mapMembershipLevel({ ...r, customer_count: counts.get(r.id) ?? 0 })),
  );
});

/**
 * 重算所有顧客等級（04 分冊 §B-4：等級 CRUD 儲存後執行）。
 * 規則：依 threshold_spent 由高至低比對 customers_view.total_spent（bookings
 * 聚合，customers 本表沒有這欄），取第一個 threshold <= spent 的等級；都不符
 * → null。效能：全量載入後在記憶體分組，按「目標等級」批次 update（每個等級
 * 一條 .in() update，而非逐顧客一條）——顧客數在單店規模（數千）內可接受。
 *
 * ⚠️ 同函式在 [id]/route.ts 重複一份：Next route 檔只允許匯出 HTTP handler，
 * 無法從 route.ts 匯出共用函式，而本任務檔案所有權不含 src/server/**。
 */
async function recalcMemberships(t: Awaited<ReturnType<typeof requireTenant>>) {
  const [{ data: levels, error: e1 }, { data: customers, error: e2 }] = await Promise.all([
    t.supabase
      .from('membership_levels')
      .select('id, threshold_spent, active, is_default')
      .eq('tenant_id', t.tenantId),
    t.supabase
      .from('customers_view')
      .select('id, total_spent, membership_level_id')
      .eq('tenant_id', t.tenantId),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  /*
   * issue #35（migration 0022）：`active` / `is_default` 兩個旗標本來是 membership-levels
   * 頁的頁內假資料。存下來之後，這裡是它們唯一有意義的地方——
   *   · `active=false`（原站標籤「啟用此等級」）：停用的等級不參與自動升級。
   *     一個按了「停用」卻照樣把顧客升上去的開關，就是一顆假按鈕。
   *   · `is_default`（原站標籤「設為預設等級（新顧客自動套用）」）：門檻都不符時
   *     落到預設等級，而不是 null。新顧客的那一半在 POST /api/customers。
   * ⚠️ 兩條語意是從**原站自己的標籤文字**推導的（docs/specs/membership-levels.json
   * 的 levelModal），不是掃描到的行為；14 分冊 §6.17 已標註待覆核。
   */
  const usable = (levels ?? []).filter((l: any) => l.active !== false);
  const defaultLevelId = (usable.find((l: any) => l.is_default)?.id as string | undefined) ?? null;
  const sorted = usable
    .map((l: any) => ({ id: l.id as string, threshold: Number(l.threshold_spent) }))
    .sort((a, b) => b.threshold - a.threshold); // 門檻高 → 低

  // target level id（null = 無符合等級）→ 需改成該等級的顧客 id 清單
  const moves = new Map<string | null, string[]>();
  for (const c of customers ?? []) {
    const spent = Number(c.total_spent ?? 0);
    const target = sorted.find((l) => l.threshold <= spent)?.id ?? defaultLevelId;
    if (target !== (c.membership_level_id ?? null)) {
      const list = moves.get(target) ?? [];
      list.push(c.id);
      moves.set(target, list);
    }
  }

  for (const [levelId, ids] of moves) {
    const { error } = await t.supabase
      .from('customers')
      .update({ membership_level_id: levelId })
      .eq('tenant_id', t.tenantId)
      .in('id', ids);
    if (error) throw error;
  }
}

/**
 * POST /api/membership-levels — 新增會員等級（04 分冊 §B-4）⚙M。
 * 儲存後重算所有顧客等級。回 {id}。
 */
const bodySchema = z.object({
  name: z.string().min(1, '請輸入等級名稱'),
  color: z.string().optional(),
  thresholdSpent: z.number().min(0).default(0),
  discountPercent: z.number().min(0).default(0),
  pointRateMultiplier: z.number().min(0).default(1),
  sortOrder: z.number().int().default(0),
  /* --- migration 0022（issue #35）：原站 levelModal 既有欄位 --- */
  description: z.string().optional(),
  active: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'MEMBERSHIP_SYSTEM');
  const b = bodySchema.parse(await req.json());

  const insert: Record<string, unknown> = {
    tenant_id: t.tenantId,
    name: b.name,
    threshold_spent: b.thresholdSpent,
    discount_percent: b.discountPercent,
    point_rate_multiplier: b.pointRateMultiplier,
    sort_order: b.sortOrder,
    description: b.description ?? '',
    active: b.active ?? true,
    is_default: b.isDefault ?? false,
  };
  if (b.color) insert.color = b.color; // 未帶 → 用 DB default '#C9A961'

  /*
   * 每租戶至多一個預設等級（0022 的 partial unique index u_membership_levels_default）。
   * 設新的之前先把舊的清掉，否則 insert 會撞 23505——標籤是單數「設為預設等級」，
   * 所以「設為預設」的語意就是「換成這一個」，不是「再多一個」。
   */
  if (b.isDefault) {
    const { error: cErr } = await t.supabase
      .from('membership_levels').update({ is_default: false })
      .eq('tenant_id', t.tenantId).eq('is_default', true);
    if (cErr) throw cErr;
  }

  const { data, error } = await t.supabase
    .from('membership_levels').insert(insert).select('id').single();
  if (error) throw error;

  await recalcMemberships(t);
  return ok({ id: data.id });
});
