import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { pageRange, toPaged } from '@/server/paging';
import {
  LineDeliveryError,
  commitPushQuota,
  getLineCredentials,
  linePush,
  refundPushQuota,
  reservePushQuota,
} from '@/server/line';
import { createAdminSupabase } from '@/server/supabase';
import {
  PREVIEW_BUCKET,
  resolveChatImageStorageRef,
} from '@/server/image';
import type { ChatImageStorageRef } from '@/server/image';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * /api/chat/messages（04 分冊 §B-5 / §B-5.1）。
 *
 * GET `?lineUserId&page&size`：分頁，舊→新（created_at asc、id asc 打平）。
 * GET `?lineUserId&after=<messageId>`：只回該筆之後的新訊息（5 秒輪詢用）；
 *   以該筆 created_at 為界、id 打平，全量回傳（不分頁）。
 *
 * POST `{lineUserId, text}` 或 `{lineUserId, type:'image', storageRef}`：店家後台主動回覆。
 * 圖片先由 `/api/upload` 取得 tenant-scoped storage ref；LINE URL 由 server 驗證物件後產生。
 * replyToken 早已失效只能用 push，會佔推播額度 → 先 `consumePushQuota(tenantId, 1)`，
 * 不足回 409 REQ_003「本月推播額度已用完」且**不呼叫 LINE**；成功 → linePush +
 * 寫 chat_messages(OUT)。圖片 ref 必須是本租戶 chat-images 的 upload 結果，原圖和
 * preview 會在送出前重新驗證為 JPEG/PNG 且分別符合 5MB/1MB 上限。
 * POST 先以 idempotency key claim 一筆 PENDING receipt；同 key 的 retry 不會再次
 * 呼叫 LINE。只有 LINE 明確以 4xx 拒絕時才退款；timeout、5xx、設定／資料庫
 * 不確定性都保留 RETRY，不刪圖片、不退款，避免 provider 已收件卻重複推播。
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
    deliveryStatus: r.delivery_status as string,
  };
}

function requestFingerprint(body: z.infer<typeof postSchema>): string {
  return createHash('sha256').update(JSON.stringify({
    lineUserId: body.lineUserId,
    text: body.text ?? null,
    type: body.type ?? 'text',
    storageRef: body.storageRef ?? null,
  })).digest('hex');
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
      .eq('delivery_status', 'SENT')
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
    .eq('delivery_status', 'SENT')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to);
  if (error) throw error;

  return ok(toPaged((data ?? []).map(mapMessage), count, page, size));
});

const chatImageStorageRefSchema = z.object({
  bucket: z.literal(PREVIEW_BUCKET),
  path: z.string().min(1),
  previewPath: z.string().min(1),
}).strict();

