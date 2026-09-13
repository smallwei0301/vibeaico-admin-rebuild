/**
 * src/server/traveler-risk-policy.ts — 旅客風險政策的 tenant-scoped 持久化層（#44）
 * -----------------------------------------------------------------------------
 * 對應 `supabase/migrations/0105_issue_44_traveler_risk_policies.sql`：
 * `traveler_risk_policies` 是一張 append-only 帳本（只開放 SELECT/INSERT，
 * 見該檔），每一列都是一次「指派」事件，帶 reason／actor／時間；「目前政策」
 * 由 `traveler_risk_current_policy` view（取最新一列）供讀取。
 *
 * 本檔的值域**逐字**對齊：
 *   - 既有 kernel `src/server/traveler-booking-policy.ts` 的
 *     `TravelerBookingPolicy['kind']`（DEFAULT/FORCE_DEPOSIT/REQUEST_ONLY/
 *     BLOCK_SELF_SERVICE）。
 *   - `docs/decisions/2026-09-11-guide-traveler-policy-no-deposit-waiver.md`：
 *     第一版不提供熟客免訂金／`FORCE_NO_DEPOSIT` 或任何等價能力，因此
 *     `TRAVELER_RISK_POLICY_KINDS` 刻意只有四個值，且 zod 與 DB check constraint
 *     雙重擋下第五個值。
 *   - `src/server/payment-policy.ts` 的 `resolvePaymentPolicy()`：`FORCE_DEPOSIT`
 *     的 `deposit.mode` 只能是 `DEPOSIT_FIXED`／`DEPOSIT_PERCENT`（比
 *     `TripPlan.depositMode` 少 `NONE`／`FULL`），且靜態邊界（FIXED > 0、
 *     PERCENT 1~100）在寫入當下就驗；「不得超過該筆訂單應付金額」需要具體
 *     `amountDue`，屬於既有 kernel 在下單當下驗證的範圍，這裡不重複。
 *
 * ⚠️ 這裡刻意**不**呼叫 requireTenant() 或建立任何 API route——本輪邊界是
 * source-only 的持久化層（見 issue #44 施工分工），HTTP 端點、UI 與
 * #12/#41 checkout／成團串接不在此範圍。呼叫端必須自行以 RLS-respecting
 * session client（`createServerSupabase()`）傳入，租戶隔離由 migration 的 RLS
 * 負責，這裡不重複判斷 —— 唯一的例外是 `actorUserId` 必須等於呼叫者本人，
 * 這件事無法只靠呼叫端誠實遵守，RLS 的 `with check (actor_user_id = auth.uid())`
 * 才是真正的邊界；這裡的 zod 只是先擋一次明顯打錯的輸入，減少一趟無謂的
 * 資料庫往返。
 */
import { z } from 'zod';

export const TRAVELER_RISK_POLICY_KINDS = ['DEFAULT', 'FORCE_DEPOSIT', 'REQUEST_ONLY', 'BLOCK_SELF_SERVICE'] as const;
export type TravelerRiskPolicyKind = (typeof TRAVELER_RISK_POLICY_KINDS)[number];

const FORCE_DEPOSIT_MODES = ['DEPOSIT_FIXED', 'DEPOSIT_PERCENT'] as const;
export type ForceDepositMode = (typeof FORCE_DEPOSIT_MODES)[number];

export type TravelerRiskPolicyDeposit = { mode: ForceDepositMode; value: number };

export type TravelerRiskPolicy = {
  id: string;
  tenantId: string;
  customerId: string;
  policy: TravelerRiskPolicyKind;
  deposit: TravelerRiskPolicyDeposit | null;
  reason: string;
  actorUserId: string;
  actorLabel: string;
  createdAt: string;
};

const depositSchema = z
  .object({
    mode: z.enum(FORCE_DEPOSIT_MODES),
    value: z.number(),
  })
  .superRefine((d, ctx) => {
    if (d.mode === 'DEPOSIT_FIXED' && !(Number.isFinite(d.value) && d.value > 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'DEPOSIT_VALUE_INVALID' });
    }
    if (d.mode === 'DEPOSIT_PERCENT' && !(Number.isFinite(d.value) && d.value >= 1 && d.value <= 100)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'DEPOSIT_PERCENT_OUT_OF_RANGE' });
    }
  });

