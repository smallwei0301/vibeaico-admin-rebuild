import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requirePlatformAdmin } from '@/server/tenant';
import { createAdminSupabase } from '@/server/supabase';
import {
  IMPERSONATION_COOKIE,
  REASON_MAX,
  REASON_MIN,
  startImpersonation,
} from '@/server/platform-admin';
import { cookies } from 'next/headers';

/**
 * POST /api/platform/impersonation/start —— 開始代入指定店家。
 *
 * body 二選一：`{ tenantId }` 或 `{ guideId }`（tour platform 的 `guide_profiles.id`，
 * 由 `tenants.midao_guide_id` 對應）。**兩者都給或都不給一律 400**——含糊的輸入在這
 * 條路徑上不該有預設行為。
 *
 * `reason` 必填 8–200 字：沒有理由的進入紀錄，稽核時等於沒有紀錄。
 */
const bodySchema = z
  .object({
    tenantId: z.string().uuid().optional(),
    guideId: z.string().uuid().optional(),
    reason: z
      .string()
      .trim()
      .min(REASON_MIN, `請說明進入原因（至少 ${REASON_MIN} 字）`)
      .max(REASON_MAX, `原因請不要超過 ${REASON_MAX} 字`),
  })
  .refine((b) => Boolean(b.tenantId) !== Boolean(b.guideId), {
    message: '請指定 tenantId 或 guideId 其中一個',
  });

export const POST = handle(async (req) => {
  const { user } = await requirePlatformAdmin();
  const body = bodySchema.parse(await req.json());

  // service role：platform admin 不是任何租戶的成員，RLS 之下讀不到 tenants。
  const admin = createAdminSupabase();
  let query = admin.from('tenants').select('id, name, shop_code');
  query = body.tenantId
    ? query.eq('id', body.tenantId)
    : query.eq('midao_guide_id', body.guideId!);
  const { data: tenant, error } = await query.maybeSingle();
  if (error) throw error;
  if (!tenant) {
    throw new ApiHttpError(
      404,
      body.guideId ? '這位導遊尚未對應到任何店家' : '找不到該店家',
      ERR.NOT_FOUND,
    );
  }

  const session = await startImpersonation({
    adminUserId: user.id,
    tenantId: tenant.id as string,
    reason: body.reason,
  });

  (await cookies()).set(IMPERSONATION_COOKIE, session.sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: session.maxAgeSeconds,
    secure: process.env.NODE_ENV === 'production',
  });

  return ok({
    sessionId: session.sessionId,
    tenantId: tenant.id,
    tenantName: tenant.name,
    shopCode: tenant.shop_code,
    expiresAt: session.expiresAt,
  });
});
