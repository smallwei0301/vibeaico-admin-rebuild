import { ApiHttpError, ERR } from '@/server/http';
import type { KeywordReplyImageStorageRef } from '@/lib/types';

/**
 * 關鍵字回覆素材與 chat / rich menu 分開：三者的引用模型、生命週期與 cleanup
 * 都不同。這個 bucket 是 public，因為 LINE 必須能以 HTTPS 拉取 IMAGE message。
 */
export const KEYWORD_REPLY_IMAGES_BUCKET = 'keyword-reply-images';

export type KeywordReplyImageRef = KeywordReplyImageStorageRef;
type KeywordReplyImageRefCandidate = { bucket: string; path: string; url: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 只認新版明確 storage ref；舊的裸 imageUrl 可讀，但不能被當成可安全刪除的物件。 */
export function readKeywordReplyImageRef(content: unknown): KeywordReplyImageRef | null {
  if (!isRecord(content) || !isRecord(content.imageStorageRef)) return null;
  const ref = content.imageStorageRef;
  if (typeof ref.bucket !== 'string' || typeof ref.path !== 'string' || typeof ref.url !== 'string') return null;
  return { bucket: ref.bucket as typeof KEYWORD_REPLY_IMAGES_BUCKET, path: ref.path, url: ref.url };
}

export function isKeywordReplyImageReferenced(
  rows: readonly { content: unknown }[],
  path: string,
): boolean {
  return rows.some((row) => readKeywordReplyImageRef(row.content)?.path === path);
}

/**
 * URL、bucket 與 path 三者要同時吻合，才是「本租戶剛剛真的上傳的圖片」；只信
 * imageUrl 會讓 A 租戶可引用 B 的公開物件或一個不存在的網址。
 */
export function validateKeywordReplyImageRef(
  ref: KeywordReplyImageRefCandidate,
  tenantId: string,
  trustedOrigin: string,
): KeywordReplyImageRef {
  if (ref.bucket !== KEYWORD_REPLY_IMAGES_BUCKET)
    throw new ApiHttpError(400, '不允許的關鍵字圖片 bucket', ERR.VALIDATION);
  if (!ref.path.startsWith(`${tenantId}/`) || ref.path.slice(tenantId.length + 1).includes('/'))
    throw new ApiHttpError(400, '圖片不屬於目前租戶', ERR.VALIDATION);

  let url: URL;
  try {
    url = new URL(ref.url);
  } catch {
    throw new ApiHttpError(400, '圖片 URL 與 Storage 位置不一致', ERR.VALIDATION);
  }
  const expectedPath = `/storage/v1/object/public/${ref.bucket}/${ref.path}`;
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    throw new ApiHttpError(400, '圖片 URL 與 Storage 位置不一致', ERR.VALIDATION);
  }
  if (url.protocol !== 'https:' || url.origin !== trustedOrigin || decodedPath !== expectedPath)
    throw new ApiHttpError(400, '圖片 URL 與 Storage 位置不一致', ERR.VALIDATION);
  return ref as KeywordReplyImageRef;
}

export function storageOrigin(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin;
  } catch {
    throw new ApiHttpError(500, 'Storage 尚未設定', ERR.INTERNAL);
  }
}

/**
 * 寫入前再用 service role 查 object；upload 成功的 URL 字串本身不等於物件仍存在。
 */
export async function requireKeywordReplyImage(
  content: unknown,
  tenantId: string,
  admin: { storage: { from: (bucket: string) => { info: (path: string) => Promise<{ error: unknown }> } } },
): Promise<KeywordReplyImageRef> {
  const ref = readKeywordReplyImageRef(content);
  if (!ref) throw new ApiHttpError(400, '請先完成關鍵字圖片上傳', ERR.VALIDATION);
  validateKeywordReplyImageRef(ref, tenantId, storageOrigin());
  if (!isRecord(content) || content.imageUrl !== ref.url)
    throw new ApiHttpError(400, '圖片 URL 與 Storage 位置不一致', ERR.VALIDATION);
  const { error } = await admin.storage.from(ref.bucket).info(ref.path);
  if (error) throw new ApiHttpError(400, '找不到已上傳的關鍵字圖片，請重新上傳', ERR.VALIDATION);
  return ref;
}

