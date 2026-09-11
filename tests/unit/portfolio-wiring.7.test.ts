import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createPortfolio, deletePortfolio, listPortfolios, reorderPortfolios, reorderPortfoliosLine,
  togglePortfolioActive, togglePortfolioLineFeatured, updatePortfolio,
} from '@/services/portfolios';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const page = read('src/app/tenant/portfolio/page.tsx');
const service = read('src/services/portfolios.ts');

describe('portfolio #7: real API wiring, not page-local mock constants', () => {
  it('the page no longer ships its own PORTFOLIO_* mock arrays and never calls fetch directly', () => {
    expect(page).not.toMatch(/\bfetch\(/);
    expect(page).not.toContain('PORTFOLIO_LOCAL_SHOP');
    expect(page).not.toContain('PORTFOLIO_GUIDE');
    expect(page).not.toContain('PORTFOLIO_CLINIC');
    expect(page).not.toContain("from '@/mock'");
  });

  it('load/save/delete/toggle/move all go through src/services/portfolios.ts', () => {
    expect(page).toContain("from '@/services/portfolios'");
    for (const fn of [
      'listPortfolios', 'createPortfolio', 'updatePortfolio', 'deletePortfolio',
      'togglePortfolioActive', 'togglePortfolioLineFeatured', 'reorderPortfolios',
      'reorderPortfoliosLine',
    ]) {
      expect(page).toContain(fn);
    }
  });

  it('every service function routes through adapt(mock, real) against the documented endpoints, including reorder-line', () => {
    expect(service).toContain("request<Portfolio[]>('/api/portfolios')");
    expect(service).toContain("request<{ id: string }>('/api/portfolios', { method: 'POST'");
    expect(service).toContain("request<void>(`/api/portfolios/${id}`, { method: 'PUT'");
    expect(service).toContain("request<void>(`/api/portfolios/${id}`, { method: 'DELETE' })");
    expect(service).toContain('/toggle-active');
    expect(service).toContain('/toggle-line-featured');
    expect(service).toContain("request<void>('/api/portfolios/reorder'");
    expect(service).toContain("request<void>('/api/portfolios/reorder-line'");
    expect(service.match(/adapt</g)?.length).toBeGreaterThanOrEqual(8);
  });
});

describe('portfolio #7: failures show the real error, never a fake success toast', () => {
  it('load() shows the real message on failure', () => {
    const load = page.slice(page.indexOf('const load ='), page.indexOf('React.useEffect(() => { void load(); }'));
    expect(load).toContain('catch (e)');
    expect(load).toContain('e instanceof Error ? e.message : t.messages.loadPortfolioFailed');
  });

  it('save() shows the real message on failure', () => {
    const save = page.slice(page.indexOf('const save = async'), page.indexOf('const remove ='));
    expect(save).toContain('catch (e)');
    expect(save).toContain('e instanceof Error ? e.message : t.messages.unknownError');
  });

  it('move() calls the endpoint matching the active sort mode, and only reports success after it resolves', () => {
    const move = page.slice(page.indexOf('const move = async'), page.indexOf('const syncOrder ='));
    expect(move).toContain("if (sortMode === 'line')");
    expect(move).toContain('await reorderPortfoliosLine(ids)');
    expect(move).toContain('await reorderPortfolios(ids)');
    expect(move.indexOf('await reorderPortfoliosLine(ids)')).toBeLessThan(move.indexOf('t.sort.lineOrderUpdated'));
    expect(move).toContain('catch (e)');
    expect(move).toContain('t.messages.reorderFailed');
  });

  it('syncOrder() only shows success after the matching reorder endpoint resolves', () => {
    const sync = page.slice(page.indexOf('const syncOrder = async'), page.indexOf('/* -------------------------------------------------------------- render */'));
    expect(sync).toContain('await reorderPortfolios(ids)');
    expect(sync).toContain('await reorderPortfoliosLine(ids)');
    expect(sync.indexOf('setSyncConfirm(false)')).toBeGreaterThan(sync.indexOf('await reorderPortfolios'));
    expect(sync).toContain('catch (e)');
    expect(sync).toContain('t.messages.syncFailedPrefix');
  });
});

describe('portfolio #7: reorder actually persists sortOrder, boundaries are no-ops', () => {
  it('a newly created portfolio in mock mode shows up in the next listPortfolios() read', async () => {
    const before = await listPortfolios();
    const { id } = await createPortfolio({ title: '測試新增可讀回', imageUrl: 'cover.jpg' });
    const after = await listPortfolios();
    expect(after.length).toBe(before.length + 1);
    const created = after.find((p) => p.id === id);
    expect(created?.title).toBe('測試新增可讀回');
  });

  it('update and delete round-trip through the mock store', async () => {
    const { id } = await createPortfolio({ title: '待編輯作品', imageUrl: 'a.jpg' });
    await updatePortfolio(id, { title: '已編輯作品' });
    expect((await listPortfolios()).find((p) => p.id === id)?.title).toBe('已編輯作品');
    await deletePortfolio(id);
    expect((await listPortfolios()).some((p) => p.id === id)).toBe(false);
  });

  it('toggle-active and toggle-line-featured flip and persist', async () => {
    const { id } = await createPortfolio({ title: '待切換作品', imageUrl: 'b.jpg', active: true, lineFeatured: false });
    const t1 = await togglePortfolioActive(id);
    expect(t1.active).toBe(false);
    expect((await listPortfolios()).find((p) => p.id === id)?.active).toBe(false);

    const t2 = await togglePortfolioLineFeatured(id);
    expect(t2.lineFeatured).toBe(true);
    expect((await listPortfolios()).find((p) => p.id === id)?.lineFeatured).toBe(true);

    await deletePortfolio(id);
  });

  it('reorderPortfolios writes sortOrder = index for every id passed, and the next list reflects it', async () => {
    const before = await listPortfolios();
    const swapped = [...before].reverse().map((p) => p.id);
    await reorderPortfolios(swapped);
    const after = await listPortfolios();
    expect(after.map((p) => p.id)).toEqual(swapped);
    // restore original order so this test doesn't leak state into siblings
    await reorderPortfolios(before.map((p) => p.id));
  });

  it('reorderPortfoliosLine (0075 line_sort_order) persists independently of sortOrder', async () => {
    const before = await listPortfolios();
    // 反轉 LINE 排序，但完全不動公開頁 sortOrder，證明兩個欄位互不影響
    const reversedByLine = [...before].reverse().map((p) => p.id);
    await reorderPortfoliosLine(reversedByLine);

    const after = await listPortfolios();
    // sortOrder（公開頁順序）維持不變
    expect(after.map((p) => p.sortOrder)).toEqual(before.map((p) => p.sortOrder));
    // lineSortOrder 依新順序的索引寫回，可重讀驗證
    const byLine = [...after].sort((a, b) => a.lineSortOrder - b.lineSortOrder);
    expect(byLine.map((p) => p.id)).toEqual(reversedByLine);

    // 還原，避免污染其他測試
    await reorderPortfoliosLine(before.map((p) => p.id));
  });

  it('boundary moves (first item up, last item down) are no-ops in the page and show no success toast', () => {
    const move = page.slice(page.indexOf('const move = async'), page.indexOf('const syncOrder ='));
    expect(move).toContain('if (target < 0 || target >= ordered.length) return;');
    const upBtn = page.slice(page.indexOf('<ChevronUp') - 250, page.indexOf('<ChevronUp'));
    expect(upBtn).toContain('index === 0');
    const downBtn = page.slice(page.indexOf('<ChevronDown') - 250, page.indexOf('<ChevronDown'));
    expect(downBtn).toContain("index === ordered.length - 1");
  });
});

describe('portfolio #7: mock-mode round trip stays isolated per business mode', () => {
  it('listPortfolios seeds three independent per-mode datasets, not a shared record', () => {
    expect(service).toContain('LOCAL_SHOP:');
    expect(service).toContain('GUIDE:');
    expect(service).toContain('CLINIC:');
    // lazy-init guard: never reads MOCK_MODE at module scope
    expect(service).toMatch(/function getMockPortfolioStore\(\)[\s\S]*if \(!mockPortfolioStore\)/);
  });
});

describe('portfolio #7 follow-up: LINE 排序真的落地（0075 line_sort_order，Sol 復核後解除 escalate）', () => {
  const migration = read('supabase/migrations/0075_portfolios_line_sort_order.sql');
  const collectionRoute = read('src/app/api/portfolios/route.ts');
  const reorderLineRoute = read('src/app/api/portfolios/reorder-line/route.ts');

  it('the reconciliation migration is additive and idempotent (add column if not exists only)', () => {
    expect(migration).toContain('add column if not exists line_sort_order integer not null default 0');
    expect(migration).not.toMatch(/drop |create function|create trigger|create or replace function/i);
  });

  it('GET /api/portfolios exposes lineSortOrder and can order by it without a new RPC', () => {
    expect(collectionRoute).toContain('lineSortOrder:');
    expect(collectionRoute).toContain("orderBy === 'line' ? 'line_sort_order' : 'sort_order'");
  });

  /**
   * ⚠️ 本條的原始形狀（issue #7 / 0075）鎖的是「逐筆 update({ line_sort_order: i })
   * 且不得用 RPC」。當時的前提是 **portfolios 沒有唯一排序索引**，在那個前提下
   * 逐筆更新是安全且最簡單的。
   *
   * issue #238 實測推翻了那個前提：canonical TEST 上有
   * portfolios_tenant_sort_order_uq 與 portfolios_tenant_line_sort_order_uq，
   * 逐筆 update 的第一次迭代就撞 23505 → 500。也就是說這條鎖原本釘住的，是一個
   * 在有索引時**必然壞掉**的寫法。
   *
   * 所以這裡更新的是前提，不是放寬標準——鎖的**意圖**原封不動保留：兩支 reorder
   * route 不得各自發明實作。只是現在的「一致」是「都走同一支 RPC helper」，
   * 而不是「都自己寫同一個迴圈」。
   */
  it('POST /api/portfolios/reorder-line 與 /reorder 走同一支 helper，只差 lane（#238 後）', () => {
    const reorderRoute = read('src/app/api/portfolios/reorder/route.ts');

    for (const route of [reorderRoute, reorderLineRoute]) {
      expect(route).toContain("requireTenant('MANAGER')");
      expect(route).toContain("requireFeature(t.tenantId, 'PORTFOLIO_SHOWCASE')");
      // 兩支都必須呼叫同一支 helper，不得各自複製一份實作
      expect(route).toContain('reorderPortfolios(t.supabase, t.tenantId, b.ids');
      // 逐筆 update 是 #238 修掉的那個缺陷本身，不得復活
      expect(route).not.toMatch(/for \(let i = 0; i < b\.ids\.length; i\+\+\)/);
    }

    // lane 必須分開：公開頁改 sort_order、LINE 改 line_sort_order
    expect(reorderRoute).toContain("'public'");
    expect(reorderLineRoute).toContain("'line'");
  });
});
