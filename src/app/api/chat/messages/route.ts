import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { pageRange, toPaged } from '@/server/paging';
import { consumePushQuota, getLineCredentials, linePush } from '@/server/line';
import { createAdminSupabase } from '@/server/supabase';
import {
  chatImagePathFromUrl,
  isChatImagePathForTenant,
  previewPathFor,
  resolveLinePreviewImageUrl,
} from '@/server/image';

/**
 * /api/chat/messages（04 分冊 §B-5 / §B-5.1）。
 *
 * GET `?lineUserId&page&size`：分頁，舊→新（created_at asc、id asc 打平）。
 * GET `?lineUserId&after=<messageId>`：只回該筆之後的新訊息（5 秒輪詢用）；
 *   以該筆 created_at 為界、id 打平，全量回傳（不分頁）。
 *
 * POST `{lineUserId, text}` 或 `{lineUserId, type:'image', originalContentUrl,
 * previewImageUrl}`：店家後台主動回覆。圖片 URL 先由 `/api/upload` 取得。
 * replyToken 早已失效只能用 push，會佔推播額度 → 先 `consumePushQuota(tenantId, 1)`，
 * 不足回 409 REQ_003「本月推播額度已用完」且**不呼叫 LINE**；成功 → linePush +
 * 寫 chat_messages(OUT)。圖片 URL 必須是本租戶 chat-images 的 upload 結果，
 *   且 preview 必須是同一張圖推導出的 <=1MB 物件。
 */

function mapMessage(r: any) {
  return {
    id: r.id as string,
    lineUserId: r.line_user_id as string,
    direction: r.direction as 'IN' | 'OUT',
    messageType: (r.message_type ?? 'text') as string,
    text: typeof r.content?.text === 'string' ? (r.content.text as string) : '',
    imageUrl: typeof r.content?.imageUrl === 'string' ? (r.content.imageUrl as string) : '',
    readAt: (r.read_at ?? null) as string | null,
    createdAt: r.created_at as string,
  };
}

const querySchema = z.object({
  lineUserId: z.string().min(1, '請指定對話對象'),
  page: z.coerce.number().int().min(0).default(0),
  size: z.coerce.number().int().min(1).max(100).default(50),
  after: z.string().uuid().optional(),
});

export const GET = handle(async (req) => {
  const t = await requireTenant();
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

  if (q.after) {
    // 增量輪詢：以 after 那筆的 created_at 為界，同時間戳以 id 打平
    const { data: anchor, error: e0 } = await t.supabase
      .from('chat_messages')
      .select('id, created_at')
      .eq('id', q.after).eq('tenant_id', t.tenantId)
      .maybeSingle();
    if (e0) throw e0;
    if (!anchor) throw new ApiHttpError(404, '找不到此訊息', ERR.NOT_FOUND);

    const { data, error } = await t.supabase
      .from('chat_messages')
      .select('*')
      .eq('tenant_id', t.tenantId)
      .eq('line_user_id', q.lineUserId)
      .or(`created_at.gt.${anchor.created_at},and(created_at.eq.${anchor.created_at},id.gt.${anchor.id})`)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(200);
    if (error) throw error;

    return ok((data ?? []).map(mapMessage));
  }

  const { from, to, page, size } = pageRange(q.page, q.size);
  const { data, count, error } = await t.supabase
    .from('chat_messages')
    .select('*', { count: 'exact' })
    .eq('tenant_id', t.tenantId)
    .eq('line_user_id', q.lineUserId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to);
  if (error) throw error;

  return ok(toPaged((data ?? []).map(mapMessage), count, page, size));
});

const httpsImageUrl = z.string().url('圖片網址格式錯誤')
  .refine((u) => u.startsWith('https://'), 'LINE 只接受 https 圖片網址');

const postSchema = z.object({
  lineUserId: z.string().min(1, '請指定對話對象'),
  text: z.string().max(5000, '訊息長度超過上限').optional(),
  type: z.literal('image').optional(),
  originalContentUrl: httpsImageUrl.optional(),
  previewImageUrl: httpsImageUrl.optional(),
}).superRefine((b, ctx) => {
  const hasImageField = b.type !== undefined
    || b.originalContentUrl !== undefined
    || b.previewImageUrl !== undefined;
  if (hasImageField) {
    if (b.type !== 'image' || !b.originalContentUrl || !b.previewImageUrl) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '圖片訊息格式不完整' });
    }
    if (b.text?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '一次只能傳送文字或圖片其中一種' });
    }
    return;
  }
  if (!b.text?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '請輸入訊息內容' });
  }
});

