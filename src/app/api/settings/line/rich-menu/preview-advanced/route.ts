import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { type BusinessType } from '@/config/modes';
import { richMenuDesignSchema, buildRichMenuPayload, previewImageDataUrl } from '@/server/rich-menu';

/**
 * POST /api/settings/line/rich-menu/preview-advanced —— 產生預覽 payload
 * 規格：docs/integration/06-LINE-INTEGRATION.md §6.2.5
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║ ⚠️ **本端點一行都不准碰 LINE。**                                      ║
 * ║ 不呼叫 POST /v2/bot/richmenu、不呼叫 /v2/bot/user/all/richmenu、       ║
 * ║ 不上傳任何 content。這是這一組**最容易寫成「按了預覽結果真的發出去了」**║
 * ║ 的地方：預覽與發布共用同一段組裝程式碼（buildRichMenuPayload），       ║
 * ║ 只要順手把 publishRichMenu() 叫下去，畫面上看起來一模一樣，            ║
 * ║ 而顧客的選單被換掉了。                                                ║
 * ║                                                                      ║
 * ║ 釘住這件事的斷言是 **mock LINE 的 richmenu 建立次數為 0**，            ║
 * ║ 不是「回傳值長得對」——回傳值長得對的同時照樣可以發布出去。            ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * 不擋 `CUSTOM_RICH_MENU`：唯讀、不打 LINE、不寫 DB，而且預覽正是店家用來判斷
 * 要不要訂閱的東西（§6.2.6 同一條理由）。
 *
 * `imageDataUrl` 是**純色**縮圖——沒有店名、沒有格子文字、沒有格線，因為
 * `create` 真的上傳給 LINE 的就是這樣一張圖。
 */
export const POST = handle(async (req) => {
  const t = await requireTenant();

  const design = richMenuDesignSchema.parse(await req.json().catch(() => ({})));

  const { data: tenantRow } = await t.supabase.from('tenants')
    .select('business_type').eq('id', t.tenantId).maybeSingle();
  const businessType = (tenantRow?.business_type ?? 'LOCAL_SHOP') as BusinessType;

  const payload = buildRichMenuPayload(design, businessType);

  return ok({
    size: payload.size,
    chatBarText: payload.chatBarText,
    areas: payload.areas,
    theme: design.theme,
    imageDataUrl: previewImageDataUrl(design.theme),
    /** 預覽圖是純色底圖，不含店名與格子文字——畫面必須照實說（§6.2.5） */
    imageIsFlatColor: true,
  });
});
