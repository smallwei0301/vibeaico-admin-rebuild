import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';
import {
  BANNER_VIDEO_BUCKET,
  BANNER_VIDEO_MAX_BYTES,
  buildBannerVideoStoragePath,
  validatePresignRequest,
} from '@/server/banner-video';

/**
 * POST /api/settings/shop-page/banner-video/presign — Issue #22 Part A。
 * body = `{contentType: 'video/mp4'|'video/webm', sizeBytes: number}`（用戶端
 * 宣稱值，只做第一道 fail-closed 檢查——真正的安全邊界在 confirm，見
 * `src/server/banner-video.ts` 檔頭）。
 *
 * 回傳 `{path, bucket, signedUrl}`：`signedUrl` 是 Supabase Storage 的一次性
 * 簽名上傳網址，用戶端直接 `fetch(signedUrl, {method:'PUT', body:file})` 把
 * 影片位元組直傳 Storage——**不經過本 Next.js server**，所以不會有 50MB 檔案
 * 塞進 JSON PATCH body 這種事。`path` 由伺服器端組出
 * （`{tenantId}/banner-video/{uuid}.{ext}`），用戶端無法指定或影響。
 */
const bodySchema = z.object({
  contentType: z.enum(['video/mp4', 'video/webm']),
  sizeBytes: z.number(),
});

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const body = bodySchema.parse(await req.json());

  const validationError = validatePresignRequest(body);
  if (validationError === 'INVALID_MIME') {
    throw new ApiHttpError(400, '僅支援 MP4 / WebM 影片', ERR.VALIDATION);
  }
  if (validationError === 'TOO_LARGE') {
    throw new ApiHttpError(400, `影片超過 ${BANNER_VIDEO_MAX_BYTES / 1024 / 1024}MB 上限`, ERR.VALIDATION);
  }

  const path = buildBannerVideoStoragePath(t.tenantId, body.contentType);
  const admin = createAdminSupabase();

  const { data, error } = await admin.storage
    .from(BANNER_VIDEO_BUCKET)
    .createSignedUploadUrl(path);
  if (error) throw error;

  const { error: pendingError } = await admin.from('banner_video_pending_uploads').insert({
    tenant_id: t.tenantId,
    storage_path: path,
  });
  if (pendingError) throw pendingError;

  return ok({
    bucket: BANNER_VIDEO_BUCKET,
    path,
    signedUrl: data.signedUrl,
    token: data.token,
  });
});
