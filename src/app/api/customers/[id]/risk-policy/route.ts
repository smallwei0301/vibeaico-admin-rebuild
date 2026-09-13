// GET/POST /api/customers/:id/risk-policy — 旅客風險政策（issue #44）。
// 持久化層（`src/server/traveler-risk-policy.ts`）與 migration
// （`supabase/migrations/0105_issue_44_traveler_risk_policies.sql`）已定案，
// 本檔只是把它們接成畫面可用的 HTTP 端點：
//   GET  — 任何店員（STAFF 以上）都能看目前政策與完整歷史，對齊 RLS `p_trp_r`
//          （`is_tenant_member`）——畫面上任何角色都會看到旅客詳情。
//   POST — 只有 MANAGER 以上能套用新政策，對齊 RLS `p_trp_i` 的
//          `tenant_role_at_least(tenant_id, 'MANAGER')`；`actorUserId` 固定用
//          `t.user.id`（呼叫者本人），不接受 body 覆蓋——RLS 的
//          `actor_user_id = auth.uid()` 才是真正擋住冒名操作者的邊界，這裡
//          不給前端機會送出別人的 id。
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import {
  assignTravelerRiskPolicy,
  assignTravelerRiskPolicySchema,
  getCurrentTravelerRiskPolicy,
  listTravelerRiskPolicyHistory,
  toTravelerRiskPolicyDto,
} from '@/server/traveler-risk-policy';

export const GET = handle(async (_req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;

  const [current, history] = await Promise.all([
    getCurrentTravelerRiskPolicy(t.supabase, t.tenantId, id),
    listTravelerRiskPolicyHistory(t.supabase, t.tenantId, id),
  ]);

  return ok({
    current: current ? toTravelerRiskPolicyDto(current) : null,
    history: history.map(toTravelerRiskPolicyDto),
  });
});

export const POST = handle(async (req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;
  const body = await req.json();
  // customerId 來自路由參數，不接受 body 覆蓋（同一顧客的政策只掛在 URL 指定的
  // 那位）——即使 body 裡帶了別的 customerId 也在這裡被蓋掉，才拿去驗證。
  const b = assignTravelerRiskPolicySchema.parse({ ...body, customerId: id });

  // 先確認這位顧客真的屬於本租戶，避免把「顧客不存在／不屬於本店」與 0105
  // 複合 FK 的 23503 混成 500——那個 FK 是資料庫最後一道防線，不是給使用者
  // 看的錯誤訊息來源。
  const { data: customer, error: customerError } = await t.supabase
    .from('customers')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (customerError) throw customerError;
  if (!customer) throw new ApiHttpError(404, '找不到此顧客', ERR.NOT_FOUND);

  const created = await assignTravelerRiskPolicy(t.supabase, t.tenantId, t.user.id, b);

  return ok(toTravelerRiskPolicyDto(created));
});
