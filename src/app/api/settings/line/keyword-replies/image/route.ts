import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { createAdminSupabase } from '@/server/supabase';
import {
  removeUnreferencedKeywordReplyImage,
  storageOrigin,
  uploadKeywordReplyImage,
  validateKeywordReplyImageRef,
} from '@/server/keyword-reply-images';

const bodySchema = z.object({
  storageRef: z.object({
    bucket: z.string(),
    path: z.string(),
    url: z.string(),
    previewPath: z.string(),
    previewUrl: z.string(),
  }),
});

/**
 * POST: keyword-reply-specific upload seam. The generic `/api/upload` remains
 * owned by the chat/catalog image lane; this route is the only uploader for
 * the keyword-reply bucket and returns a complete original/preview ref.
 */
export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'KEYWORD_REPLY');
  const form = await req.formData().catch(() => {
    throw new ApiHttpError(400, '請以 multipart/form-data 上傳圖片', ERR.VALIDATION);
  });
  const file = form.get('file');
  if (!(file instanceof File))
    throw new ApiHttpError(400, '缺少圖片檔案（欄位名 file）', ERR.VALIDATION);

  return ok(await uploadKeywordReplyImage({ tenantId: t.tenantId, file }));
});

/**
 * DELETE: cancel an unsaved selection. A referenced object is deliberately
 * retained; replacement/delete cleanup runs after the DB unlink instead.
 */
export const DELETE = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const { storageRef } = bodySchema.parse(await req.json());
  const ref = validateKeywordReplyImageRef(storageRef, t.tenantId, storageOrigin());
  await removeUnreferencedKeywordReplyImage(createAdminSupabase(), t.tenantId, ref);
  return ok({ deleted: true });
});
