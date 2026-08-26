import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { buildFlexMenuOutcome } from '@/server/flex-menu';

/**
 * POST /api/settings/line/rich-menu/preview-scene-flex —— 聊天室 Flex 主選單的預覽
 * 規格：docs/integration/06-LINE-INTEGRATION.md §6.2.5
 *
 * ⚠️ **零 LINE 呼叫**（理由與斷言見 preview-advanced 的檔頭方框）。
 *
 * 規格出處：`docs/specs/rich-menu-design.json:1431` 的 jsApiCalls 逐字。
 * ⚠️ 不存在 `preview-custom`——40 個 spec 檔零命中，那是 issue #19 2026-08-25
 * 之前的筆誤（§6.2.0 第 (3) 點）。
 *
 * 回的是**顧客打「選單」時真的會收到的那一包**：同一支 `buildFlexMenuOutcome()`，
 * 不是另外組一份「預覽用」的 JSON。組兩份的話預覽好看、顧客收到的是別的東西，
 * 而沒有任何測試會紅（issue #6 的單一事實來源要求）。
 *
 * 因此 `flexShowTip` 的第二則提示**也會出現在預覽裡**——店家在這裡看到幾則，
 * 顧客就會收到幾則。
 */
export const POST = handle(async () => {
  const t = await requireTenant();

  const { data: row } = await t.supabase
    .from('tenant_settings').select('line').eq('tenant_id', t.tenantId).maybeSingle();
  const lineConfig = (row?.line ?? {}) as Record<string, unknown>;

  const outcome = buildFlexMenuOutcome(lineConfig, t.tenantName);

  // SILENT 沒有 messages 欄位（它的語意就是「一則都不發」），回空陣列而不是編一則出來
  const messages = 'messages' in outcome ? outcome.messages : [];

  return ok({
    kind: outcome.kind,
    messages,
    messageCount: messages.length,
    bubbleCount: outcome.kind === 'FLEX' ? outcome.bubbleCount : 0,
  });
});