/** 指派一筆新政策事件（含「解除」——把政策指派回 DEFAULT）的輸入契約。 */
export const assignTravelerRiskPolicySchema = z
  .object({
    customerId: z.string().uuid(),
    policy: z.enum(TRAVELER_RISK_POLICY_KINDS),
    deposit: depositSchema.optional(),
    reason: z.string().trim().min(4, '請填寫原因（至少 4 個字）').max(500),
    actorLabel: z.string().trim().min(1, '請填寫操作者').max(100),
  })
  .superRefine((v, ctx) => {
    if (v.policy === 'FORCE_DEPOSIT' && !v.deposit) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['deposit'], message: 'FORCE_DEPOSIT 需要 deposit' });
    }
    if (v.policy !== 'FORCE_DEPOSIT' && v.deposit) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['deposit'], message: '只有 FORCE_DEPOSIT 可以帶 deposit' });
    }
  });

export type AssignTravelerRiskPolicyInput = z.infer<typeof assignTravelerRiskPolicySchema>;

type PolicyRow = {
  id: string;
  tenant_id: string;
  customer_id: string;
  policy: TravelerRiskPolicyKind;
  deposit_mode: ForceDepositMode | null;
  deposit_value: number | string | null;
  reason: string;
  actor_user_id: string;
  actor_label: string;
  created_at: string;
};

export function mapTravelerRiskPolicyRow(r: PolicyRow): TravelerRiskPolicy {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    customerId: r.customer_id,
    policy: r.policy,
    deposit: r.deposit_mode != null && r.deposit_value != null
      ? { mode: r.deposit_mode, value: Number(r.deposit_value) }
      : null,
    reason: r.reason,
    actorUserId: r.actor_user_id,
    actorLabel: r.actor_label,
    createdAt: r.created_at,
  };
}

type AnyClient = { from: (table: string) => any };

/**
 * 寫入一筆政策指派事件。`actorUserId` 必須是呼叫者自己的 auth uid——RLS 的
 * `with check (actor_user_id = auth.uid())` 才是真正擋住冒名的邊界，這裡只是
 * 讓呼叫端提前得到清楚的型別要求。
 */
export async function assignTravelerRiskPolicy(
  supabase: AnyClient,
  tenantId: string,
  actorUserId: string,
  input: AssignTravelerRiskPolicyInput,
): Promise<TravelerRiskPolicy> {
  const { data, error } = await supabase
    .from('traveler_risk_policies')
    .insert({
      tenant_id: tenantId,
      customer_id: input.customerId,
      policy: input.policy,
      deposit_mode: input.deposit?.mode ?? null,
      deposit_value: input.deposit?.value ?? null,
      reason: input.reason,
      actor_user_id: actorUserId,
      actor_label: input.actorLabel,
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapTravelerRiskPolicyRow(data as PolicyRow);
}

/** 目前生效的政策；沒有任何指派過的旅客回 `null`，呼叫端應視同 `{ kind: 'DEFAULT' }`。 */
export async function getCurrentTravelerRiskPolicy(
  supabase: AnyClient,
  tenantId: string,
  customerId: string,
): Promise<TravelerRiskPolicy | null> {
  const { data, error } = await supabase
    .from('traveler_risk_current_policy')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapTravelerRiskPolicyRow(data as PolicyRow) : null;
}

/** 完整歷史（最新在前）——供「原因：2026-08-28 由 Wayne 設定」這類卡片沿革使用。 */
export async function listTravelerRiskPolicyHistory(
  supabase: AnyClient,
  tenantId: string,
  customerId: string,
): Promise<TravelerRiskPolicy[]> {
  const { data, error } = await supabase
    .from('traveler_risk_policies')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as PolicyRow[]).map(mapTravelerRiskPolicyRow);
}
