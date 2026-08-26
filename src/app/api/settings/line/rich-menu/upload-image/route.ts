import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { readUploadFile, uploadToBucket } from '@/server/upload';

/**
 * POST /api/settings/line/rich-menu/upload-image —— 選單底圖上傳＋落地
 * 規格：docs/integration/06-LINE-INTEGRATION.md §6.2.8
 * 原站路徑出處：`docs/specs/line-settings.json:1602`、`docs/specs/_endpoints.json:167`
 *
 * ⚠️ **這不是 `/api/upload` 的第二份實作。** 驗證與落地全部走
 * `src/server/upload.ts` 的 `uploadToBucket()`，`/api/upload` 呼叫的是同一支。
 * 06 分冊 §6.1 刪掉 `upload-bg-image` 的理由是「同一件事兩份實作，短期看起來
 * 一樣、長期一定分岔」——共用函式之後就沒有第二份可以分岔（§6.2.8）。
 * 1 MB 的 `richmenu-assets` 上限與 MIME 解碼比對都自動吃到，**不得**在本檔再寫一次。
 *
 * 它比 `/api/upload` 多做的那一件事（＝它存在的理由）：
 * **上傳完順手寫進 `tenant_settings.line.richMenuBgImageUrl`**。
 * 發布端點 `loadRichMenuBackground()` 讀的是那個欄位，不是這次請求的 body——
 * 少了這一步，「上傳成功」就只是半個事實：圖進了 bucket，發布出去的還是主題底圖。
 */
export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');

  const file = await readUploadFile(req);
  const uploaded = await uploadToBucket({
    tenantId: t.tenantId, file, bucket: 'richmenu-assets',
  });

  // 落地：沒有這一步就是半個事實（見檔頭）
  const { data: row } = await t.supabase
    .from('tenant_settings').select('line').eq('tenant_id', t.tenantId).maybeSingle();
  const lineConfig = (row?.line ?? {}) as Record<string, unknown>;
  const nextLine: Record<string, unknown> = { ...lineConfig, richMenuBgImageUrl: uploaded.url };
  delete nextLine.channelSecret;
  delete nextLine.channelAccessToken;

  const { error } = await t.supabase
    .from('tenant_settings')
    .upsert({ tenant_id: t.tenantId, line: nextLine }, { onConflict: 'tenant_id' });
  if (error) throw error;

  return ok({ ...uploaded, savedTo: 'line.richMenuBgImageUrl' });
});

/** 明確拒絕其他 method，免得誤打回 405 以外的東西 */
export const GET = handle(async () => {
  throw new ApiHttpError(405, '本端點只接受 POST', ERR.VALIDATION);
});
