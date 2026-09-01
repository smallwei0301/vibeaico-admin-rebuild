import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiHttpError, ERR } from '@/server/http';
import { createAdminSupabase } from '@/server/supabase';
import {
  KEYWORD_REPLY_IMAGES_BUCKET,
  type KeywordReplyImageStorageRef,
} from '@/lib/keyword-reply-image';

export { KEYWORD_REPLY_IMAGES_BUCKET } from '@/lib/keyword-reply-image';
export type { KeywordReplyImageStorageRef } from '@/lib/keyword-reply-image';

export const KEYWORD_REPLY_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const LINE_PREVIEW_MAX_BYTES = 1_000_000;

const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
} as const;

type ImageContentType = keyof typeof IMAGE_TYPES;
type KeywordReplyImageRefCandidate = {
  bucket: string;
  path: string;
  url: string;
  previewPath?: string;
  previewUrl?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `{tenantId}/{uuid}.jpg` -> `{tenantId}/{uuid}.preview.jpg`. */
export function previewPathFor(path: string): string {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  if (dot <= slash) return `${path}.preview`;
  return `${path.slice(0, dot)}.preview${path.slice(dot)}`;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isKeywordReplyImagePath(path: string, tenantId: string): boolean {
  if (!path.startsWith(`${tenantId}/`)) return false;
  const filename = path.slice(tenantId.length + 1);
  const match = /^([0-9a-f-]{36})\.(jpg|png)$/i.exec(filename);
  return !!match && isUuid(match[1]);
}

function publicObjectPath(bucket: string, path: string): string {
  return `/storage/v1/object/public/${bucket}/${path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}

function publicUrl(admin: SupabaseClient, bucket: string, path: string): string {
  return admin.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/** Only the explicit, complete storage ref is eligible for ownership actions. */
export function readKeywordReplyImageRef(content: unknown): KeywordReplyImageStorageRef | null {
  if (!isRecord(content) || !isRecord(content.imageStorageRef)) return null;
  const ref = content.imageStorageRef;
  if (
    typeof ref.bucket !== 'string'
    || typeof ref.path !== 'string'
    || typeof ref.url !== 'string'
    || typeof ref.previewPath !== 'string'
    || typeof ref.previewUrl !== 'string'
  ) return null;

  return {
    bucket: ref.bucket as typeof KEYWORD_REPLY_IMAGES_BUCKET,
    path: ref.path,
    url: ref.url,
    previewPath: ref.previewPath,
    previewUrl: ref.previewUrl,
  };
}

/** A ref or non-empty image URL cannot be silently stranded on a non-IMAGE row. */
export function assertKeywordReplyImagePayload(replyType: string, content: unknown): void {
  if (replyType === 'IMAGE') return;
  if (!isRecord(content)) return;
  if (
    readKeywordReplyImageRef(content)
    || (typeof content.imageUrl === 'string' && content.imageUrl.length > 0)
    || (typeof content.previewImageUrl === 'string' && content.previewImageUrl.length > 0)
  ) throw new ApiHttpError(400, '圖片內容只能搭配 IMAGE 回覆類型', ERR.VALIDATION);
}

/** Validate bucket, tenant path, derived preview path and trusted public URLs. */
export function validateKeywordReplyImageRef(
  ref: KeywordReplyImageRefCandidate,
  tenantId: string,
  trustedOrigin: string,
): KeywordReplyImageStorageRef {
  if (ref.bucket !== KEYWORD_REPLY_IMAGES_BUCKET)
    throw new ApiHttpError(400, '不允許的關鍵字圖片 bucket', ERR.VALIDATION);
  if (!isKeywordReplyImagePath(ref.path, tenantId))
    throw new ApiHttpError(400, '圖片不屬於目前租戶或路徑格式不正確', ERR.VALIDATION);

  let origin: string;
  try {
    origin = new URL(trustedOrigin).origin;
  } catch {
    throw new ApiHttpError(500, 'Storage 尚未設定', ERR.INTERNAL);
  }

  const validatePublicUrl = (value: string, expectedPath: string, message: string) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new ApiHttpError(400, message, ERR.VALIDATION);
    }
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(url.pathname);
    } catch {
      throw new ApiHttpError(400, message, ERR.VALIDATION);
    }
    if (
      url.protocol !== 'https:'
      || url.origin !== origin
      || url.search
      || url.hash
      || decodedPath !== expectedPath
    ) throw new ApiHttpError(400, message, ERR.VALIDATION);
  };

  validatePublicUrl(
    ref.url,
    publicObjectPath(ref.bucket, ref.path),
    '圖片 URL 與 Storage 位置不一致',
  );

  const expectedPreviewPath = previewPathFor(ref.path);
  if (ref.previewPath !== expectedPreviewPath || typeof ref.previewUrl !== 'string')
    throw new ApiHttpError(400, '圖片縮圖與 Storage 位置不一致', ERR.VALIDATION);
  validatePublicUrl(
    ref.previewUrl,
    publicObjectPath(ref.bucket, expectedPreviewPath),
    '圖片縮圖與 Storage 位置不一致',
  );

  return ref as KeywordReplyImageStorageRef;
}

export function storageOrigin(): string {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
    if (url.protocol !== 'https:') throw new Error('Storage origin must be HTTPS');
    return url.origin;
  } catch {
    throw new ApiHttpError(500, 'Storage 尚未設定 HTTPS 網址', ERR.INTERNAL);
  }
}

export function isKeywordReplyImageReferenced(
  rows: readonly { content: unknown }[],
  path: string,
): boolean {
  return rows.some((row) => {
    const ref = readKeywordReplyImageRef(row.content);
    return ref?.path === path || ref?.previewPath === path;
  });
}

/** Reject MIME spoofing before sharp or Storage sees the bytes. */
export function validateKeywordReplyImageBytes(
  bytes: Uint8Array,
  contentType: string,
): asserts contentType is ImageContentType {
  const extension = IMAGE_TYPES[contentType as ImageContentType];
  const startsWith = (signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  const valid = extension === 'jpg'
    ? startsWith([0xff, 0xd8, 0xff])
    : extension === 'png'
      ? startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      : false;
  if (!extension || !valid)
    throw new ApiHttpError(400, '圖片內容與宣告格式不一致，僅支援 JPEG / PNG', ERR.VALIDATION);
}

const PREVIEW_STEPS = [
  { width: 1024, jpegQuality: 82, png: { palette: false } },
  { width: 1024, jpegQuality: 65, png: { palette: true, colours: 256 } },
  { width: 640, jpegQuality: 65, png: { palette: true, colours: 128 } },
  { width: 320, jpegQuality: 60, png: { palette: true, colours: 128 } },
] as const;

/** Produce a same-format LINE preview, never silently falling back to the original. */
export async function makeKeywordReplyPreview(
  input: Buffer,
  contentType: ImageContentType,
): Promise<Buffer> {
  const wantPng = contentType === 'image/png';
  const source = sharp(input, { failOn: 'none' }).rotate();
  let metadata;
  try {
    metadata = await source.metadata();
  } catch {
    throw new ApiHttpError(400, '這個檔案無法解碼成圖片，請換一張再試', ERR.VALIDATION);
  }
  if (metadata.format !== (wantPng ? 'png' : 'jpeg'))
    throw new ApiHttpError(400, '圖片實際格式與宣告不一致，請重新轉檔後再上傳', ERR.VALIDATION);

  for (const step of PREVIEW_STEPS) {
    try {
      const output = wantPng
        ? await source.clone()
          .resize({ width: step.width, height: step.width, fit: 'inside', withoutEnlargement: true })
          .png({ compressionLevel: 9, effort: 1, ...step.png })
          .toBuffer()
        : await source.clone()
          .resize({ width: step.width, height: step.width, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: step.jpegQuality })
          .toBuffer();
      if (output.byteLength <= LINE_PREVIEW_MAX_BYTES) return output;
    } catch {
      throw new ApiHttpError(400, '這張圖片無法產生 LINE 預覽縮圖，請換一張再試', ERR.VALIDATION);
    }
  }

  throw new ApiHttpError(400, '這張圖片無法壓到 LINE 預覽圖的 1 MB 上限，請換一張再試', ERR.VALIDATION);
}

export type KeywordReplyImageUploadResult = {
  url: string;
  path: string;
  bucket: typeof KEYWORD_REPLY_IMAGES_BUCKET;
  previewPath: string;
  previewUrl: string;
  storageRef: KeywordReplyImageStorageRef;
};

/** Upload original + preview to the dedicated keyword-reply bucket. */
export async function uploadKeywordReplyImage(args: {
  tenantId: string;
  file: File;
  admin?: SupabaseClient;
}): Promise<KeywordReplyImageUploadResult> {
  const { tenantId, file, admin = createAdminSupabase() } = args;
  const extension = IMAGE_TYPES[file.type as ImageContentType];
  if (!extension)
    throw new ApiHttpError(400, '僅支援 JPEG / PNG 圖片', ERR.VALIDATION);
  if (file.size > KEYWORD_REPLY_IMAGE_MAX_BYTES)
    throw new ApiHttpError(400, '圖片超過 5MB 上限，請壓縮後再上傳', ERR.VALIDATION);

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength > KEYWORD_REPLY_IMAGE_MAX_BYTES)
    throw new ApiHttpError(400, '圖片超過 5MB 上限，請壓縮後再上傳', ERR.VALIDATION);
  validateKeywordReplyImageBytes(bytes, file.type);
  const previewBytes = await makeKeywordReplyPreview(bytes, file.type);

  const path = `${tenantId}/${randomUUID()}.${extension}`;
  const previewPath = previewPathFor(path);
  let originalUploaded = false;
  try {
    const original = await admin.storage.from(KEYWORD_REPLY_IMAGES_BUCKET).upload(path, bytes, {
      contentType: file.type,
      upsert: false,
    });
    if (original.error) throw original.error;
    originalUploaded = true;

    const preview = await admin.storage.from(KEYWORD_REPLY_IMAGES_BUCKET).upload(previewPath, previewBytes, {
      contentType: file.type,
      upsert: false,
    });
    if (preview.error) throw preview.error;
  } catch (error) {
    if (originalUploaded) {
      const cleanup = await admin.storage
        .from(KEYWORD_REPLY_IMAGES_BUCKET)
        .remove([path, previewPath]);
      if (cleanup.error) console.error('[keyword-reply-images] provisional cleanup failed', cleanup.error);
    }
    throw error;
  }

  const url = publicUrl(admin, KEYWORD_REPLY_IMAGES_BUCKET, path);
  const previewUrl = publicUrl(admin, KEYWORD_REPLY_IMAGES_BUCKET, previewPath);
  const storageRef = {
    bucket: KEYWORD_REPLY_IMAGES_BUCKET,
    path,
    url,
    previewPath,
    previewUrl,
  } satisfies KeywordReplyImageStorageRef;
  return { url, path, bucket: KEYWORD_REPLY_IMAGES_BUCKET, previewPath, previewUrl, storageRef };
}

type StorageInfoAdmin = {
  storage: {
    from: (bucket: string) => {
      info: (path: string) => Promise<{ error: unknown }>;
    };
  };
};

/** Re-check both objects before accepting a ref for DB persistence or GET. */
export async function requireKeywordReplyImage(
  content: unknown,
  tenantId: string,
  admin: StorageInfoAdmin,
): Promise<KeywordReplyImageStorageRef> {
  const ref = readKeywordReplyImageRef(content);
  if (!ref) throw new ApiHttpError(400, '請先完成關鍵字圖片上傳', ERR.VALIDATION);
  validateKeywordReplyImageRef(ref, tenantId, storageOrigin());
  if (
    !isRecord(content)
    || content.imageUrl !== ref.url
    || content.previewImageUrl !== ref.previewUrl
  ) throw new ApiHttpError(400, '圖片 URL 與 Storage 位置不一致', ERR.VALIDATION);

  const [{ error }, { error: previewError }] = await Promise.all([
    admin.storage.from(ref.bucket).info(ref.path),
    admin.storage.from(ref.bucket).info(ref.previewPath),
  ]);
  if (error || previewError)
    throw new ApiHttpError(400, '找不到已上傳的關鍵字圖片或縮圖，請重新上傳', ERR.VALIDATION);
  return ref;
}

export async function cleanupReplacedKeywordReplyImage(args: {
  admin?: SupabaseClient;
  tenantId: string;
  oldContent: unknown;
  nextContent: unknown;
}): Promise<void> {
  const oldRef = readKeywordReplyImageRef(args.oldContent);
  const nextRef = readKeywordReplyImageRef(args.nextContent);
  if (!oldRef || (nextRef && oldRef.path === nextRef.path)) return;
  await removeUnreferencedKeywordReplyImage(
    args.admin ?? createAdminSupabase(),
    args.tenantId,
    oldRef,
  );
}

/** Delete only after the DB no longer references either object. */
export async function removeUnreferencedKeywordReplyImage(
  admin: SupabaseClient,
  tenantId: string,
  ref: KeywordReplyImageStorageRef,
): Promise<void> {
  validateKeywordReplyImageRef(ref, tenantId, storageOrigin());
  const { data: rows, error: queryError } = await admin
    .from('keyword_replies')
    .select('content')
    .eq('tenant_id', tenantId);
  if (queryError) throw queryError;
  if (isKeywordReplyImageReferenced(rows ?? [], ref.path)) return;

  const paths = [ref.path, ref.previewPath];
  const { error: removeError } = await admin.storage.from(ref.bucket).remove(paths);
  if (!removeError) return;

  const { error: queueError } = await admin.from('keyword_reply_image_cleanup').upsert(
    paths.map((path) => ({
      tenant_id: tenantId,
      bucket: ref.bucket,
      path,
      last_error: String((removeError as Error).message ?? removeError),
    })),
    { onConflict: 'bucket,path' },
  );
  if (queueError) throw queueError;
}

/** Cron worker: re-check references before each retry so a reused object survives. */
export async function drainKeywordReplyImageCleanup(
  admin: SupabaseClient,
  limit = 100,
): Promise<{ removed: number; failed: number }> {
  const { data: jobs, error } = await admin
    .from('keyword_reply_image_cleanup')
    .select('tenant_id, bucket, path, attempts')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;

  let removed = 0;
  let failed = 0;
  for (const job of jobs ?? []) {
    const { data: refs, error: refsError } = await admin
      .from('keyword_replies')
      .select('content')
      .eq('tenant_id', job.tenant_id);
    if (refsError) throw refsError;
    if (isKeywordReplyImageReferenced(refs ?? [], job.path)) {
      const { error: deleteError } = await admin
        .from('keyword_reply_image_cleanup')
        .delete()
        .eq('bucket', job.bucket)
        .eq('path', job.path);
      if (deleteError) throw deleteError;
      continue;
    }

    const { error: removeError } = await admin.storage.from(job.bucket).remove([job.path]);
    if (!removeError) {
      const { error: deleteError } = await admin
        .from('keyword_reply_image_cleanup')
        .delete()
        .eq('bucket', job.bucket)
        .eq('path', job.path);
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
      .eq('bucket', job.bucket)
      .eq('path', job.path);
    if (updateError) throw updateError;
    failed += 1;
  }
  return { removed, failed };
}
