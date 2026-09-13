/**
 * src/server/platform-admin.ts — 平台管理者代登入的伺服器端核心
 * -----------------------------------------------------------------------------
 * 規格：`docs/integration/21-PLATFORM-ADMIN-IMPERSONATION.md`
 * Owner 裁示：`docs/OWNER-DECISIONS.md:108`（2026-08-27）、`:88`（2026-08-28）
 *
 * ## 這個檔案守的那一句話
 *
 * 這條路徑一旦存在，「**是店家自己改的**」就不再能單憑 `updated_at` 證明。
 * 所以這裡的每個判斷都以「任何一筆資料都查得出是誰改的」為第一順位。
 *
 * ## 為什麼 `platform_admins` 沒有新增用的函式
 *
 * 因為刻意不提供。授予只能由 service role 直接寫 DB。一個能自我授權的權限系統
 * 等於沒有權限系統，而這個權限的爆炸半徑是全平台每一家店的每一筆資料。
 * 新增管理者是低頻動作，值得用這個不便換掉整類提權漏洞。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createAdminSupabase } from './supabase';
import { ApiHttpError, ERR } from './http';

export const IMPERSONATION_COOKIE = 'vibeai_impersonation';

/** 30 分鐘硬上限、不續期（21 分冊 §2.2）。 */
export const IMPERSONATION_MAX_AGE_SECONDS = 30 * 60;

/** `reason` 的長度界線；與 `0095` 的 check constraint 相同，兩邊都擋。 */
export const REASON_MIN = 8;
export const REASON_MAX = 200;

export interface ActiveImpersonation {
  sessionId: string;
  adminUserId: string;
  tenantId: string;
  expiresAt: string;
}

/**
 * 目前登入者是不是 platform admin。
 *
 * `platform_admins` 對 anon/authenticated 完全撤權，所以只能用 service role 讀——
 * 這也順帶讓「有沒有人是管理者」這件事不外洩給一般使用者。
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', userId)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/*
 * ⚠️ `requirePlatformAdmin()` 刻意放在 `src/server/tenant.ts`，不在這裡。
 * 它需要 `requireUser()`，而 `tenant.ts` 又需要本檔的 `loadActiveImpersonation()`；
 * 兩邊互相 import 會形成循環相依。身分解析本來就是 `tenant.ts` 的職責，
 * 本檔只負責「代登入這件事本身」。
 */

/**
 * 解析目前請求是否處於**仍然有效**的代登入狀態。
 *
 * ⚠️ 這是本功能最危險的一段：判斷錯就是全平台提權。因此五個條件必須**同時**成立，
 * 任何一項不成立一律回 `null`——**不報錯、不提權**，呼叫端會落回原本的成員資格判定。
 *
 *   ① cookie 存在
 *   ② session 存在且 `ended_at is null`
 *   ③ `expires_at > now()`
 *   ④ 該 `admin_user_id` 在 `platform_admins` 仍為 active
 *   ⑤ session 的 `admin_user_id` 等於當前登入者
 *
 * ④ 擋的是「管理者權限被撤銷後舊 session 還能用」；⑤ 擋的是「cookie 被複製到
 * 另一個帳號」。兩者都必須**每次請求重查**，不可快取——快取一分鐘，就等於撤銷
 * 一個人的權限之後他還有一分鐘可以進任何一家店。
 */
export async function loadActiveImpersonation(
  currentUserId: string | null,
): Promise<ActiveImpersonation | null> {
  if (!currentUserId) return null;

  const sessionId = (await cookies()).get(IMPERSONATION_COOKIE)?.value;
  if (!sessionId) return null; // ①

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from('impersonation_sessions')
    .select('id, admin_user_id, tenant_id, expires_at, ended_at')
    .eq('id', sessionId)
    .maybeSingle();
  // 查詢失敗時**不放行**：DB 故障不該變成「沒有代登入」而讓請求以別的身分繼續。
  if (error) throw error;
  if (!data) return null;

  if (data.ended_at) return null;                                   // ②
  if (new Date(data.expires_at as string) <= new Date()) return null; // ③
  if (data.admin_user_id !== currentUserId) return null;             // ⑤
  if (!(await isPlatformAdmin(data.admin_user_id as string))) return null; // ④

  return {
    sessionId: data.id as string,
    adminUserId: data.admin_user_id as string,
    tenantId: data.tenant_id as string,
    expiresAt: data.expires_at as string,
  };
}

/**
 * 開始一段代登入。回傳 session id 與要寫進 cookie 的到期秒數。
 *
 * `reason` 必填：沒有理由的進入紀錄，稽核時等於沒有紀錄。
 */
