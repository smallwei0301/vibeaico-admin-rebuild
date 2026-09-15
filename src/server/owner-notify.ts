/**
 * src/server/owner-notify.ts — LINE 老闆通知 owner-notify（Issue #18）
 *
 * Canonical flow（Issue #18 逐字，不得走回頭路的舊 bind-code 模式）：
 *   已加入 LINE 好友 → 後台從 line_users 挑人 → 本人在 LINE 確認「是我」
 *   → 加入 owner-notify recipients
 *
 * 與 `src/server/line-notify.ts` 的 `notifyBookingStatus`（顧客端推播）是兩條
 * 不同通道：這裡推的對象是**店家團隊**，不是顧客。刻意重用既有的
 * `getLineCredentials` / `lineMulticast` / `consumePushQuota`（06 分冊 §2），
 * 不建第二套 LINE 送信機制——兩者共用同一份每月推播額度。
 *
 * 上限：3 位／租戶，無付費解鎖（Owner 已裁決，Issue #18 本文）。寫死在這裡，
 * 不做成可調欄位——見 migration 0116 檔頭「為什麼是兩張表」段落的同一段說明。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminSupabase } from './supabase';
import { getLineCredentials, lineBotInfo, lineMulticast, consumePushQuota } from './line';
import { ApiHttpError, ERR } from './http';

export const OWNER_NOTIFY_MAX_RECIPIENTS = 3;

export type OwnerNotifyRecipient = {
  id: string;
  lineUserId: string;
  displayName: string;
  pictureUrl: string;
  isPrimary: boolean;
  notifyNewBooking: boolean;
  notifyCancel: boolean;
  createdAt: string;
};

export type OwnerNotifyLineUserCandidate = {
  lineUserId: string;
  displayName: string;
  pictureUrl: string;
  createdAt: string;
  /** 若已有進行中的邀請（等待本人在 LINE 確認），帶回其 id 供畫面顯示「邀請中」。 */
  pendingBindRequestId: string | null;
};

/* ------------------------------------------------------------- 讀取／整理 */

