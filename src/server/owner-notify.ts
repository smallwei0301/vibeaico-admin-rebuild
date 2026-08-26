/**
 * src/server/owner-notify.ts — 老闆通知（owner-notify）通道（issue #18 / 補齊-3）
 *
 * 規格出處：`docs/specs/dashboard.json` 的 `jsApiCalls` 與 `jsStrings`（逐字證據
 * 抄在 issue #18「原站事實基準」）；契約補寫於
 * `docs/integration/06-LINE-INTEGRATION.md` §5.5。
 *
 * ⚠️ 與 `src/server/line-notify.ts`（顧客通道，06 §5）是**兩條不同的通道**，
 * 刻意分成兩個檔案：
 *   | | 顧客通道 line-notify.ts | 老闆通道（本檔） |
 *   |---|---|---|
 *   | 對象 | 該筆預約的顧客一人 | 店家團隊，名單 n 位 |
 *   | 名單來源 | customers.line_user_id | owner_notify_recipients |
 *   | 額度 | 每次 1 則 | **每次 n 則**（n = 名單人數，規格逐字） |
 *   | 開關 | tenant_settings.notify.* | 名單本身（名單為空＝不發） |
 * 兩者共用 `consumePushQuota`（同一份 200 則/月的帳），但不得合併成一個函式。
 *
 * 呼叫規約：與 06 §5 相同的 fire-and-forget——動作端點內 `void notifyOwnerNewBooking(...)`，
 * 不 await、整段 try/catch 吞錯，推播慢或失敗都不可拖垮 API 回應。
 *
 * 文案：zh-TW 常數寫在本檔。server 端推播文案不受鐵則 1（頁面 i18n）規範，
 * 比照 `line-notify.ts` / `src/server/email/templates` 先例（送到手機的內容，
 * 不是後台 UI）。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminSupabase } from './supabase';
import { ApiHttpError, ERR } from './http';
import {
  consumePushQuota, getLineCredentials, lineGetRaw, linePush,
} from './line';

/* ------------------------------------------------------------------ 型別 */

/** 名單上的一位接收者（display_name 一律 join line_users 現查，見 0022 檔頭） */
export type OwnerNotifyRecipient = {
  id: string;
  lineUserId: string;
  /** line_users.display_name；可能為空字串，fallback 文案由前端負責 */
  displayName: string;
  pictureUrl: string;
  isPrimary: boolean;
  createdAt: string;
};

/**
 * 通知狀態。規格逐字只有三句（`LINE 通知已開啟` / `LINE 通知已綁定（連線中斷）` /
 * `未設定 LINE`），但那三句蓋不住「LINE 設好了、名單卻是空的」這個狀態——
 * 那時候一則通知都不會發出去，說「已開啟」就是 CLAUDE.md 點名的假的已知。
 * 因此多一個 `NO_RECIPIENTS`（**我方設計**，規格未載），畫面照實說「尚未加入接收者」。
 */
export type OwnerNotifyStatus = 'ENABLED' | 'DISCONNECTED' | 'NO_RECIPIENTS' | 'NOT_CONFIGURED';

export type OwnerNotifyState = {
  status: OwnerNotifyStatus;
  recipients: OwnerNotifyRecipient[];
  maxRecipients: number;
};

/** 可加入名單的 LINE 好友（已 follow、且尚未在名單中） */
export type BindableLineUser = {
  lineUserId: string;
  displayName: string;
  pictureUrl: string;
};

/* -------------------------------------------------------------- 讀取名單 */

type RecipientRow = {
  id: string;
  line_user_id: string;
  is_primary: boolean;
  created_at: string;
};

/**
 * 名單（依加入時間排序——「遞補下一位」的「下一位」就是這個順序的下一位）。
 *
 * 傳入的 supabase client 決定 RLS 生效與否：端點傳 `t.supabase`（帶 session，
 * 跨租戶由 RLS 擋）；推播路徑傳 admin client（沒有使用者 session 可用）。
 */
