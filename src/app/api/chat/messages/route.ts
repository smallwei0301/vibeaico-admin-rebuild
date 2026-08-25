import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { pageRange, toPaged, pageSizeSchema } from '@/server/paging';
import { consumePushQuota, getLineCredentials, linePush } from '@/server/line';
import { resolveLinePreviewImageUrl } from '@/server/image';

/**
 * /api/chat/messages（04 分冊 §B-5 / §B-5.1）。
 *
 * GET `?lineUserId&page&size`：分頁，舊→新（created_at asc、id asc 打平）。
 * GET `?lineUserId&after=<messageId>`：只回該筆之後的新訊息（5 秒輪詢用）；
 *   以該筆 created_at 為界、id 打平，全量回傳（不分頁）。
 *
 * POST `{lineUserId, text}` 或 `{lineUserId, imageUrl}`：店家後台主動回覆。
 * replyToken 早已失效只能用 push，會佔推播額度 → 先 `consumePushQuota(tenantId, 1)`，
 * 不足回 409 REQ_003「本月推播額度已用完」且**不呼叫 LINE**；成功 → linePush +
 * 寫 chat_messages(OUT)。
 *
 * 圖片訊息（修復-7 / issue #15）：前端先打 POST /api/upload（bucket=chat-images，
 * 0017 migration 新增）拿到 public URL，再把該 URL 以 `imageUrl` 傳進來，這裡送
 * LINE image message（originalContentUrl=原圖、**previewImageUrl=/api/upload 一併
 * 產好的 ≤1 MB 縮圖**，issue #28 ⑬；LINE 只收 https 外連圖）並寫
 * message_type='image'、content={imageUrl}——存的是原圖網址，縮圖位置一律推導。
 * **刻意不另開 `/api/chat/messages/:id/image`**：`[id]` 這一段在本路由樹已經是
 * 「訊息 id」（見 messages/[id]/read），再拿來當對話 id 會是同名不同義；而且
 * 額度檢查 → push → 寫 OUT 這條鏈只要複製一份就會有走鐘的一天。改成同一支
 * POST 的可辨識聯集（text 或 imageUrl 二擇一），兩種訊息共用同一條鏈路。
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
  size: pageSizeSchema(50),
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
    /** 圖片訊息：必須是 /api/upload 回的 https public URL（LINE 不收 http / data:） */
    imageUrl: z
      .string()
      .url('圖片網址格式錯誤')
      .refine((u) => u.startsWith('https://'), 'LINE 只接受 https 圖片網址')
      .optional(),
  })
  .refine((b) => !(b.text?.trim() && b.imageUrl), {
    message: '一次只能傳送文字或圖片其中一種',
  })
  .refine((b) => !!b.imageUrl || !!b.text?.trim(), {
    message: '請輸入訊息內容',
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

  const isImage = !!b.imageUrl;

  /**
   * preview 與 original 分流（issue #28 ⑬ / 14 分冊 §8.15）。
   *
   * LINE 對這兩個欄位的上限不同（original 10 MB、**preview 1 MB**），先前兩個欄位
   * 塞同一個 URL，於是 1–5 MB 的圖（手機原圖）當 preview 就超規。縮圖由 /api/upload
   * 上傳時一併產出，這裡**從原圖網址推導**出它的位置，不另外存一筆。
   * 每一種結果分別代表什麼、哪一種會被擋下，見 resolveLinePreviewImageUrl 的註解。
   *
   * 位置在扣額度**之前**：被擋下時不該吃掉店家一則推播額度（與下面的額度不足
   * 同一個道理——沒送出去的東西不收費）。
   */
  const previewImageUrl = isImage
    ? await resolveLinePreviewImageUrl(t.supabase, b.imageUrl!)
    : '';

  // 先扣額度；不足 → 409 且不打 LINE（06 分冊 §2）
  if (!(await consumePushQuota(t.tenantId, 1)))
    throw new ApiHttpError(409, '本月推播額度已用完', ERR.CONFLICT);

  const { token } = await getLineCredentials(t.tenantId);
  await linePush(
    token,
    b.lineUserId,
    isImage
      ? [{ type: 'image', originalContentUrl: b.imageUrl, previewImageUrl }]
      : [{ type: 'text', text: b.text }],
  );

  const { data, error } = await t.supabase
    .from('chat_messages')
    .insert({
      tenant_id: t.tenantId,
      line_user_id: b.lineUserId,
      direction: 'OUT',
      message_type: isImage ? 'image' : 'text',
      content: isImage ? { imageUrl: b.imageUrl } : { text: b.text },
    })
    .select('*')
    .single();
  if (error) throw error;

  return ok(mapMessage(data));
});
