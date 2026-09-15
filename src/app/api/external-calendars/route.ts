// GET /api/external-calendars、POST /api/external-calendars — 外部行事曆訂閱
// CRUD（Issue #21）。租戶邊界完全來自 `requireTenant()` 解析出的 session，
// 絕不信任 client 傳來的 tenantId（同 block-times/campaigns 等既有 route 的
// 慣例）；讀寫都用 session-bound client，靠 0115 migration 的
// `is_tenant_member(tenant_id)` RLS policy 把關。
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import {
  EXTERNAL_CALENDAR_SELECT, externalCalendarWriteSchema, mapExternalCalendar,
  type ExternalCalendarRow,
} from '@/server/external-calendars';

export const GET = handle(async () => {
  const t = await requireTenant();
  const { data, error } = await t.supabase.from('external_calendars')
    .select(EXTERNAL_CALENDAR_SELECT)
    .eq('tenant_id', t.tenantId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ok((data ?? []).map((r) => mapExternalCalendar(r as unknown as ExternalCalendarRow)));
});

export const POST = handle(async (req) => {
  const t = await requireTenant();
  const b = externalCalendarWriteSchema.parse(await req.json());

  if (b.staffId) {
    const { data: staff, error } = await t.supabase.from('staff').select('id')
      .eq('id', b.staffId).eq('tenant_id', t.tenantId).maybeSingle();
    if (error) throw error;
    if (!staff) throw new ApiHttpError(404, '找不到此服務人員', ERR.NOT_FOUND);
  }

  // 從未同步過就是從未同步過——不得在建立當下假造一個成功的 last_synced_at
  // 或 last_sync_status（Issue「Error truth」一節），三個同步狀態欄位全部
  // 交給資料表預設值（NEVER_SYNCED / null / null），這裡完全不寫。
  const { data, error } = await t.supabase.from('external_calendars')
    .insert({
      tenant_id: t.tenantId,
      staff_id: b.staffId ?? null,
      name: b.name,
      ics_url: b.icsUrl,
      active: true,
    })
    .select('id').single();
  if (error) throw error;
  return ok({ id: data.id });
});
