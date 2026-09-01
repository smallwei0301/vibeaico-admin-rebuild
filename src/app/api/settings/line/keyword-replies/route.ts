import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { createAdminSupabase } from '@/server/supabase';
import {
  assertKeywordReplyImagePayload,
  keywordReplyImagePaths,
  markKeywordReplyImagePersisted,
  readKeywordReplyImageRef,
  requireKeywordReplyImage,
  withKeywordReplyImagePathsLock,
} from '@/server/keyword-reply-images';

/**
 * /api/settings/line/keyword-replies（04 分冊 §B-5）— keyword_replies CRUD。
 * 欄位以 0005 migration 的 keyword_replies 表為準：keywords text[]（完全比對，
 * 任一命中即回覆）、reply_type TEXT/IMAGE/FLEX、content jsonb（回覆內容；前端的
 * matchType/replyText/imageUrl/linkUrl/linkLabel/overridesSystem 等展示欄位由
 * service 層打包進這個 jsonb，後端不拆欄）、active、sort_order。
 *
 * 閘門（09 分冊 §5）：寫入端點 requireFeature('KEYWORD_REPLY')；讀取不擋。
 * 上限：POST 前查該店筆數 ≥ 20 → 409「每店最多 20 組」。
 */

const KEYWORD_LIMIT = 20;

function mapKeywordReply(r: any) {
  return {
    id: r.id as string,
    keywords: (r.keywords ?? []) as string[],
    replyType: (r.reply_type ?? 'TEXT') as string,
    content: (r.content ?? {}) as Record<string, unknown>,
    active: !!r.active,
    sortOrder: r.sort_order as number,
    createdAt: r.created_at as string,
  };
}

export const GET = handle(async () => {
  const t = await requireTenant();

  const { data, error } = await t.supabase
    .from('keyword_replies')
    .select('*')
    .eq('tenant_id', t.tenantId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;

  // New IMAGE rows prove both objects on every read. Legacy bare imageUrl rows
  // remain readable/stoppable without guessing which public object they meant.
  const imageRows = (data ?? []).filter(
    (row) => row.reply_type === 'IMAGE' && row.content?.imageStorageRef,
  );
  if (imageRows.length) {
    const admin = createAdminSupabase();
    for (const row of imageRows)
      await requireKeywordReplyImage(row.content, t.tenantId, admin);
  }

  return ok((data ?? []).map(mapKeywordReply));
});

const createSchema = z.object({
  keywords: z.array(z.string().min(1)).min(1, '請至少輸入一個關鍵字'),
  replyType: z.enum(['TEXT', 'IMAGE', 'FLEX']).optional(),
  content: z.record(z.unknown()).optional(),
  active: z.boolean().optional(),
});

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'KEYWORD_REPLY');
  const b = createSchema.parse(await req.json());
  assertKeywordReplyImagePayload(b.replyType ?? 'TEXT', b.content ?? {});
  const admin = createAdminSupabase();
  const persistedRef = readKeywordReplyImageRef(b.content);
  let createdId: string;
  await withKeywordReplyImagePathsLock({
    admin,
    tenantId: t.tenantId,
    paths: persistedRef ? keywordReplyImagePaths(persistedRef) : [],
    work: async () => {
      if ((b.replyType ?? 'TEXT') === 'IMAGE')
        await requireKeywordReplyImage(b.content ?? {}, t.tenantId, admin);

      // 每店上限 20 組（09 分冊 §5）
      const { count, error: e0 } = await t.supabase
        .from('keyword_replies')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', t.tenantId);
      if (e0) throw e0;
      if ((count ?? 0) >= KEYWORD_LIMIT)
        throw new ApiHttpError(409, '每店最多 20 組', ERR.CONFLICT);

      const { data: last, error: e1 } = await t.supabase
        .from('keyword_replies')
        .select('sort_order')
        .eq('tenant_id', t.tenantId)
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (e1) throw e1;

      const { data, error } = await t.supabase
        .from('keyword_replies')
        .insert({
          tenant_id: t.tenantId,
          keywords: b.keywords,
          reply_type: b.replyType ?? 'TEXT',
          content: b.content ?? {},
          active: b.active ?? true,
          sort_order: (last?.sort_order ?? -1) + 1,
        })
        .select('id')
        .single();
      if (error) throw error;
      createdId = data.id;

      if (persistedRef) {
        try {
          await markKeywordReplyImagePersisted(admin, t.tenantId, persistedRef);
        } catch (queueError) {
          console.error('[keyword-reply-images] provisional queue clear failed', queueError);
        }
      }
    },
  });

  return ok({ id: createdId! });
});
