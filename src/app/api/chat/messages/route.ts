import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { pageRange, toPaged } from '@/server/paging';
import { consumePushQuota, getLineCredentials, linePush } from '@/server/line';
import { tenantOwnedPublicStorageUrl } from '@/server/storage';

/**
 * /api/chat/messages（04 分冊 §B-5 / §B-5.1；圖片訊息＝issue #15）。
 *
 * GET `?lineUserId&page&size`：分頁，舊→新（created_at asc、id asc 打平）。
 * GET `?lineUserId&after=<messageId>`：只回該筆之後的新訊息（5 秒輪詢用）；
 *   以該筆 created_at 為界、id 打平，全量回傳（不分頁）。
 *
 * POST `{lineUserId, text}` 或 `{lineUserId, imageUrl}`：店家後台主動回覆。
 * replyToken 早已失效只能用 push，會佔推播額度 → 先
 * `consumePushQuota(tenantId, 1)`，不足回 409 REQ_003「本月推播額度已用完」
 * 且**不呼叫 LINE**；成功 → linePush（文字或 image message，比照
 * `/api/marketing/pushes/[id]/send` 既有慣例）＋寫 chat_messages(OUT)。
 *
 * `imageUrl` 必須是這個租戶自己上傳到 `chat-images` bucket 的 public URL
 * （由 `POST /api/upload` 回傳），以 `tenantOwnedPublicStorageUrl()` 驗證並
 * 正規化——擋掉其他租戶的圖片或任意外部 URL 被拿來冒充已上傳圖片。
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

const postSchema = z
  .object({
    lineUserId: z.string().min(1, '請指定對話對象'),
    text: z.string().max(5000, '訊息長度超過上限').optional(),
    imageUrl: z.string().url('圖片網址格式錯誤').optional(),
  })
  .refine((b) => (b.text && b.text.trim().length > 0) || (b.imageUrl && b.imageUrl.trim().length > 0), {
    message: '請輸入訊息內容或提供圖片',
  });

export const POST = handle(async (req) => {
  const t = await requireTenant();
  const b = postSchema.parse(await req.json());

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

  // 圖片訊息：imageUrl 必須是本租戶自己上傳到 chat-images 的 public URL，
  // 正規化成 canonical URL 後才拿去打 LINE 與落地，擋掉跨租戶／任意外部 URL。
  let canonicalImageUrl: string | null = null;
  if (b.imageUrl) {
    canonicalImageUrl = tenantOwnedPublicStorageUrl(b.imageUrl, 'chat-images', t.tenantId);
    if (!canonicalImageUrl)
      throw new ApiHttpError(400, '圖片網址不屬於本租戶的已上傳圖片', ERR.VALIDATION);
  }

  // 先扣額度；不足 → 409 且不打 LINE（06 分冊 §2）。圖片訊息一樣計入配額。
  if (!(await consumePushQuota(t.tenantId, 1)))
    throw new ApiHttpError(409, '本月推播額度已用完', ERR.CONFLICT);

  const { token } = await getLineCredentials(t.tenantId);
  const lineMessage = canonicalImageUrl
    ? { type: 'image', originalContentUrl: canonicalImageUrl, previewImageUrl: canonicalImageUrl }
    : { type: 'text', text: b.text as string };
  // linePush 送達 LINE 的伺服器只代表「LINE 平台已接受推播」，不是顧客已讀／
  // 已收到——LINE Messaging API 不回傳送達或已讀狀態，這裡不得也不會假裝知道。
  await linePush(token, b.lineUserId, [lineMessage]);

  const { data, error } = await t.supabase
    .from('chat_messages')
    .insert({
      tenant_id: t.tenantId,
      line_user_id: b.lineUserId,
      direction: 'OUT',
      message_type: canonicalImageUrl ? 'image' : 'text',
      content: canonicalImageUrl ? { imageUrl: canonicalImageUrl } : { text: b.text },
    })
    .select('*')
    .single();
  if (error) throw error;

  return ok(mapMessage(data));
});
