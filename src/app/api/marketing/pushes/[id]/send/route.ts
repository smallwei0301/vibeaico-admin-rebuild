import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { consumePushQuota, getLineCredentials, lineMulticast } from '@/server/line';
import { resolveLinePreviewImageUrl } from '@/server/image';

/**
 * POST /api/marketing/pushes/:id/send — 立即發送（04 分冊 §B-5、06 分冊 §2/§5）。
 *
 * 流程：條件式 update 佔住 SENDING（防連點重送；僅 DRAFT/SCHEDULED/FAILED 可發）
 * → 解析 audience → line_users → consumePushQuota(tenantId, 人數)（不足 409
 * REQ_003，還原原狀態、不呼叫 LINE）→ lineMulticast（每 500 人一批，LINE 上限）
 * → 寫 sent_count/sent_at、狀態 SENT；LINE API 失敗 → 狀態 FAILED 後拋 502。
 *
 * audience 解析（value 語意見 pushes/route.ts 註解）：
 * - ALL：followed=true 的全部 line_users。
 * - MEMBERSHIP_LEVEL：customers.membership_level_id = value 且已綁 LINE。
 * - TAG：customers.tags 含 value 且已綁 LINE。
 * - CUSTOM：value 依換行拆成 LINE User ID 清單。
 * 各情形皆與本店 followed=true 的 line_users 取交集（不推給已封鎖者，
 * CUSTOM 也因此推不到別店/亂填的 id）。
 */

const SENDABLE = ['DRAFT', 'SCHEDULED', 'FAILED'];
const MULTICAST_LIMIT = 500;

export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;

  // 先讀原狀態（還原用），再條件式 update 佔住 SENDING（防連點重送）
  const { data: row, error: e0 } = await t.supabase
    .from('marketing_pushes')
    .select('id, status, content, audience')
    .eq('id', id).eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (e0) throw e0;
  if (!row) throw new ApiHttpError(404, '找不到此推播', ERR.NOT_FOUND);
  if (!SENDABLE.includes(row.status))
    throw new ApiHttpError(409, '此推播狀態已變更，請重新整理', ERR.CONFLICT);
  const prevStatus = row.status as string;

  const { data: claimed, error: eClaim } = await t.supabase
    .from('marketing_pushes')
    .update({ status: 'SENDING' })
    .eq('id', id).eq('tenant_id', t.tenantId)
    .in('status', SENDABLE)
    .select('id')
    .maybeSingle();
  if (eClaim) throw eClaim;
  if (!claimed)
    throw new ApiHttpError(409, '此推播狀態已變更，請重新整理', ERR.CONFLICT);

  const revert = async (to: string) => {
    await t.supabase.from('marketing_pushes')
      .update({ status: to })
      .eq('id', id).eq('tenant_id', t.tenantId);
  };

  try {
    const a = (row.audience ?? {}) as Record<string, any>;
    const type = (a.type ?? 'ALL') as string;
    const value = typeof a.value === 'string' ? (a.value as string) : '';

    // 本店有效收件底盤：followed=true 的 line_users
    const { data: followers, error: e2 } = await t.supabase
      .from('line_users')
      .select('line_user_id')
      .eq('tenant_id', t.tenantId)
      .eq('followed', true);
    if (e2) throw e2;
    const followerIds = new Set((followers ?? []).map((r) => r.line_user_id as string));

    let recipients: string[];
    if (type === 'ALL') {
      recipients = [...followerIds];
    } else if (type === 'CUSTOM') {
      const wanted = value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      recipients = [...new Set(wanted)].filter((uid) => followerIds.has(uid));
    } else {
      let q = t.supabase
        .from('customers')
        .select('line_user_id')
        .eq('tenant_id', t.tenantId)
        .not('line_user_id', 'is', null);
      if (type === 'MEMBERSHIP_LEVEL') q = q.eq('membership_level_id', value);
      else if (type === 'TAG') q = q.contains('tags', [value]);
      else throw new ApiHttpError(409, '未知的發送對象類型', ERR.CONFLICT);
      const { data: rows, error: e3 } = await q;
      if (e3) throw e3;
      recipients = [...new Set((rows ?? []).map((r) => r.line_user_id as string))]
        .filter((uid) => followerIds.has(uid));
    }

    if (recipients.length === 0) {
      await revert(prevStatus);
      throw new ApiHttpError(409, '沒有符合條件的發送對象', ERR.CONFLICT);
    }

    /**
     * preview 與 original 分流（issue #28 ⑬ / 14 分冊 §8.15）——**chat 與這裡一起修**。
     *
     * LINE 的 `previewImageUrl` 上限只有 1 MB（原圖 10 MB），先前兩個欄位塞同一個
     * URL。縮圖位置由原圖網址推導（規則見 src/server/image.ts）。
     *
     * ⚠️ 這一頁的圖片網址是**店家自己貼的外部網址**（marketing 頁的 `pushImageUrl`
     * 是一個 type=url 的輸入框），不是 /api/upload 上傳的物件。那種網址我們沒託管、
     * 量不到大小、也無從產縮圖 → resolveLinePreviewImageUrl 會原樣回傳，
     * 用原圖當 preview（LINE 官方允許：「the image of the originalContentUrl
     * property may be used as the preview image」）。**這不是退路，是另一種情形**：
     * 有縮圖可產卻沒有產，才會被擋下來。
     *
     * 位置在扣額度**之前**：被擋下時不該吃掉店家 N 則額度，也不該留在 SENDING。
     */
    const c = (row.content ?? {}) as Record<string, any>;
    const imageUrl = typeof c.imageUrl === 'string' ? c.imageUrl : '';
    let previewImageUrl = '';
    if (imageUrl) {
      try {
        previewImageUrl = await resolveLinePreviewImageUrl(t.supabase, imageUrl);
      } catch (e) {
        await revert(prevStatus);
        throw e;
      }
    }

    // 額度不足 → 還原原狀態、不呼叫 LINE（06 分冊 §2）
    if (!(await consumePushQuota(t.tenantId, recipients.length))) {
      await revert(prevStatus);
      throw new ApiHttpError(409, '本月推播額度已用完', ERR.CONFLICT);
    }

    const messages: any[] = [{ type: 'text', text: typeof c.text === 'string' ? c.text : '' }];
    if (imageUrl)
      messages.push({ type: 'image', originalContentUrl: imageUrl, previewImageUrl });

    const { token } = await getLineCredentials(t.tenantId);
    try {
      for (let i = 0; i < recipients.length; i += MULTICAST_LIMIT)
        await lineMulticast(token, recipients.slice(i, i + MULTICAST_LIMIT), messages);
    } catch (err) {
      await revert('FAILED');
      throw err;
    }

    const { error: e4 } = await t.supabase
      .from('marketing_pushes')
      .update({
        status: 'SENT',
        sent_count: recipients.length,
        sent_at: new Date().toISOString(),
      })
      .eq('id', id).eq('tenant_id', t.tenantId);
    if (e4) throw e4;

    return ok({ sentCount: recipients.length });
  } catch (err) {
    // 非上面已處理（revert 過）的意外錯誤也不要卡在 SENDING
    if (err instanceof ApiHttpError) throw err;
    const { data: still } = await t.supabase
      .from('marketing_pushes').select('status')
      .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
    if (still?.status === 'SENDING') await revert('FAILED');
    throw err;
  }
});