const postSchema = z.object({
  lineUserId: z.string().min(1, '請指定對話對象'),
  text: z.string().max(5000, '訊息長度超過上限').optional(),
  type: z.literal('image').optional(),
  idempotencyKey: z.string().uuid().optional(),
  storageRef: chatImageStorageRefSchema.optional(),
}).strict().superRefine((b, ctx) => {
  const hasImageField = b.type !== undefined || b.storageRef !== undefined;
  if (hasImageField) {
    if (b.type !== 'image' || !b.storageRef) {
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
  const idempotencyKey = b.idempotencyKey ?? randomUUID();
  const fingerprint = requestFingerprint(b);
  let chatImageOriginalPath: string | undefined;
  let chatImagePreviewPath: string | undefined;
  let resolvedImage: Awaited<ReturnType<typeof resolveChatImageStorageRef>> | undefined;

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

  // SENT 可安全重播；PENDING/FAILED 一律 fail closed，避免 provider 回應不明時
  // 用同一把 key 再次送出。呼叫端應在確認狀態後另起一次明確的新訊息。
  const { data: existing, error: existingError } = await t.supabase
    .from('chat_messages')
    .select('*')
    .eq('tenant_id', t.tenantId)
    .eq('line_user_id', b.lineUserId)
    .eq('direction', 'OUT')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    if (existing.request_fingerprint && existing.request_fingerprint !== fingerprint) {
      throw new ApiHttpError(409, '同一 idempotency key 不可用於不同訊息', ERR.CONFLICT);
    }
    if (existing.delivery_status === 'SENT') return ok(mapMessage(existing));
    throw new ApiHttpError(
      409,
      existing.delivery_status === 'RETRY'
        ? '此訊息的送出狀態不明，請稍後查詢或由系統重試'
        : '此訊息的送出狀態仍在確認中，請勿重複送出',
      ERR.CONFLICT,
    );
  }

  const isImage = b.type === 'image';
  if (isImage) {
    const storageRef = b.storageRef as ChatImageStorageRef | undefined;
    if (!storageRef) {
      throw new ApiHttpError(400, '圖片訊息格式不完整', ERR.VALIDATION);
    }
    chatImageOriginalPath = storageRef.path;
    chatImagePreviewPath = storageRef.previewPath;
    resolvedImage = await resolveChatImageStorageRef(t.supabase, t.tenantId, storageRef);
  }

  const content = isImage
    ? {
        imageUrl: resolvedImage!.originalUrl,
        previewImageUrl: resolvedImage!.previewUrl,
        storageRef: resolvedImage!.storageRef,
      }
    : { text: b.text };

  // 先落一筆 PENDING receipt，再做任何額度／provider side effect。
  const { data: pending, error: pendingError } = await t.supabase
    .from('chat_messages')
    .insert({
      tenant_id: t.tenantId,
      line_user_id: b.lineUserId,
      direction: 'OUT',
      message_type: isImage ? 'image' : 'text',
      content,
      idempotency_key: idempotencyKey,
      request_fingerprint: fingerprint,
      delivery_status: 'PENDING',
      provider_attempt_status: 'NOT_ATTEMPTED',
      refund_status: 'NOT_REQUIRED',
      image_cleanup_status: isImage ? 'RETAINED' : 'NOT_APPLICABLE',
    })
    .select('*')
    .single();
  if (pendingError) {
    if (pendingError.code === '23505') {
      throw new ApiHttpError(409, '此訊息已在送出流程中，請勿重複送出', ERR.CONFLICT);
    }
    throw pendingError;
  }

  // 先扣額度；不足或額度服務失敗都不打 LINE（06 分冊 §2）。
  let reservation: Awaited<ReturnType<typeof reservePushQuota>>;
  try {
    reservation = await reservePushQuota(t.tenantId, 1, pending.id);
  } catch (error) {
    await markDeliveryRetry(t.supabase, pending.id, 'quota service unavailable', 'UNKNOWN');
    throw error;
  }
  if (!reservation.accepted || !reservation.token) {
    await markDeliveryFailed(
      t.supabase,
      pending.id,
      'QUOTA_EXHAUSTED',
      'NOT_ATTEMPTED',
      'NOT_REQUIRED',
    );
    const imageCleaned = await cleanupAndRecord(
      t.supabase,
      pending.id,
      chatImageOriginalPath,
      chatImagePreviewPath,
    );

    // No quota was reserved and LINE was never called. Do not leave a
    // user-visible OUT message for a rejected attempt. If image cleanup
    // failed, retain the FAILED receipt so its cleanup state is durable.
    if (!isImage || imageCleaned) {
      const { error: discardError } = await t.supabase
        .from('chat_messages')
        .delete()
        .eq('id', pending.id)
        .eq('tenant_id', t.tenantId)
        .eq('direction', 'OUT')
        .eq('delivery_status', 'FAILED');
      if (discardError) {
        console.error('[chat] failed to discard quota-rejected receipt', discardError);
        throw new ApiHttpError(503, '推播額度狀態暫時無法確認，請稍後再試', ERR.INTERNAL);
      }
    }
    throw new ApiHttpError(409, '本月推播額度已用完', ERR.CONFLICT);
  }

  const { error: reservationError } = await t.supabase
    .from('chat_messages')
    .update({
      reservation_month: reservation.month,
      reservation_token: reservation.token,
      refund_status: 'RESERVED',
    })
    .eq('id', pending.id)
    .eq('delivery_status', 'PENDING');
  if (reservationError) {
    await markDeliveryRetry(t.supabase, pending.id, 'quota reservation linkage unavailable', 'UNKNOWN');
    throw new ApiHttpError(503, '推播額度狀態暫時無法確認，請稍後再試', ERR.INTERNAL);
  }

  const { error: attemptError } = await t.supabase
    .from('chat_messages')
    .update({ provider_attempt_status: 'IN_FLIGHT' })
    .eq('id', pending.id)
    .eq('delivery_status', 'PENDING');
  if (attemptError) {
    await markDeliveryRetry(t.supabase, pending.id, 'provider attempt state unavailable', 'UNKNOWN');
    throw new ApiHttpError(503, '訊息送出狀態暫時無法確認，請稍後再試', ERR.INTERNAL);
  }

  try {
    const { token } = await getLineCredentials(t.tenantId);
    await linePush(
      token,
      b.lineUserId,
      isImage
        ? [{
            type: 'image',
            originalContentUrl: resolvedImage!.originalUrl,
            previewImageUrl: resolvedImage!.previewUrl,
          }]
        : [{ type: 'text', text: b.text }],
    );
  } catch (error) {
    if (error instanceof LineDeliveryError && error.outcome === 'CONFIRMED_REJECTION') {
      let refunded = false;
      try {
        refunded = await refundPushQuota(t.tenantId, 1, {
          month: reservation.month,
          token: reservation.token,
        });
      } catch (refundError) {
        console.error('[chat] failed to refund quota after confirmed LINE rejection', refundError);
      }
      await markDeliveryFailed(
        t.supabase,
        pending.id,
        error.message,
        'REJECTED',
        refunded ? 'REFUNDED' : 'REFUND_PENDING',
      );
      await cleanupAndRecord(t.supabase, pending.id, chatImageOriginalPath, chatImagePreviewPath);
    } else {
      // A timeout/5xx may have been accepted by LINE. Keep the receipt and
      // image durable; another key must never be used to guess the outcome.
      await markDeliveryRetry(t.supabase, pending.id, error instanceof Error ? error.message : 'unknown provider outcome', 'UNKNOWN');
    }
    throw error;
  }

  const { data, error } = await t.supabase
    .from('chat_messages')
    .update({ delivery_status: 'SENT', provider_attempt_status: 'ACCEPTED' })
    .eq('id', pending.id)
    .eq('delivery_status', 'PENDING')
    .select('*')
    .maybeSingle();
  if (error) {
    await markDeliveryRetry(t.supabase, pending.id, 'provider accepted; database status update unavailable', 'ACCEPTED', 'SETTLEMENT_PENDING');
    throw new ApiHttpError(503, '訊息已交給 LINE，但本地狀態尚未確認', ERR.INTERNAL);
  }
  if (!data) {
    await markDeliveryRetry(t.supabase, pending.id, 'provider accepted; local receipt changed unexpectedly', 'ACCEPTED', 'SETTLEMENT_PENDING');
    throw new ApiHttpError(409, '訊息已送出但狀態尚未確認，請勿重複送出', ERR.CONFLICT);
  }

  try {
    const committed = await commitPushQuota(t.tenantId, reservation.token);
    if (!committed) throw new Error('quota reservation did not commit');
    const { error: settledError } = await t.supabase
      .from('chat_messages')
      .update({ refund_status: 'COMMITTED' })
      .eq('id', pending.id)
      .eq('delivery_status', 'SENT');
    if (settledError) throw settledError;
  } catch (commitError) {
    // Delivery is already SENT; do not refund. A settlement retry can safely
    // commit this token because the RPC is idempotent.
    await markSettlementPending(t.supabase, pending.id, commitError instanceof Error ? commitError.message : 'quota settlement unavailable');
    throw commitError;
  }

  return ok(mapMessage(data));
});

async function markDeliveryFailed(
  supabase: Pick<SupabaseClient, 'from'>,
  id: string,
  reason: string,
  providerAttemptStatus: 'NOT_ATTEMPTED' | 'REJECTED',
  refundStatus: 'NOT_REQUIRED' | 'REFUNDED' | 'REFUND_PENDING',
): Promise<void> {
  const { error } = await supabase
    .from('chat_messages')
    .update({
      delivery_status: 'FAILED',
      provider_attempt_status: providerAttemptStatus,
      refund_status: refundStatus,
      delivery_error: reason,
    })
    .eq('id', id)
    .in('delivery_status', ['PENDING', 'RETRY']);
  if (error) console.error('[chat] failed to mark delivery failure', error);
}

async function markDeliveryRetry(
  supabase: Pick<SupabaseClient, 'from'>,
  id: string,
  reason: string,
  providerAttemptStatus: 'UNKNOWN' | 'ACCEPTED',
  refundStatus?: 'RESERVED' | 'SETTLEMENT_PENDING',
): Promise<void> {
  const { error } = await supabase
    .from('chat_messages')
    .update({
      delivery_status: 'RETRY',
      provider_attempt_status: providerAttemptStatus,
      ...(refundStatus ? { refund_status: refundStatus } : {}),
      delivery_error: reason,
    })
    .eq('id', id)
    .in('delivery_status', ['PENDING', 'RETRY']);
  if (error) console.error('[chat] failed to retain retryable delivery', error);
}

async function markSettlementPending(
  supabase: Pick<SupabaseClient, 'from'>,
  id: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase
    .from('chat_messages')
    .update({ refund_status: 'SETTLEMENT_PENDING', delivery_error: reason })
    .eq('id', id);
  if (error) console.error('[chat] failed to record quota settlement state', error);
}

async function cleanupAndRecord(
  supabase: Pick<SupabaseClient, 'from'>,
  id: string,
  originalPath?: string,
  previewPath?: string,
): Promise<boolean> {
  if (!originalPath) return true;
  const cleaned = await cleanupChatImage(originalPath, previewPath);
  const { error } = await supabase.from('chat_messages').update({
    image_cleanup_status: cleaned ? 'CLEANED' : 'CLEANUP_PENDING',
  }).eq('id', id);
  if (error) console.error('[chat] failed to record image cleanup state', error);
  return cleaned;
}

async function cleanupChatImage(originalPath?: string, previewPath?: string): Promise<boolean> {
  if (!originalPath) return true;
  const paths = [originalPath, previewPath].filter((path): path is string => !!path);
  const { error } = await createAdminSupabase().storage.from('chat-images').remove(paths);
  if (error) {
    console.error('[chat] failed to clean confirmed-rejection image objects', error);
    return false;
  }
  return true;
}