export async function listOwnerNotifyRecipients(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<OwnerNotifyRecipient[]> {
  const { data, error } = await supabase
    .from('owner_notify_recipients')
    .select('id, line_user_id, is_primary, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });          // 同毫秒打平，順序才是確定的
  if (error) throw error;
  const rows = (data ?? []) as RecipientRow[];
  if (!rows.length) return [];

  // display_name 現查 line_users（本表刻意不存副本，見 migration 0022 檔頭）
  const { data: users, error: uErr } = await supabase
    .from('line_users')
    .select('line_user_id, display_name, picture_url')
    .eq('tenant_id', tenantId)
    .in('line_user_id', rows.map((r) => r.line_user_id));
  if (uErr) throw uErr;
  const byId = new Map(
    (users ?? []).map((u) => [
      u.line_user_id as string,
      { displayName: String(u.display_name ?? ''), pictureUrl: String(u.picture_url ?? '') },
    ]),
  );

  return rows.map((r) => ({
    id: r.id,
    lineUserId: r.line_user_id,
    displayName: byId.get(r.line_user_id)?.displayName ?? '',
    pictureUrl: byId.get(r.line_user_id)?.pictureUrl ?? '',
    isPrimary: r.is_primary,
    createdAt: r.created_at,
  }));
}

/** 該租戶的人數上限（tenants.owner_notify_max_recipients，預設 3——見 0022 檔頭） */
export async function getMaxRecipients(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('tenants')
    .select('owner_notify_max_recipients')
    .eq('id', tenantId)
    .maybeSingle();
  if (error) throw error;
  return Number(data?.owner_notify_max_recipients ?? 3);
}

/**
 * 三＋一態的狀態判定。**每一態都是實際查證過的事實**，不是從「有沒有名單列」推出來的：
 *
 *   NOT_CONFIGURED  沒有 Channel Access Token（解密後為空）
 *   NO_RECIPIENTS   有 token，但名單是空的 → 一則都不會發
 *   DISCONNECTED    有名單，但 `GET /v2/bot/info` 打不通（token 失效／被撤銷）
 *   ENABLED         有名單，且剛剛真的問過 LINE 且回 200
 *
 * ⚠️ 這裡刻意不沿用 `DashboardStats.linePlatformStatus` 的判定——那一支
 * 「有 token 字串就叫 CONNECTED」，從未呼叫過 LINE（CLAUDE.md 點名的例子）。
 * 本頁要區分「已綁定」與「連線正常」，就必須真的問一次。
 * `GET /v2/bot/info` 不佔推播額度（06 §6 / playbook §6）。
 */
export async function resolveOwnerNotifyStatus(
  tenantId: string,
  recipientCount: number,
): Promise<OwnerNotifyStatus> {
  let token = '';
  try {
    token = (await getLineCredentials(tenantId)).token;
  } catch {
    return 'NOT_CONFIGURED';                     // LINE_001＝尚未設定 Channel
  }
  if (!token) return 'NOT_CONFIGURED';
  if (recipientCount === 0) return 'NO_RECIPIENTS';
  try {
    const res = await lineGetRaw(token, '/v2/bot/info');
    return res.ok ? 'ENABLED' : 'DISCONNECTED';
  } catch {
    return 'DISCONNECTED';                       // 連不上 LINE 也是「連線中斷」
  }
}

/** `GET /api/settings/line/owner-notify` 的完整回應 */
export async function getOwnerNotifyState(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<OwnerNotifyState> {
  const [recipients, maxRecipients] = await Promise.all([
    listOwnerNotifyRecipients(supabase, tenantId),
    getMaxRecipients(supabase, tenantId),
  ]);
  const status = await resolveOwnerNotifyStatus(tenantId, recipients.length);
  return { status, recipients, maxRecipients };
}

/* ------------------------------------------------------ 可加入的好友清單 */

/**
 * 「已加入好友（followed）、且尚未在名單中」的 LINE 好友。
 * 空集合時前端顯示規格逐字的 `尚無可加入的 LINE 好友`。
 */
export async function listBindableLineUsers(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<BindableLineUser[]> {
  const [{ data: users, error }, { data: taken, error: tErr }] = await Promise.all([
    supabase.from('line_users')
      .select('line_user_id, display_name, picture_url')
      .eq('tenant_id', tenantId).eq('followed', true)
      .order('created_at', { ascending: true }),
    supabase.from('owner_notify_recipients')
      .select('line_user_id').eq('tenant_id', tenantId),
  ]);
  if (error) throw error;
  if (tErr) throw tErr;

  const already = new Set((taken ?? []).map((r) => r.line_user_id as string));
  return (users ?? [])
    .filter((u) => !already.has(u.line_user_id as string))
    .map((u) => ({
      lineUserId: u.line_user_id as string,
      displayName: String(u.display_name ?? ''),
      pictureUrl: String(u.picture_url ?? ''),
    }));
}

/* ---------------------------------------------------------- 加入／移除 */

/**
 * 把一位好友加進通知名單。`bind`（本人自我認領）與 `recipients/:id`（新增同事）
 * 兩支端點都呼叫這一支——兩者的差別在於**畫面上的語意與文案**（「是我，綁定通知」
 * vs「新增接收者」），寫入行為是同一件事。分成兩份實作就會慢慢分岔，而分岔那天
 * 不會有測試紅（15 分冊記過同型缺陷）。
 *
 * 規則：
 *  - 只能挑「該店已 follow 的好友」→ 否則 404（不是把任意 userId 塞進來）
 *  - 已在名單中 → 409
 *  - 名單已滿（達 max_recipients）→ 409，訊息說得出上限是幾位
 *  - **名單原本是空的 → 這一位自動成為主要**
 */
export async function addOwnerNotifyRecipient(
  supabase: SupabaseClient,
  tenantId: string,
  lineUserId: string,
): Promise<OwnerNotifyRecipient> {
  const { data: friend, error: fErr } = await supabase
    .from('line_users')
    .select('line_user_id, followed')
    .eq('tenant_id', tenantId).eq('line_user_id', lineUserId)
    .maybeSingle();
  if (fErr) throw fErr;
  if (!friend || friend.followed !== true)
    throw new ApiHttpError(404, '找不到這位 LINE 好友，或對方已封鎖官方帳號', ERR.NOT_FOUND);

  const [existing, maxRecipients] = await Promise.all([
    listOwnerNotifyRecipients(supabase, tenantId),
    getMaxRecipients(supabase, tenantId),
  ]);
  if (existing.some((r) => r.lineUserId === lineUserId))
    throw new ApiHttpError(409, '這位已經在通知名單中', ERR.CONFLICT);
  if (existing.length >= maxRecipients)
    throw new ApiHttpError(409, `已達上限 ${maxRecipients} 位，請先移除一位再新增`, ERR.CONFLICT);

  // 名單為空 → 第一位是主要。併發下兩個請求可能都讀到 0 位，第二個會撞
  // u_owner_notify_recipients_primary（部分唯一索引）→ 退回非主要重試一次。
  const wantPrimary = existing.length === 0;
  for (const isPrimary of wantPrimary ? [true, false] : [false]) {
    const { data, error } = await supabase
      .from('owner_notify_recipients')
      .insert({ tenant_id: tenantId, line_user_id: lineUserId, is_primary: isPrimary })
      .select('id, line_user_id, is_primary, created_at')
      .single();
    if (!error) {
      const list = await listOwnerNotifyRecipients(supabase, tenantId);
      return list.find((r) => r.id === (data as RecipientRow).id)!;
    }
    if (error.code === '23505' && isPrimary) continue;     // 主要那格被搶走 → 當非主要
    if (error.code === '23505')
      throw new ApiHttpError(409, '這位已經在通知名單中', ERR.CONFLICT);
    throw error;
  }
  throw new ApiHttpError(409, '加入通知名單失敗，請重試', ERR.CONFLICT);
}

/**
 * 從名單移除一位。
 *
 *  - 移除**非主要** → 其他人不受影響（規格逐字：「其他接收者不受影響」）
 *  - 移除**主要**   → 剩下最早加入的那一位自動遞補為主要（規格逐字：
 *                     「移除後「…」將成為主要接收者（訂閱到期／儲值提醒改發給他）」）
 *  - 移除**最後一位** → 名單為空、之後不再發送。這**不是我們選的**，是規格
 *                     逐字寫的：「這是最後一位接收者，移除後將不再收到 LINE
 *                     即時通知。確定移除？」——所以不特別擋，也不自動關掉什麼。
 *
 * @returns 遞補後成為主要的那一位（沒有遞補時為 null）
 */
export async function removeOwnerNotifyRecipient(
  supabase: SupabaseClient,
  tenantId: string,
  lineUserId: string,
): Promise<{ promoted: OwnerNotifyRecipient | null }> {
  const before = await listOwnerNotifyRecipients(supabase, tenantId);
  const target = before.find((r) => r.lineUserId === lineUserId);
  if (!target) throw new ApiHttpError(404, '這位不在通知名單中', ERR.NOT_FOUND);

  const { error: dErr } = await supabase
    .from('owner_notify_recipients')
    .delete().eq('tenant_id', tenantId).eq('line_user_id', lineUserId);
  if (dErr) throw dErr;

  if (!target.isPrimary) return { promoted: null };

  // 先刪再升，順序不能反——反過來會有一瞬間兩位主要，撞唯一索引。
  const next = before.find((r) => r.lineUserId !== lineUserId);
  if (!next) return { promoted: null };                     // 移除的是最後一位
  const { error: uErr } = await supabase
    .from('owner_notify_recipients')
    .update({ is_primary: true })
    .eq('tenant_id', tenantId).eq('line_user_id', next.lineUserId);
  if (uErr) throw uErr;
  return { promoted: { ...next, isPrimary: true } };
}

/** 解除全部（規格逐字：「確定解除全部 ${n} 位接收者的綁定？」）→ 回實際移除幾位 */
export async function clearOwnerNotifyRecipients(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('owner_notify_recipients')
    .delete().eq('tenant_id', tenantId).select('id');
  if (error) throw error;
  return (data ?? []).length;
}

/* ------------------------------------------------------------ 推播文案 */

function formatTaipei(iso: string): string {
  const t = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} `
       + `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

/** 新預約通知（發給名單上**全部**的人）。純函式，供單元測試直接驗內容。 */
export function buildOwnerNewBookingText(v: {
  shop: string; bookingNo: string; customer: string; service: string; time: string;
}): string {
  return [
    `【${v.shop}】收到新預約 🔔`,
    `訂單編號：${v.bookingNo}`,
    `顧客：${v.customer}`,
    `服務項目：${v.service}`,
    `預約時間：${v.time}`,
    '請到後台確認這筆預約。',
  ].join('\n');
}

/** 訂閱到期提醒（只發給**主要**一位）。純函式。 */
export function buildOwnerSubscriptionExpiryText(v: {
  shop: string; featureName: string; expiresAt: string;
}): string {
  return [
    `【${v.shop}】訂閱即將到期 ⏳`,
    `功能：${v.featureName}`,
    `到期時間：${formatTaipei(v.expiresAt)}`,
    '到期後該功能會暫停對外服務（資料保留）。請到後台「功能商店」續訂。',
  ].join('\n');
}

/** 儲值提醒（只發給**主要**一位）。純函式。 */
export function buildOwnerPointsLowText(v: {
  shop: string; balance: number; needed: number;
}): string {
  return [
    `【${v.shop}】點數不足，可能無法續訂 💳`,
    `目前點數：${v.balance} 點`,
    `即將到期的訂閱需要：${v.needed} 點`,
    '請到後台「點數管理」儲值，避免功能到期後暫停。',
  ].join('\n');
}

/* ------------------------------------------------------------ 推播本體 */

/**
 * 對名單上的每一位各推一則。
 *
 * 為什麼**不用 multicast**：規格逐字寫「每次通知會同時發給 ${n} 位（消耗 ${n}
 * 則推播額度）」，畫面上那句話與實際送出的則數必須對得起來。multicast 一次呼叫
 * 送 n 人（額度一樣算 n 則），但送失敗時分不出是哪一位、也沒辦法只重送一位；
 * 逐一 push 讓「n 位＝n 則＝額度 +n」在請求層面就看得見。
 *
 * 額度：**先整包扣 n 則**再送。扣不到（本月剩餘 < n）就一則都不送——半套送出
 * 會讓名單上一部分人收到、一部分沒收到，而畫面說的是「同時發給 n 位」。
 */
async function pushToRecipients(
  tenantId: string,
  recipients: OwnerNotifyRecipient[],
  text: string,
): Promise<boolean> {
  if (!recipients.length) return false;
  // 憑證先於扣額度（同 line-notify.ts）：沒設定 LINE 就不該白扣配額
  const { token } = await getLineCredentials(tenantId);
  if (!(await consumePushQuota(tenantId, recipients.length))) {
    console.error('[owner-notify] 推播額度不足，略過', tenantId, recipients.length);
    return false;
  }
  for (const r of recipients) {
    await linePush(token, r.lineUserId, [{ type: 'text', text }]);
  }
  return true;
}

/**
 * 新預約 → 通知名單上**全部**的人（規格逐字：「綁定成功！之後有新預約會即時
 * 通知綁定的 LINE。」＋「每次通知會同時發給 ${n} 位」）。
 *
 * ⚠️ 規格**只載明**「新預約」與「訂閱到期／儲值提醒」兩類。「顧客自行取消」
 * 在 `docs/specs/dashboard.json` 全文沒有任何出處，擁有者 2026-08-25 裁示
 * **不納入**（issue #1 裁示總表）——加一個觸發很便宜，發一堆沒人要的通知把
 * 200 則/月的額度燒光很貴。日後找到出處再加。
 */
export async function notifyOwnerNewBooking(
  tenantId: string,
  bookingId: string,
): Promise<void> {
  try {
    const admin = createAdminSupabase();
    const recipients = await listOwnerNotifyRecipients(admin, tenantId);
    if (!recipients.length) return;                          // 名單為空＝不發

    const [{ data: b }, { data: tenant }] = await Promise.all([
      admin.from('bookings_view')
        .select('booking_no, customer_name, service_name, start_at')
        .eq('id', bookingId).eq('tenant_id', tenantId).maybeSingle(),
      admin.from('tenants').select('name').eq('id', tenantId).maybeSingle(),
    ]);
    if (!b) return;

    await pushToRecipients(tenantId, recipients, buildOwnerNewBookingText({
      shop: tenant?.name ?? '',
      bookingNo: String(b.booking_no ?? ''),
      customer: String(b.customer_name ?? ''),
      service: String(b.service_name ?? ''),
      time: formatTaipei(b.start_at as string),
    }));
  } catch (e) {
    console.error('[owner-notify] notifyOwnerNewBooking 失敗', tenantId, bookingId, e);
  }
}

/**
 * 訂閱到期／儲值提醒 → **只發給主要那一位**（規格逐字：「『主要』接收者另外會
 * 收到訂閱到期／儲值提醒（僅發給主要一位）。」）。名單上其他人一則都不會收到。
 *
 * @returns 真的送出去了才回 true（沒有主要接收者、額度不足、LINE 打不通都是 false）
 */
export async function notifyOwnerPrimary(
  tenantId: string,
  text: string,
): Promise<boolean> {
  try {
    const admin = createAdminSupabase();
    const recipients = await listOwnerNotifyRecipients(admin, tenantId);
    const primary = recipients.find((r) => r.isPrimary);
    if (!primary) return false;
    // 回傳值必須是「真的送出去了」，不是「有主要接收者」——額度不足或 LINE 打不通
    // 時回 true 會讓呼叫端（cron）把去重紀錄寫下去，這次沒送到、下次也不會再送。
    return await pushToRecipients(tenantId, [primary], text);
  } catch (e) {
    console.error('[owner-notify] notifyOwnerPrimary 失敗', tenantId, e);
    return false;
  }
}
