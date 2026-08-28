import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { createAdminSupabase } from '@/server/supabase';
import {
  cleanupReplacedKeywordReplyImage,
  requireKeywordReplyImage,
} from '@/server/keyword-reply-images';

/**
 * PUT/DELETE /api/settings/line/keyword-replies/:id（04 分冊 §B-5）。
 * PUT 只更新 body 裡實際出現的欄位（services 慣例）。
 *
 * ## 閘門：看的是「動作的方向」，不是「對象」（14 分冊 §8.16 的延伸）
 *
 * 擁有者裁決 §8.16 的原則是：**收費擋的是「多做一件事」，不是「少做一件事」**。
 * 那一輪處理的是系統內建關鍵字；這裡是同一個原則套在**自訂**關鍵字上。
 *
 * 先前 PUT 與 DELETE 都無條件 `requireFeature`，於是產生這個狀況：
 * webhook 分支 ② 讀 `keyword_replies` **完全沒有閘門**（退訂後照樣回覆顧客），
 * 但店家要關掉或刪掉它得走這兩支端點 → 403。
 * **結果是店家退訂後，自己寫的話持續發給顧客，而他關不掉也刪不掉。**
 * 那些內容可能是過期的優惠、舊價格、已停售的服務——比系統內建關鍵字更糟，
 * 因為它們是店家自己的名義發出去的。
 *
 * 所以閘門改成依方向判斷：
 *
 * | 動作 | 方向 | 閘門 |
 * |---|---|---|
 * | 改內容（keywords／replyType／content／sortOrder） | 多做一件事 | **擋** |
 * | `active: true`（重新啟用） | 多做一件事 | **擋** |
 * | `active: false`（停用） | 少做一件事 | **不擋** |
 * | DELETE | 少做一件事 | **不擋** |
 *
 * 判斷方式刻意寫成「**只有**停用、沒有夾帶任何內容變更」才放行——
 * 否則送 `{ active: false, content: {...} }` 就能繞過閘門改內容。
 */

const bodySchema = z.object({
  keywords: z.array(z.string().min(1)).min(1, '請至少輸入一個關鍵字').optional(),
  replyType: z.enum(['TEXT', 'IMAGE', 'FLEX']).optional(),
  content: z.record(z.unknown()).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const PUT = handle(async (req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  /* 只有「單純停用」免閘門：active === false 且沒有夾帶任何內容欄位。
     夾帶就視為內容變更，照擋——否則 { active:false, content:{...} } 可以繞過。 */
  const onlyDeactivating =
    b.active === false
    && b.keywords === undefined && b.replyType === undefined
    && b.content === undefined && b.sortOrder === undefined;
  if (!onlyDeactivating) await requireFeature(t.tenantId, 'KEYWORD_REPLY');

  const { data: existing, error: existingError } = await t.supabase
    .from('keyword_replies').select('id, reply_type, content')
    .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (existingError) throw existingError;
  if (!existing) throw new ApiHttpError(404, '找不到此關鍵字回覆', ERR.NOT_FOUND);

  const nextReplyType = b.replyType ?? existing.reply_type;
  const nextContent = b.content ?? existing.content;
  if (nextReplyType === 'IMAGE')
    await requireKeywordReplyImage(nextContent, t.tenantId, createAdminSupabase());

  const update: Record<string, unknown> = {};
  if (b.keywords !== undefined) update.keywords = b.keywords;
  if (b.replyType !== undefined) update.reply_type = b.replyType;
  if (b.content !== undefined) update.content = b.content;
  if (b.active !== undefined) update.active = b.active;
  if (b.sortOrder !== undefined) update.sort_order = b.sortOrder;

  if (Object.keys(update).length === 0) {
    return ok();
  }

  const { data, error } = await t.supabase
    .from('keyword_replies').update(update)
    .eq('id', id).eq('tenant_id', t.tenantId)
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此關鍵字回覆', ERR.NOT_FOUND);

  await cleanupReplacedKeywordReplyImage({
    admin: createAdminSupabase(), tenantId: t.tenantId,
    oldContent: existing.content, nextContent,
  });

  return ok();
});

/* 刪除＝讓 bot 少做一件事，一律免閘門（見檔頭的方向表）。 */
export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;

  const { data: existing, error: existingError } = await t.supabase
    .from('keyword_replies').select('id, content')
    .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (existingError) throw existingError;
  if (!existing) throw new ApiHttpError(404, '找不到此關鍵字回覆', ERR.NOT_FOUND);

  const { data, error } = await t.supabase
    .from('keyword_replies').delete()
    .eq('id', id).eq('tenant_id', t.tenantId)
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此關鍵字回覆', ERR.NOT_FOUND);

  await cleanupReplacedKeywordReplyImage({
    admin: createAdminSupabase(), tenantId: t.tenantId,
    oldContent: existing.content, nextContent: {},
  });

  return ok({ deleted: true });
});
