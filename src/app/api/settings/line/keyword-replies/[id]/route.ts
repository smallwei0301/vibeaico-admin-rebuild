import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { deleteTenantStorageObjectBestEffort, KEYWORD_REPLY_IMAGES_BUCKET } from '@/server/storage-cleanup';
import { tenantOwnedPublicStorageUrl } from '@/server/storage';

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
 *
 * ## 換圖／移除圖片時清掉舊 Storage 物件（Issue #50 item B）
 *
 * `content` 是整欄覆寫（不是逐欄 merge），所以「換圖」在 DB 層看起來就是
 * 「舊 content.imageUrl 消失、新 content.imageUrl 出現」。PUT 在覆寫前先讀一次
 * 舊 `content.imageUrl`，覆寫成功後若新舊網址不同（含「新的是空字串」＝移除
 * 圖片），就呼叫 `deleteTenantStorageObjectBestEffort()` 刪掉舊物件。
 * 這個呼叫 best-effort、永不 throw——刪不掉只留孤兒（可由共用清理 Issue 之後
 * 回收），但 UPDATE 已經成功的儲存結果不能因為 Storage 清理失敗而回頭失敗。
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

  const update: Record<string, unknown> = {};
  if (b.keywords !== undefined) update.keywords = b.keywords;
  if (b.replyType !== undefined) update.reply_type = b.replyType;
  if (b.content !== undefined) update.content = b.content;
  if (b.active !== undefined) update.active = b.active;
  if (b.sortOrder !== undefined) update.sort_order = b.sortOrder;

  if (Object.keys(update).length === 0) {
    const { data, error } = await t.supabase
      .from('keyword_replies').select('id')
      .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiHttpError(404, '找不到此關鍵字回覆', ERR.NOT_FOUND);
    return ok();
  }

  // content 整欄覆寫前先讀舊 imageUrl（換圖／移除圖片後才知道要不要清 Storage）。
  let oldImageUrl = '';
  if (b.content !== undefined) {
    const { data: existing, error: existingError } = await t.supabase
      .from('keyword_replies').select('content')
      .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
    if (existingError) throw existingError;
    if (!existing) throw new ApiHttpError(404, '找不到此關鍵字回覆', ERR.NOT_FOUND);
    const existingContent = (existing.content ?? {}) as Record<string, unknown>;
    oldImageUrl = typeof existingContent.imageUrl === 'string' ? existingContent.imageUrl : '';
  }

  const { data, error } = await t.supabase
    .from('keyword_replies').update(update)
    .eq('id', id).eq('tenant_id', t.tenantId)
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此關鍵字回覆', ERR.NOT_FOUND);

  // 換圖／移除圖片：儲存已成功，再 best-effort 清掉舊物件；不影響回應結果。
  // 用 canonical URL 比對（見 storage.ts 檔頭），避免同一物件的不同別名寫法
  // （query string／百分比編碼差異）被誤判成「換了圖」而刪掉仍在用的物件。
  if (b.content !== undefined) {
    const newImageUrl = typeof b.content.imageUrl === 'string' ? (b.content.imageUrl as string) : '';
    const canonicalOld =
      tenantOwnedPublicStorageUrl(oldImageUrl, KEYWORD_REPLY_IMAGES_BUCKET, t.tenantId) ?? oldImageUrl;
    const canonicalNew =
      tenantOwnedPublicStorageUrl(newImageUrl, KEYWORD_REPLY_IMAGES_BUCKET, t.tenantId) ?? newImageUrl;
    if (oldImageUrl && canonicalOld !== canonicalNew) {
      await deleteTenantStorageObjectBestEffort({
        bucket: KEYWORD_REPLY_IMAGES_BUCKET,
        url: oldImageUrl,
        tenantId: t.tenantId,
      });
    }
  }

  return ok();
});

/* 刪除＝讓 bot 少做一件事，一律免閘門（見檔頭的方向表）。 */
export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;

  const { data, error } = await t.supabase
    .from('keyword_replies').delete()
    .eq('id', id).eq('tenant_id', t.tenantId)
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此關鍵字回覆', ERR.NOT_FOUND);

  return ok({ deleted: true });
});
