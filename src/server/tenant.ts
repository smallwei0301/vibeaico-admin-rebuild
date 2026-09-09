import type { BusinessType } from '@/config/modes';
import { createAdminSupabase, createServerSupabase } from './supabase';
import { ApiHttpError, ERR } from './http';
import { cookies } from 'next/headers';
import { isPlatformAdmin, loadActiveImpersonation } from './platform-admin';

export const ACTIVE_TENANT_COOKIE = 'vibeai_active_tenant';

/**
 * 「沒有登入」與「問不到有沒有登入」是兩件事，這裡把它們分開。
 *
 * ⚠️ 最終風險評估（第二輪）抓到的：`supabase.auth.getUser()` **不會為傳輸錯誤丟例外**。
 * auth-js 把網路失敗（`AuthRetryableFetchError`）與 GoTrue 5xx（`AuthApiError`）都當成
 * 「回傳值裡的 error」，`data.user` 同時是 null。原本的寫法只解構 `data.user`、完全不看
 * `error`，於是 **Auth 服務瞬時故障會被降級成 401「請先登入」**。
 *
 * 兩個後果，第二個嚴重得多：
 *   1. 一般使用者在 Auth 抖動時被莫名其妙告知「請先登入」。
 *   2. `handle()` 的代登入稽核層把 401 視為「合法的未登入」而放行，接著 handler 內的
 *      `requireTenant()` **再解析一次**（新的 client、新的 fetch），這次成功——於是那筆
 *      寫入以代登入身分完成，而 `impersonation_actions` 一列都沒有。第一輪只擋住了
 *      DB 故障那條路，Auth 故障照樣穿過去。
 *
 * 只有「真的沒有 session」才算 401；其餘一律 503，讓呼叫端 fail closed。
 */
function isMissingSessionError(error: unknown): boolean {
  const e = error as { name?: string; status?: number } | null;
  if (!e) return true;
  if (e.name === 'AuthSessionMissingError') return true;
  // 401/403＝token 無效或過期，那是真的沒有有效 session；其餘狀態碼是服務本身有問題。
  return e.status === 401 || e.status === 403;
}

export async function requireUser() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error && !isMissingSessionError(error)) {
    console.error('[auth] getUser failed; refusing to treat it as logged out', error);
    throw new ApiHttpError(503, '暫時無法確認登入狀態，請稍後再試', ERR.INTERNAL);
  }
  if (!data?.user) throw new ApiHttpError(401, '請先登入', ERR.UNAUTHORIZED);
  return { supabase, user: data.user };
}

/**
 * 解析目前操作的店家：
 * 1. cookie vibeai_active_tenant 指定且使用者是成員 → 用它
 * 2. 否則取使用者第一個成員資格
 * 回傳的 supabase client 已帶 session，之後查業務表都用它（RLS 把關）。
 * businessType 來自同一筆 server-side tenant membership，供權益判定使用；不得從 request body 覆蓋。
 */
/**
 * 平台管理者身分（`docs/integration/21-PLATFORM-ADMIN-IMPERSONATION.md` §1.1）。
 *
 * 與租戶角色（STAFF／MANAGER／OWNER）**完全分離**：租戶 OWNER 不會因為是 OWNER
 * 而取得這個身分，也沒有任何 API 能把自己加進 `platform_admins`。
 */
export async function requirePlatformAdmin() {
  const { supabase, user } = await requireUser();
  if (!(await isPlatformAdmin(user.id))) {
    throw new ApiHttpError(403, '需要平台管理者權限', ERR.FORBIDDEN);
  }
  return { supabase, user };
}

export async function requireTenant(minRole: 'STAFF' | 'MANAGER' | 'OWNER' = 'STAFF') {
  const { supabase, user } = await requireUser();

  /**
   * ⚠️ 代登入分支——本檔最危險的一段（21 分冊 §2.3）。
   *
   * `loadActiveImpersonation()` 的五個條件必須同時成立才會回非 null；
   * 任何一項不成立它回 `null`，於是這裡**不報錯也不提權**，直接落回下方原本的
   * 成員資格判定。管理者若同時也是某家店的成員，他仍然照原本的身分進那家店。
   *
   * 代登入狀態下必須改用 service role client：管理者不是租戶成員，用他自己的
   * session client 一列都讀不到（RLS 是 `is_tenant_member(tenant_id)`）。
   * 也就是說**這條路徑必然繞過 RLS**，租戶邊界完全落在下方解析出的 `tenantId` 上，
   * 沒有第二道防線——`tenantId` 只能來自 session row，絕不可由 request 覆蓋。
   */
  const impersonation = await loadActiveImpersonation(user.id);
  if (impersonation) {
    const admin = createAdminSupabase();
    const { data: tenant, error: terr } = await admin
      .from('tenants')
      .select('id, shop_code, name, business_type')
      .eq('id', impersonation.tenantId)
      .maybeSingle();
    if (terr) throw terr;
    if (!tenant) throw new ApiHttpError(404, '找不到該店家', ERR.NOT_FOUND);
    return {
      supabase: admin,
      user,
      tenantId: impersonation.tenantId,
      // 代登入的目的就是「協助查看／修改」（裁示明文），所以給足租戶內權限；
      // 但這不是租戶角色，而是代入狀態——`impersonation` 欄位才是真相。
      role: 'OWNER' as string,
      shopCode: tenant.shop_code as string,
      tenantName: tenant.name as string,
      businessType: ((tenant.business_type ?? 'LOCAL_SHOP') as BusinessType),
      impersonation,
    };
  }

  const { data: memberships, error } = await supabase
    .from('tenant_users')
    .select('tenant_id, role, tenants(shop_code, name, business_type)')
    .eq('user_id', user.id);
  if (error || !memberships?.length)
    throw new ApiHttpError(403, '此帳號未加入任何店家', ERR.FORBIDDEN);

  const want = (await cookies()).get(ACTIVE_TENANT_COOKIE)?.value;
  const m = memberships.find((x) => x.tenant_id === want) ?? memberships[0];

  const rank = { STAFF: 0, MANAGER: 1, OWNER: 2 } as const;
  if (rank[m.role as keyof typeof rank] < rank[minRole])
    throw new ApiHttpError(403, '權限不足', ERR.FORBIDDEN);

  return {
    supabase,
    user,
    tenantId: m.tenant_id as string,
    role: m.role as string,
    shopCode: (m as any).tenants.shop_code as string,
    tenantName: (m as any).tenants.name as string,
    businessType: ((m as any).tenants.business_type ?? 'LOCAL_SHOP') as BusinessType,
    /** 一般路徑永遠是 null；有值代表這個請求是平台管理者代入的。 */
    impersonation: null as Awaited<ReturnType<typeof loadActiveImpersonation>>,
  };
}

/**
 * Manager-only API data client.
 *
 * Authentication, tenant selection, role and business-type checks still run
 * through the cookie-backed client above. Once those checks pass, manager
 * mutations use a server-only service-role client because the core tour tables
 * are read-only to public REST roles. Callers must keep every business query
 * explicitly scoped to the selected tenant and validated parent ids.
 */
export async function requireTenantManager() {
  const t = await requireTenant('MANAGER');
  return { ...t, supabase: createAdminSupabase() };
}
