import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { getLineCredentials, lineSetDefaultRichMenu } from '@/server/line';
import { type BusinessType } from '@/config/modes';
import {
  buildRestoreRichMenuInput, publishRichMenu, readDesign, writeDesign,
} from '@/server/rich-menu';

/**
 * POST /api/settings/line/rich-menu/restore-previous —— 還原上一次發布的選單
 * 規格：docs/integration/06-LINE-INTEGRATION.md §6.2.2 / §6.2.7
 *
 * **還原點只保留最近 1 份**（擁有者 2026-08-25 裁決：只支援還原到上一次發布）。
 * 「1 份」是 `rich_menu_designs` 的主鍵 `(tenant_id, kind)` 保證的，不是設定值——
 * 沒有可以被改壞的份數參數，也沒有需要跑的清理排程。
 *
 * 兩條路徑（**都要走得通，不得只做第一條**）：
 *   1. 還原點的 LINE 選單還在 → 直接 `POST /v2/bot/user/all/richmenu/{id}` 切回預設。
 *      還原到的是**位元組完全相同**的那一張，不必重新上傳底圖。
 *      發布時刻意不刪上一張，就是為了這條路徑（§6.2.2）。
 *   2. 那張被店家在 LINE OA Manager 手動刪掉了（id 失效）→ 用存下來的 `config`
 *      **重跑一次建立序列**，產生新的 richMenuId。
 *
 * **沒有還原點 → 404，訊息要說得出為什麼沒有，不得靜默成功。**
 * 第一次發布之後本來就沒有上一次可還原，那是狀態不是錯誤。
 *
 * 還原之後，還原點換成剛剛被換下來的那一份——還原是可以再還原回去的一次來回。
 * 這是「只保留 1 份」的必然結果，不是額外功能。
 */
export const POST = handle(async () => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'CUSTOM_RICH_MENU');

  const restorePoint = await readDesign(t.supabase, t.tenantId, 'RESTORE_POINT');
  if (!restorePoint)
    throw new ApiHttpError(
      404,
      '目前沒有可還原的設計：還原點是在「發布」時建立的，記錄的是被換掉的那一份。你還沒有發布過第二次，所以沒有上一次可以回去。',
      ERR.NOT_FOUND,
    );

  const current = await readDesign(t.supabase, t.tenantId, 'PUBLISHED');
  const { token, lineConfig } = await getLineCredentials(t.tenantId);

  // ── 路徑 1：還原點的 LINE 選單還在，切回預設就好
  if (restorePoint.line_rich_menu_id) {
    const reused = await lineSetDefaultRichMenu(token, restorePoint.line_rich_menu_id)
      .then(() => true)
      .catch(() => false);

    if (reused) {
      // 兩列對調：被換下來的那一份成為新的還原點
      if (current) {
        await writeDesign(
          t.supabase, t.tenantId, 'RESTORE_POINT', current.config, current.line_rich_menu_id,
        );
      }
      await writeDesign(
        t.supabase, t.tenantId, 'PUBLISHED', restorePoint.config, restorePoint.line_rich_menu_id,
      );

      const nextLine: Record<string, unknown> = {
        ...lineConfig, richMenuId: restorePoint.line_rich_menu_id,
      };
      delete nextLine.channelSecret;
      delete nextLine.channelAccessToken;
      const { error } = await t.supabase.from('tenant_settings')
        .upsert({ tenant_id: t.tenantId, line: nextLine }, { onConflict: 'tenant_id' });
      if (error) throw error;

      return ok({ richMenuId: restorePoint.line_rich_menu_id, source: 'LINE_MENU_REUSED' });
    }
  }

  // ── 路徑 2：id 失效（或從來沒有）→ 用 config 重建
  const { data: tenantRow } = await t.supabase.from('tenants')
    .select('business_type').eq('id', t.tenantId).maybeSingle();
  const businessType = (tenantRow?.business_type ?? 'LOCAL_SHOP') as BusinessType;
  const restored = buildRestoreRichMenuInput(restorePoint.config, businessType);

  const result = await publishRichMenu({
    supabase: t.supabase,
    tenantId: t.tenantId,
    token,
    payload: restored.payload,
    config: restorePoint.config,
    theme: restored.theme,
    bgImageUrl: restored.bgImageUrl,
    lineConfig,
  });

  return ok({ ...result, source: 'RECREATED' });
});