async function fetchRecipientsWithProfile(
  supabase: SupabaseClient, tenantId: string,
): Promise<OwnerNotifyRecipient[]> {
  const { data, error } = await supabase
    .from('owner_notify_recipients')
    .select('id, line_user_id, is_primary, notify_new_booking, notify_cancel, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const { data: profiles, error: pErr } = await supabase
    .from('line_users')
    .select('line_user_id, display_name, picture_url')
    .eq('tenant_id', tenantId)
    .in('line_user_id', rows.map((r) => r.line_user_id));
  if (pErr) throw pErr;
  const byId = new Map((profiles ?? []).map((p) => [p.line_user_id, p]));

  return rows.map((r) => {
    const p = byId.get(r.line_user_id);
    return {
      id: r.id as string,
      lineUserId: r.line_user_id as string,
      // display_name 的唯一事實來源是 line_users（06 分冊同精神）：這裡不複製一份，
      // 空值時交由畫面 fallback 顯示「(LINE 用戶)」。
      displayName: (p?.display_name ?? '') as string,
      pictureUrl: (p?.picture_url ?? '') as string,
      isPrimary: r.is_primary as boolean,
      notifyNewBooking: r.notify_new_booking as boolean,
      notifyCancel: r.notify_cancel as boolean,
      createdAt: r.created_at as string,
    };
  });
}

/**
 * 「已綁定」與「LINE provider 可連線」是兩個不同概念（Issue #18 逐字）：
 * 有 Token／有接收者不代表現在真的推得出去，這裡實際打一次 `GET /v2/bot/info`
 * 才回報 healthy，不是看「有沒有存 Token」就宣稱已連線。
 */
export async function checkOwnerNotifyProviderHealth(
  tenantId: string,
): Promise<{ healthy: boolean; reason: string }> {
  let token: string;
  try {
    ({ token } = await getLineCredentials(tenantId));
  } catch {
    return { healthy: false, reason: '尚未設定 LINE Channel，無法連線' };
  }
  try {
    await lineBotInfo(token);
    return { healthy: true, reason: 'LINE 官方帳號連線正常' };
  } catch {
    return { healthy: false, reason: 'LINE 平台目前無法連線，稍後再試' };
  }
}

export async function getOwnerNotifyOverview(supabase: SupabaseClient, tenantId: string) {
  const [recipients, health] = await Promise.all([
    fetchRecipientsWithProfile(supabase, tenantId),
    checkOwnerNotifyProviderHealth(tenantId),
  ]);
  return {
    recipients,
    maxRecipients: OWNER_NOTIFY_MAX_RECIPIENTS,
    providerHealthy: health.healthy,
    providerHealthReason: health.reason,
  };
}

/** 候選清單：已加好友、尚未是正式接收者；帶回是否已有進行中的邀請。 */
export async function listOwnerNotifyLineUserCandidates(
  supabase: SupabaseClient, tenantId: string,
): Promise<OwnerNotifyLineUserCandidate[]> {
  const [{ data: friends, error: fErr }, { data: recipients, error: rErr }, { data: pending, error: bErr }] =
    await Promise.all([
      supabase.from('line_users')
        .select('line_user_id, display_name, picture_url, created_at')
        .eq('tenant_id', tenantId).eq('followed', true)
        .order('created_at', { ascending: false }),
      supabase.from('owner_notify_recipients').select('line_user_id').eq('tenant_id', tenantId),
      supabase.from('owner_notify_bind_requests')
        .select('id, line_user_id').eq('tenant_id', tenantId).eq('status', 'PENDING'),
    ]);
  if (fErr) throw fErr;
  if (rErr) throw rErr;
  if (bErr) throw bErr;

  const recipientIds = new Set((recipients ?? []).map((r) => r.line_user_id as string));
  const pendingById = new Map((pending ?? []).map((p) => [p.line_user_id as string, p.id as string]));

  return (friends ?? [])
    .filter((f) => !recipientIds.has(f.line_user_id as string))
    .map((f) => ({
      lineUserId: f.line_user_id as string,
      displayName: (f.display_name ?? '') as string,
      pictureUrl: (f.picture_url ?? '') as string,
      createdAt: f.created_at as string,
      pendingBindRequestId: pendingById.get(f.line_user_id as string) ?? null,
    }));
}

/* -------------------------------------------------------------------- bind */

function ownerNotifyConfirmMessage(shop: string, requestId: string) {
  return {
    type: 'text' as const,
    text:
      `【${shop}】後台想把您加入「老闆通知」名單，之後新預約與旅客取消都會通知您。\n` +
      `請確認是您本人：`,
    quickReply: {
      items: [
        {
          type: 'action',
          action: { type: 'postback', label: '是我，加入通知', data: `ownerNotifyConfirm:${requestId}`, displayText: '是我，加入通知' },
        },
        {
          type: 'action',
          action: { type: 'postback', label: '不是我', data: `ownerNotifyDecline:${requestId}`, displayText: '不是我' },
        },
      ],
    },
  };
}

/**
 * 初始化「本人確認」流程：後台選定一位 LINE 好友 → 推一則帶確認按鈕的訊息。
 * 真正加入名單要等本人在 LINE 上按下確認（webhook postback → confirmBind）。
 */
export async function initiateOwnerNotifyBind(
  supabase: SupabaseClient, tenantId: string, tenantName: string, lineUserId: string,
): Promise<{ requestId: string; expiresAt: string }> {
  const { data: friend, error: fErr } = await supabase
    .from('line_users').select('line_user_id')
    .eq('tenant_id', tenantId).eq('line_user_id', lineUserId).eq('followed', true).maybeSingle();
  if (fErr) throw fErr;
  if (!friend) throw new ApiHttpError(404, '找不到此 LINE 好友，或對方已取消追蹤', ERR.NOT_FOUND);

  const { count: recipientCount, error: cErr } = await supabase
    .from('owner_notify_recipients')
    .select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId);
  if (cErr) throw cErr;
  if ((recipientCount ?? 0) >= OWNER_NOTIFY_MAX_RECIPIENTS) {
    throw new ApiHttpError(409, `老闆通知名單已達上限（${OWNER_NOTIFY_MAX_RECIPIENTS} 位）`, ERR.OWNER_NOTIFY_LIMIT);
  }
  const { data: alreadyRecipient, error: arErr } = await supabase
    .from('owner_notify_recipients').select('id')
    .eq('tenant_id', tenantId).eq('line_user_id', lineUserId).maybeSingle();
  if (arErr) throw arErr;
  if (alreadyRecipient) throw new ApiHttpError(409, '此好友已在通知名單中', ERR.CONFLICT);

  // 已有進行中邀請就重用它，不重複發送、不製造彼此競爭的請求（migration 的
  // 部分唯一索引 u_owner_notify_bind_requests_pending 也在 DB 端擋住這件事）。
  const { data: pending, error: pErr } = await supabase
    .from('owner_notify_bind_requests').select('id, expires_at')
    .eq('tenant_id', tenantId).eq('line_user_id', lineUserId).eq('status', 'PENDING').maybeSingle();
  if (pErr) throw pErr;
  if (pending) return { requestId: pending.id as string, expiresAt: pending.expires_at as string };

  const { token } = await getLineCredentials(tenantId);
  if (!(await consumePushQuota(tenantId, 1))) {
    throw new ApiHttpError(409, '本月推播額度不足，無法送出確認邀請', ERR.LINE_API_ERROR);
  }

  const { data: inserted, error: iErr } = await supabase
    .from('owner_notify_bind_requests')
    .insert({ tenant_id: tenantId, line_user_id: lineUserId })
    .select('id, expires_at').single();
  if (iErr) throw iErr;

  await lineMulticast(token, [lineUserId], [ownerNotifyConfirmMessage(tenantName, inserted.id as string)]);

  return { requestId: inserted.id as string, expiresAt: inserted.expires_at as string };
}

