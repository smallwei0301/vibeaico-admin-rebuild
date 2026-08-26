import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import {
  bookingStepGuideSchema, normalizeBookingStepGuide, buildBookingStepGuideCard,
} from '@/server/booking-step-guide';

/**
 * GET / PUT /api/settings/line/booking-step-guide —— 預約步驟引導選單
 * 規格：docs/integration/06-LINE-INTEGRATION.md §6.2.9
 *
 * ⚠️ **路徑不在 `rich-menu/` 底下。** 規格逐字是 `/api/settings/line/booking-step-guide`
 * （`docs/specs/rich-menu-design.json:1420`、`docs/specs/_endpoints.json:144`）。
 * issue #19 的範圍表用 `POST …/booking-step-guide` 表示，而該表的 `…` 展開是
 * `/api/settings/line/rich-menu`——照抄會做出一支規格上不存在的路徑（§6.2.0 第 (2) 點）。
 *
 * method 用 `PUT`（＝我方設計，規格只留下路徑沒有留下 method；
 * `rich-menu-design/page.tsx` 檔頭原本就寫 `PUT`，與 advanced-config 的寫入一致）。
 *
 * **不擋功能閘門**——14 分冊 §8.21 已裁決 Flex 主選單不收費，步驟引導屬同一區。
 *
 * ⚠️ 這一支存得到、但顧客收不到（本專案沒有預約 carousel）。完整說明與理由在
 * `src/server/booking-step-guide.ts` 的檔頭方框，畫面上也必須明講。
 */
export const GET = handle(async () => {
  const t = await requireTenant();

  const { data: row } = await t.supabase
    .from('tenant_settings').select('line').eq('tenant_id', t.tenantId).maybeSingle();
  const lineConfig = (row?.line ?? {}) as Record<string, unknown>;
  const guide = normalizeBookingStepGuide(lineConfig.bookingStepGuide);

  return ok({
    ...guide,
    card: buildBookingStepGuideCard(guide),
    /** ⚠️ 誠實旗標：卡片組得出來，但目前沒有任何地方會把它送給顧客（§6.2.9） */
    deliveredToCustomers: false,
  });
});

export const PUT = handle(async (req) => {
  const t = await requireTenant('MANAGER');

  const body = bookingStepGuideSchema.parse(await req.json().catch(() => ({})));
  const guide = normalizeBookingStepGuide(body);

  const { data: row } = await t.supabase
    .from('tenant_settings').select('line').eq('tenant_id', t.tenantId).maybeSingle();
  const lineConfig = (row?.line ?? {}) as Record<string, unknown>;
  const nextLine: Record<string, unknown> = { ...lineConfig, bookingStepGuide: guide };
  delete nextLine.channelSecret;
  delete nextLine.channelAccessToken;

  const { error } = await t.supabase
    .from('tenant_settings')
    .upsert({ tenant_id: t.tenantId, line: nextLine }, { onConflict: 'tenant_id' });
  if (error) throw error;

  return ok({
    ...guide,
    card: buildBookingStepGuideCard(guide),
    deliveredToCustomers: false,
  });
});
