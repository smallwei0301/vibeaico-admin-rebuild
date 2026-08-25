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
 * `linkUrl`（14 分冊 §8.20 擁有者裁決）：卡片的 optional 連結網址，**只收 https**。
 *
 * ⚠️ 這條 https-only 是**本平台的規則**。§8.20 寫的「LINE 的 uri action 只收 https」
 * 經實測是錯的（LINE 收 http），詳見 src/config/tenant-settings.ts 的 flexCardSchema
 * 說明與 scripts/verify/flex-menu-validate.cjs 的探測輸出。仍然擋，是因為擁有者
 * 裁決要求擋；但不要在任何地方把理由寫成「LINE 會退」。
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