export const POST = handle(async (req) => {
  const t = await requireTenant();
  const b = postSchema.parse(await req.json());
  let chatImageOriginalPath: string | undefined;
  let chatImagePreviewPath: string | undefined;

  // 對象必須是本店的 LINE 使用者（跨租戶 → 404）
  const { data: lu, error: e0 } = await t.supabase
    .from('line_users')
    .select('line_user_id, followed')
    .eq('tenant_id', t.tenantId)
    .eq('line_user_id', b.lineUserId)
    .maybeSingle();
  if (e0) throw e0;
  if (!lu) throw new ApiHttpError(404, '找不到此 LINE 使用者', ERR.NOT_FOUND);
  if (!lu.followed)
    throw new ApiHttpError(409, '對方已封鎖或取消追蹤，無法傳送訊息', ERR.CONFLICT);

  const isImage = b.type === 'image';
  if (isImage) {
    const originalPath = chatImagePathFromUrl(b.originalContentUrl!);
    const previewPath = chatImagePathFromUrl(b.previewImageUrl!);
    if (
      !originalPath
      || !previewPath
      || !isChatImagePathForTenant(originalPath, t.tenantId)
      || previewPath !== previewPathFor(originalPath)
    ) {
      throw new ApiHttpError(400, '圖片必須來自本店剛上傳的 chat-images 物件', ERR.VALIDATION);
    }
    chatImageOriginalPath = originalPath;
    chatImagePreviewPath = previewPath;
    const resolvedPreviewUrl = await resolveLinePreviewImageUrl(t.supabase, b.originalContentUrl!);
    if (resolvedPreviewUrl !== b.previewImageUrl) {
      throw new ApiHttpError(409, '圖片預覽已失效，請重新上傳後再送出', ERR.CONFLICT);
    }
  }

  // 先扣額度；不足或額度服務失敗都不打 LINE（06 分冊 §2）。
  let quotaAvailable: boolean;
  try {
    quotaAvailable = await consumePushQuota(t.tenantId, 1);
  } catch (error) {
    await cleanupChatImage(chatImageOriginalPath, chatImagePreviewPath);
    throw error;
  }
  if (!quotaAvailable) {
    await cleanupChatImage(chatImageOriginalPath, chatImagePreviewPath);
    throw new ApiHttpError(409, '本月推播額度已用完', ERR.CONFLICT);
  }

  try {
    const { token } = await getLineCredentials(t.tenantId);
    await linePush(
      token,
      b.lineUserId,
      isImage
        ? [{ type: 'image', originalContentUrl: b.originalContentUrl!, previewImageUrl: b.previewImageUrl! }]
        : [{ type: 'text', text: b.text }],
    );
  } catch (error) {
    // 額度已預扣但 LINE 未送出：收掉本次上傳的兩個物件，避免 TEST/正式儲存殘渣。
    await cleanupChatImage(chatImageOriginalPath, chatImagePreviewPath);
    throw error;
  }

  const { data, error } = await t.supabase
    .from('chat_messages')
    .insert({
      tenant_id: t.tenantId,
      line_user_id: b.lineUserId,
      direction: 'OUT',
      message_type: isImage ? 'image' : 'text',
      content: isImage
        ? { imageUrl: b.originalContentUrl, previewImageUrl: b.previewImageUrl }
        : { text: b.text },
    })
    .select('*')
    .single();
  if (error) throw error;

  return ok(mapMessage(data));
});

async function cleanupChatImage(originalPath?: string, previewPath?: string): Promise<void> {
  if (!originalPath) return;
  const paths = [originalPath, previewPath].filter((path): path is string => !!path);
  const { error } = await createAdminSupabase().storage.from('chat-images').remove(paths);
  if (error) console.error('[chat] failed to clean unsent image objects', error);
}