export async function startImpersonation(input: {
  adminUserId: string;
  tenantId: string;
  reason: string;
}): Promise<{ sessionId: string; maxAgeSeconds: number; expiresAt: string }> {
  const admin = createAdminSupabase();

  /**
   * 先把這位管理者所有還開著的 session 結束掉。
   *
   * cookie 只有一個，所以「在 A 店代入中又 start B 店」實際上已經離開 A 店了——
   * 但 A 的那一列會維持 `ended_at is null` 直到逾時。A 店的租戶自查頁因此會看到
   * 一段「進行中」的紀錄，而平台其實早就不在裡面了。稽核紀錄說謊比沒有紀錄更糟。
   */
  const { error: closeError } = await admin
    .from('impersonation_sessions')
    .update({ ended_at: new Date().toISOString() })
    .eq('admin_user_id', input.adminUserId)
    .is('ended_at', null);
  if (closeError) throw closeError;

  const expiresAt = new Date(Date.now() + IMPERSONATION_MAX_AGE_SECONDS * 1000).toISOString();
  const { data, error } = await admin
    .from('impersonation_sessions')
    .insert({
      admin_user_id: input.adminUserId,
      tenant_id: input.tenantId,
      reason: input.reason.trim(),
      expires_at: expiresAt,
    })
    .select('id, expires_at')
    .single();
  /**
   * 23505＝撞上 `impersonation_sessions_one_open_per_admin`：另一個併發的 start 搶先
   * 插了一列。回 409 讓呼叫端知道「再試一次」，而不是 500「系統壞了」——這是狀態衝突，
   * 不是故障。刻意不自動重試：同一位管理者同時開兩段代入本來就該被質疑。
   */
  if ((error as { code?: string } | null)?.code === '23505') {
    throw new ApiHttpError(409, '這個帳號已經有另一段代入正在開始，請重試', ERR.CONFLICT);
  }
  if (error) throw error;
  return {
    sessionId: data.id as string,
    maxAgeSeconds: IMPERSONATION_MAX_AGE_SECONDS,
    expiresAt: data.expires_at as string,
  };
}

/** 結束代登入。只有 session 本人結束得了；已結束或不存在都當成功（冪等）。 */
export async function endImpersonation(sessionId: string, adminUserId: string): Promise<void> {
  const admin = createAdminSupabase();
  const { error } = await admin
    .from('impersonation_sessions')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('admin_user_id', adminUserId)
    .is('ended_at', null);
  if (error) throw error;
}

/**
 * 在寫入型請求**執行之前**先記一列 action。
 *
 * ⚠️ 順序是刻意的：先記錄、再執行。反過來寫（執行完才記）的話，稽核寫入失敗時
 * 那筆業務寫入已經發生了，收不回來，而紀錄裡沒有它——正好是稽核最不該有的狀態。
 * 先記錄的話，記錄失敗就整個請求擋掉，什麼都還沒發生。
 */
export async function recordImpersonatedAction(input: {
  sessionId: string;
  tenantId: string;
  method: string;
  path: string;
}): Promise<string> {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from('impersonation_actions')
    .insert({
      session_id: input.sessionId,
      tenant_id: input.tenantId,
      method: input.method,
      path: input.path,
      status: 0, // 尚未執行；成功後由 finishImpersonatedAction 補上真實狀態碼
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

/**
 * 補上實際回應狀態碼。
 *
 * 這一步失敗**不影響請求結果**：那一列已經存在，「這支端點在這個 session 裡被呼叫過」
 * 已經記下來了，缺的只是狀態碼。為了補一個狀態碼而讓一筆已完成的業務寫入回報失敗，
 * 是把小問題換成大問題。
 */
export async function finishImpersonatedAction(actionId: string, status: number): Promise<void> {
  try {
    const admin = createAdminSupabase();
    await admin.from('impersonation_actions').update({ status }).eq('id', actionId);
  } catch (e) {
    console.error('[impersonation] failed to finalize action status', actionId, e);
  }
}

/** 租戶自己查得到的紀錄（裁示明文）。用呼叫端的 client，RLS 把關。 */
export async function loadTenantImpersonationLog(
  client: SupabaseClient,
  tenantId: string,
  limit = 50,
) {
  const [sessions, actions] = await Promise.all([
    client
      .from('impersonation_sessions')
      .select('id, reason, started_at, expires_at, ended_at')
      .eq('tenant_id', tenantId)
      .order('started_at', { ascending: false })
      .limit(limit),
    client
      .from('impersonation_actions')
      .select('id, session_id, method, path, status, at')
      .eq('tenant_id', tenantId)
      .order('at', { ascending: false })
      .limit(limit),
  ]);
  if (sessions.error) throw sessions.error;
  if (actions.error) throw actions.error;
  return { sessions: sessions.data ?? [], actions: actions.data ?? [] };
}
