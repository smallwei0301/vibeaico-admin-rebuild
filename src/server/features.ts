/**
 * src/server/features.ts — 功能閘門與 GUIDE 方案權益的共用入口
 * -----------------------------------------------------------------------------
 * LOCAL_SHOP／CLINIC 既有 route 仍可使用 isFeatureActive／requireFeature，維持舊 Feature Store 行為。
 * GUIDE 新 route 應改用 getEntitlement／isEntitled／requireEntitlement，避免在頁面散寫單項功能卡判斷。
 *
 * 第一階段只加入 Owner 已明確裁示的 GUIDE baseline（方案自然包含能力），其餘能力仍讀
 * feature_subscriptions，保留既有 add-on／GRANTED／legacy 相容。正式 SaaS plan 資料來源與
 * 累積 30 張有效訂單上限屬後續獨立切片；本檔不建立第二套 guide_features 真相。
 */
import type { BusinessType } from '@/config/modes';
import { createAdminSupabase } from './supabase';
import { ApiHttpError, ERR } from './http';

export const GUIDE_BASELINE_CAPABILITIES = [
  'EMAIL_NOTIFICATION',
  'BASIC_REPORT',
  'SHIFT_MANAGEMENT',
] as const;

export type EntitlementSource = 'GUIDE_BASELINE' | 'LEGACY_FEATURE' | 'NONE';

export type TenantEntitlementContext = {
  tenantId: string;
  /** 必須來自 server-side tenant membership／tenant row，不得信任 request body。 */
  businessType: BusinessType;
};

const GUIDE_BASELINE_SET = new Set<string>(GUIDE_BASELINE_CAPABILITIES);

export function isGuideBaselineCapability(
  businessType: BusinessType,
  capability: string,
): boolean {
  return businessType === 'GUIDE' && GUIDE_BASELINE_SET.has(capability);
}

/**
 * 純判定核心，方便測試 baseline 與 legacy 相容，不需要碰資料庫。
 * baseline 優先，避免 GUIDE 已含能力仍顯示第二次購買。
 */
export function resolveEntitlementSource(
  businessType: BusinessType,
  capability: string,
  legacyFeatureActive: boolean,
): EntitlementSource {
  if (isGuideBaselineCapability(businessType, capability)) return 'GUIDE_BASELINE';
  return legacyFeatureActive ? 'LEGACY_FEATURE' : 'NONE';
}

/** 舊 Feature Store 有效性判定，維持 LOCAL_SHOP／CLINIC 與既有 route 相容。 */
export async function isFeatureActive(tenantId: string, code: string): Promise<boolean> {
  const admin = createAdminSupabase();
  const { data } = await admin.from('feature_subscriptions')
    .select('active, expires_at').eq('tenant_id', tenantId).eq('code', code).maybeSingle();
  if (!data?.active) return false;
  return !data.expires_at || new Date(data.expires_at) > new Date();
}

export async function getEntitlement(
  tenant: TenantEntitlementContext,
  capability: string,
): Promise<{ active: boolean; source: EntitlementSource }> {
  const baselineSource = resolveEntitlementSource(
    tenant.businessType,
    capability,
    false,
  );
  if (baselineSource === 'GUIDE_BASELINE') {
    return { active: true, source: baselineSource };
  }

  const legacyFeatureActive = await isFeatureActive(tenant.tenantId, capability);
  const source = resolveEntitlementSource(
    tenant.businessType,
    capability,
    legacyFeatureActive,
  );
  return { active: source !== 'NONE', source };
}

export async function isEntitled(
  tenant: TenantEntitlementContext,
  capability: string,
): Promise<boolean> {
  return (await getEntitlement(tenant, capability)).active;
}

export async function requireEntitlement(
  tenant: TenantEntitlementContext,
  capability: string,
) {
  if (!(await isEntitled(tenant, capability))) {
    throw new ApiHttpError(403, '目前方案未包含此能力，請查看方案與加購', ERR.FEATURE_LOCKED);
  }
}

/** 舊 route 專用；GUIDE 新施工請改用 requireEntitlement。 */
export async function requireFeature(tenantId: string, code: string) {
  if (!(await isFeatureActive(tenantId, code)))
    throw new ApiHttpError(403, '此功能尚未訂閱，請至功能商店開通', ERR.FEATURE_LOCKED);
}