/**
 * DB 已不再引用舊圖後才刪 object。若 Storage 暫時失敗，留下可重試的工作列；不把
 * 「remove 失敗」吞掉變成永久孤兒，也不在更新前先刪而讓 DB 指到空氣。
 */
export async function cleanupReplacedKeywordReplyImage(args: {
  admin: any;
  tenantId: string;
  oldContent: unknown;
  nextContent: unknown;
}): Promise<void> {
  const oldRef = readKeywordReplyImageRef(args.oldContent);
  const nextRef = readKeywordReplyImageRef(args.nextContent);
  if (!oldRef || (nextRef && oldRef.path === nextRef.path)) return;

  await removeUnreferencedKeywordReplyImage(args.admin, args.tenantId, oldRef);
}

/** 移除尚未被任何 keyword reply 引用的素材；供「取消未儲存上傳」與替換後共用。 */
export async function removeUnreferencedKeywordReplyImage(
  admin: any,
  tenantId: string,
  ref: KeywordReplyImageRef,
): Promise<void> {
  validateKeywordReplyImageRef(ref, tenantId, storageOrigin());

  const { data: rows, error: queryError } = await admin
    .from('keyword_replies')
    .select('id, content')
    .eq('tenant_id', tenantId);
  if (queryError) throw queryError;
  const stillReferenced = isKeywordReplyImageReferenced(rows ?? [], ref.path);
  if (stillReferenced) return;

  const { error: removeError } = await admin.storage.from(ref.bucket).remove([ref.path]);
  if (!removeError) return;

  const { error: queueError } = await admin
    .from('keyword_reply_image_cleanup')
    .upsert({
      tenant_id: tenantId,
      bucket: ref.bucket,
      path: ref.path,
      last_error: String((removeError as Error).message ?? removeError),
    }, { onConflict: 'bucket,path' });
  if (queueError) throw queueError;
}

/** 由受 CRON_SECRET 保護的 route 呼叫；每輪有上限，失敗留待下一輪再試。 */
export async function drainKeywordReplyImageCleanup(admin: any, limit = 100): Promise<{ removed: number; failed: number }> {
  const { data: jobs, error } = await admin
    .from('keyword_reply_image_cleanup')
    .select('tenant_id, bucket, path, attempts')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;

  let removed = 0;
  let failed = 0;
  for (const job of jobs ?? []) {
    // A failed removal may be followed by a user re-selecting the still-existing object.
    // Re-check references at retry time; otherwise the cron can delete a newly live image.
    const { data: refs, error: refsError } = await admin
      .from('keyword_replies')
      .select('content')
      .eq('tenant_id', job.tenant_id);
    if (refsError) throw refsError;
    if (isKeywordReplyImageReferenced(refs ?? [], job.path)) {
      const { error: deleteError } = await admin
        .from('keyword_reply_image_cleanup').delete().eq('bucket', job.bucket).eq('path', job.path);
      if (deleteError) throw deleteError;
      continue;
    }

    const { error: removeError } = await admin.storage.from(job.bucket).remove([job.path]);
    if (!removeError) {
      const { error: deleteError } = await admin
        .from('keyword_reply_image_cleanup').delete().eq('bucket', job.bucket).eq('path', job.path);
      if (deleteError) throw deleteError;
      removed += 1;
      continue;
    }
    const { error: updateError } = await admin
      .from('keyword_reply_image_cleanup')
      .update({
        attempts: (job.attempts ?? 0) + 1,
        last_error: String((removeError as Error).message ?? removeError),
        last_attempt_at: new Date().toISOString(),
      })
      .eq('bucket', job.bucket).eq('path', job.path);
    if (updateError) throw updateError;
    failed += 1;
  }
  return { removed, failed };
}
