import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { richMenuDesignSchema, readDesign, writeDesign } from '@/server/rich-menu';

/**
 * GET / PUT /api/settings/line/rich-menu/advanced-config —— 進階設計器的草稿
 * 規格：docs/integration/06-LINE-INTEGRATION.md §6.2.6
 *
 * ⚠️ **草稿不是發布。** `DRAFT` 存在不代表 LINE 端有任何東西，頁面顯示草稿狀態時
 * 不得寫成「已套用」「已上線」（鐵則 12）。這一支的存在是為了讓「儲存草稿」那顆
 * 按鈕從假成功變成真的——在此之前它按下去只 toast 一句話，關掉分頁設定就消失。
 *
 * **往返一致**是這一支唯一有意義的驗收：`PUT` 存什麼，`GET` 就要拿回什麼
 * （含 cells 的順序與空字串欄位）。存進去被 normalize 掉一半，店家重整就發現
 * 設定變了，而那種「有存到，只是不完全」比完全沒存更難發現。
 *
 * 閘門：`GET` **不擋**（唯讀、不打 LINE、不寫 DB）；`PUT` 擋 `CUSTOM_RICH_MENU`。
 */
export const GET = handle(async () => {
  const t = await requireTenant();

  const [draft, published, restorePoint] = await Promise.all([
    readDesign(t.supabase, t.tenantId, 'DRAFT'),
    readDesign(t.supabase, t.tenantId, 'PUBLISHED'),
    readDesign(t.supabase, t.tenantId, 'RESTORE_POINT'),
  ]);

  return ok({
    draft: draft ? { ...draft.config, updatedAt: draft.updated_at } : null,
    published: published
      ? { config: published.config, richMenuId: published.line_rich_menu_id, updatedAt: published.updated_at }
      : null,
    /**
     * 還原點只回 `updatedAt`，**不回 config**：畫面只需要知道「有沒有可還原的」
     * 與「是什麼時候的」。回整份設計沒有任何畫面在用，只是多一份可以分岔的資料。
     */
    restorePoint: restorePoint ? { updatedAt: restorePoint.updated_at } : null,
  });
});

export const PUT = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'CUSTOM_RICH_MENU');

  const design = richMenuDesignSchema.parse(await req.json().catch(() => ({})));
  // 草稿沒有 LINE 選單 id（它從未發布），空字串＝「這一份沒有對應的 LINE 選單」
  const updatedAt = await writeDesign(t.supabase, t.tenantId, 'DRAFT', design, '');

  return ok({ updatedAt });
});
