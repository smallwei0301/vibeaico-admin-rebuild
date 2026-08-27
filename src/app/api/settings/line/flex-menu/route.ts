import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { lineSettingsSchema } from '@/config/tenant-settings';

/**
 * POST /api/settings/line/flex-menu —— 儲存 Flex 主選單設定（06 分冊 §6）。
 * 存進 tenant_settings.line jsonb；webhook 的「選單」關鍵字回這份設定組出的
 * Flex Message（生效點：src/server/flex-menu.ts 的 buildFlexMenuOutcome()，
 * 由 src/server/line-events.ts 的 MENU 內建指令呼叫）。
 *
 * 只收 Flex 相關欄位（lineSettingsSchema 的 flex* + campaignKeywordEnabled），
 * 不碰 secret 欄位；合併語意與 PUT /api/settings/line 相同——只寫這次真的
 * 帶了的欄位，其餘保留舊值。需 MANAGER。
 *
 * `flexCards`（issue #6）：卡片陣列，`flexCardSchema` 逐張驗、上限
 * `MAX_FLEX_CARDS`（12，LINE carousel 的 bubble 上限；常數與文案、頁面共用
 * 同一個出處，見 src/config/tenant-settings.ts 的說明）。超過就整包 400，
 * 不做「默默砍掉多的」——店家編了 13 張卻只有 12 張生效而畫面說已儲存，
 * 就是一個沒人看得見的假成功。
 *
 * `linkUrl`（14 分冊 §8.20-b 擁有者裁決「廣告卡全開」）：卡片的 optional 連結網址。
 * 可用 scheme ＝ LINE 的 uri action **實測收下**的那一組，一個都沒再扣：
 * https:// / http:// / line:// / tel: / mailto:（皆回 HTTP 200）。
 * 實測退回的 sms: / javascript: / data: / ftp: / file:// 與「沒有 scheme」不收
 * （皆 400 invalid uri scheme）——收下這些等於把整份 carousel 送去被 LINE 退，
 * 顧客一張卡都收不到。
 *
 * ⚠️ 判斷是**白名單**而不是黑名單，唯一出處是 src/config/tenant-settings.ts 的
 * `isAllowedFlexLinkUrl()`（本端點 zod、webhook 讀取路徑、頁面前端三處共用）。
 * 黑名單只擋得住今天想得到的字串，明天多一個沒人想過的 scheme 就會直接送到
 * 顧客手上，而沒有任何測試會紅。實測回應碼見
 * scripts/verify/flex-menu-validate.cjs 的 scheme 探測輸出。
 *
 * ⚠️ 舊註解曾寫「只收 https」並把理由掛在 LINE 頭上——§8.20 那句是把 hero
 * **圖片** url 的 https-only 誤植過來的，已由實測推翻，不要再寫回去。
 */
const bodySchema = lineSettingsSchema.pick({
  flexMenuEnabled: true,
  flexMenuFallback: true,
  flexHeaderColor: true,
  flexHeaderTitle: true,
  flexHeaderSubtitle: true,
  flexShowTip: true,
  flexCards: true,
  campaignKeywordEnabled: true,
}).partial();

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const b = bodySchema.parse(await req.json());

  const { data: row, error: rerr } = await t.supabase
    .from('tenant_settings')
    .select('line')
    .eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (rerr) throw rerr;

  const line = { ...((row?.line ?? {}) as Record<string, unknown>) };
  for (const [k, v] of Object.entries(b)) {
    if (v !== undefined) line[k] = v;
  }
  // jsonb 內永不存 secret（與 PUT /api/settings/line 同一道防線）
  delete line.channelSecret;
  delete line.channelAccessToken;

  const { error } = await t.supabase
    .from('tenant_settings')
    .upsert({ tenant_id: t.tenantId, line }, { onConflict: 'tenant_id' });
  if (error) throw error;

  return ok();
});