/**
 * webhook postback「是我，加入通知」時呼叫（`src/server/line-events.ts`）。
 * 用 service-role admin client（webhook 沒有登入 session 可用）。
 */
export async function confirmOwnerNotifyBind(
  admin: SupabaseClient, tenantId: string, requestId: string, lineUserId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const { data: reqRow, error: rErr } = await admin
    .from('owner_notify_bind_requests').select('id, line_user_id, status, expires_at')
    .eq('id', requestId).eq('tenant_id', tenantId).maybeSingle();
  if (rErr) throw rErr;
  if (!reqRow || reqRow.status !== 'PENDING') return { ok: false, reason: 'INVALID_OR_USED' };
  if (reqRow.line_user_id !== lineUserId) return { ok: false, reason: 'USER_MISMATCH' };
  if (new Date(reqRow.expires_at as string).getTime() < Date.now()) {
    await admin.from('owner_notify_bind_requests')
      .update({ status: 'EXPIRED' }).eq('id', requestId).eq('tenant_id', tenantId);
    return { ok: false, reason: 'EXPIRED' };
  }

  const { count, error: cErr } = await admin
    .from('owner_notify_recipients')
    .select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId);
  if (cErr) throw cErr;
  if ((count ?? 0) >= OWNER_NOTIFY_MAX_RECIPIENTS) {
    await admin.from('owner_notify_bind_requests')
      .update({ status: 'CANCELLED' }).eq('id', requestId).eq('tenant_id', tenantId);
    return { ok: false, reason: 'LIMIT_REACHED' };
  }

  const { error: insErr } = await admin.from('owner_notify_recipients').insert({
    tenant_id: tenantId,
    line_user_id: lineUserId,
    is_primary: (count ?? 0) === 0, // 第一位加入者自動成為主要
  });
  if (insErr) throw insErr;

  await admin.from('owner_notify_bind_requests')
    .update({ status: 'CONFIRMED', confirmed_at: new Date().toISOString() })
    .eq('id', requestId).eq('tenant_id', tenantId);

  return { ok: true };
}

export async function declineOwnerNotifyBind(
  admin: SupabaseClient, tenantId: string, requestId: string, lineUserId: string,
): Promise<void> {
  await admin.from('owner_notify_bind_requests')
    .update({ status: 'CANCELLED' })
    .eq('id', requestId).eq('tenant_id', tenantId).eq('line_user_id', lineUserId).eq('status', 'PENDING');
}

/* --------------------------------------------------------------------- CRUD */

/** 移除一位接收者；若移除的是主要，依 created_at 遞補最早的下一位。 */
export async function removeOwnerNotifyRecipient(
  supabase: SupabaseClient, tenantId: string, id: string,
): Promise<void> {
  const { data: removed, error } = await supabase
    .from('owner_notify_recipients').delete()
    .eq('id', id).eq('tenant_id', tenantId)
    .select('id, is_primary').maybeSingle();
  if (error) throw error;
  if (!removed) throw new ApiHttpError(404, '找不到此接收者', ERR.NOT_FOUND);

  if (removed.is_primary) {
    const { data: next, error: nErr } = await supabase
      .from('owner_notify_recipients').select('id')
      .eq('tenant_id', tenantId).order('created_at', { ascending: true }).limit(1).maybeSingle();
    if (nErr) throw nErr;
    if (next) {
      const { error: uErr } = await supabase
        .from('owner_notify_recipients').update({ is_primary: true }).eq('id', next.id).eq('tenant_id', tenantId);
      if (uErr) throw uErr;
    }
  }
}

export async function removeAllOwnerNotifyRecipients(
  supabase: SupabaseClient, tenantId: string,
): Promise<void> {
  const { error } = await supabase.from('owner_notify_recipients').delete().eq('tenant_id', tenantId);
  if (error) throw error;
}

export type OwnerNotifyRecipientPatch = {
  notifyNewBooking?: boolean;
  notifyCancel?: boolean;
  /** 只允許設為 true（改指定別人為主要）；要「拿掉」主要一律走移除或指定別人。 */
  isPrimary?: true;
};

