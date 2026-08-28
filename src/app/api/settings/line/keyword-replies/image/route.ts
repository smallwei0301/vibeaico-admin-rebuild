import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';
import {
  removeUnreferencedKeywordReplyImage,
  storageOrigin,
  validateKeywordReplyImageRef,
} from '@/server/keyword-reply-images';

const bodySchema = z.object({
  storageRef: z.object({
    bucket: z.string(), path: z.string(), url: z.string(),
    previewPath: z.string(), previewUrl: z.string(),
  }),
});

/**
 * 取消 modal 或替換尚未儲存的選檔時收掉 provisional object。只在本租戶路徑、
 * URL/Storage 位置一致且沒有任何 keyword reply 仍引用時才會刪。
 */
export const DELETE = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const { storageRef } = bodySchema.parse(await req.json());
  const ref = validateKeywordReplyImageRef(storageRef, t.tenantId, storageOrigin());
  await removeUnreferencedKeywordReplyImage(createAdminSupabase(), t.tenantId, ref);
  return ok({ deleted: true });
});
