import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { getLineCredentials, lineDeleteRichMenu } from '@/server/line';

/**
 * DELETE /api/settings/line/rich-menu —— 刪除目前已發布的 Rich Menu。
 *
 * 頁面上的「刪除已發布」按鈕原本只在前端本地模擬（setTimeout + toast「已刪除」），
 * 沒有真的呼叫 LINE，等於顧客的 LINE 聊天室底下選單其實還在——這正是 CLAUDE.md
 * 「不要製造假的已知」要防的那種假成功。這支端點補上真的刪除呼叫。
 *
 * 沒設定 richMenuId（從沒發布過或已經刪過）就直接回成功，冪等處理，不當錯誤。
 */
export const DELETE = handle(async () => {
  const t = await requireTenant('MANAGER');
  const { token, lineConfig } = await getLineCredentials(t.tenantId);
  const richMenuId = typeof lineConfig.richMenuId === 'string' ? lineConfig.richMenuId : '';

  if (richMenuId) {
    await lineDeleteRichMenu(token, richMenuId);
  }

  const nextLine: Record<string, unknown> = { ...lineConfig, richMenuId: '' };
  delete nextLine.channelSecret;
  delete nextLine.channelAccessToken;
  const { error } = await t.supabase
    .from('tenant_settings')
    .upsert({ tenant_id: t.tenantId, line: nextLine }, { onConflict: 'tenant_id' });
  if (error) throw error;

  return ok({ deleted: true });
});