export async function updateOwnerNotifyRecipient(
  supabase: SupabaseClient, tenantId: string, id: string, patch: OwnerNotifyRecipientPatch,
): Promise<void> {
  const { data: existing, error: eErr } = await supabase
    .from('owner_notify_recipients').select('id').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
  if (eErr) throw eErr;
  if (!existing) throw new ApiHttpError(404, '找不到此接收者', ERR.NOT_FOUND);

  if (patch.isPrimary) {
    // 先清空舊主要、再指定新主要——部分唯一索引保證中途不會同時存在兩位主要
    // 卡在同一個 request 內；兩步都在同一支 API 呼叫、同一個租戶邊界之下。
    const { error: clearErr } = await supabase
      .from('owner_notify_recipients').update({ is_primary: false })
      .eq('tenant_id', tenantId).eq('is_primary', true);
    if (clearErr) throw clearErr;
    const { error: setErr } = await supabase
      .from('owner_notify_recipients').update({ is_primary: true }).eq('id', id).eq('tenant_id', tenantId);
    if (setErr) throw setErr;
  }

  const toggles: Record<string, boolean> = {};
  if (patch.notifyNewBooking !== undefined) toggles.notify_new_booking = patch.notifyNewBooking;
  if (patch.notifyCancel !== undefined) toggles.notify_cancel = patch.notifyCancel;
  if (Object.keys(toggles).length > 0) {
    const { error: tErr } = await supabase
      .from('owner_notify_recipients').update(toggles).eq('id', id).eq('tenant_id', tenantId);
    if (tErr) throw tErr;
  }
}

/* ---------------------------------------------------------------- 事件推播 */

/**
 * 依開關送出老闆通知；N 位接收者消耗 N 則推播額度（Issue #18 逐字，不得少算）。
 * 呼叫規約與 `notifyBookingStatus` 一致：呼叫端 `void`、不影響 API 回應，整段
 * 吞錯只 console.error。
 */
async function sendOwnerNotifyEvent(
  tenantId: string, toggleColumn: 'notify_new_booking' | 'notify_cancel', text: string,
): Promise<void> {
  try {
    const admin = createAdminSupabase();
    const { data: recipients, error } = await admin
      .from('owner_notify_recipients').select('line_user_id')
      .eq('tenant_id', tenantId).eq(toggleColumn, true);
    if (error) throw error;
    const ids = (recipients ?? []).map((r) => r.line_user_id as string);
    if (ids.length === 0) return;

    const { token } = await getLineCredentials(tenantId);
    if (!(await consumePushQuota(tenantId, ids.length))) {
      console.error('[owner-notify] 推播額度不足，略過', tenantId, toggleColumn, ids.length);
      return;
    }
    await lineMulticast(token, ids, [{ type: 'text', text }]);
  } catch (e) {
    console.error('[owner-notify] sendOwnerNotifyEvent 失敗', tenantId, toggleColumn, e);
  }
}

export async function notifyOwnerNewBooking(tenantId: string, bookingId: string): Promise<void> {
  try {
    const admin = createAdminSupabase();
    const [{ data: b }, { data: tenant }] = await Promise.all([
      admin.from('bookings_view').select('customer_name, service_name, start_at')
        .eq('id', bookingId).eq('tenant_id', tenantId).maybeSingle(),
      admin.from('tenants').select('name').eq('id', tenantId).maybeSingle(),
    ]);
    if (!b) return;
    const text =
      `【${tenant?.name ?? ''}】新預約通知\n顧客：${b.customer_name ?? ''}\n` +
      `服務項目：${b.service_name ?? ''}\n預約時間：${formatTaipeiForOwner(b.start_at)}`;
    await sendOwnerNotifyEvent(tenantId, 'notify_new_booking', text);
  } catch (e) {
    console.error('[owner-notify] notifyOwnerNewBooking 失敗', tenantId, bookingId, e);
  }
}

export async function notifyOwnerBookingSelfCancel(tenantId: string, bookingId: string): Promise<void> {
  try {
    const admin = createAdminSupabase();
    const [{ data: b }, { data: tenant }] = await Promise.all([
      admin.from('bookings_view').select('customer_name, service_name, start_at')
        .eq('id', bookingId).eq('tenant_id', tenantId).maybeSingle(),
      admin.from('tenants').select('name').eq('id', tenantId).maybeSingle(),
    ]);
    if (!b) return;
    const text =
      `【${tenant?.name ?? ''}】旅客自行取消預約\n顧客：${b.customer_name ?? ''}\n` +
      `服務項目：${b.service_name ?? ''}\n原預約時間：${formatTaipeiForOwner(b.start_at)}`;
    await sendOwnerNotifyEvent(tenantId, 'notify_cancel', text);
  } catch (e) {
    console.error('[owner-notify] notifyOwnerBookingSelfCancel 失敗', tenantId, bookingId, e);
  }
}

function formatTaipeiForOwner(iso: string): string {
  const t = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ` +
         `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}
