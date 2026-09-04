import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createPortfolio, deletePortfolio, listPortfolios, reorderPortfolios,
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
    ]) {
      expect(page).toContain(fn);
    }
  });

  it('every service function routes through adapt(mock, real) against the documented endpoints', () => {
    expect(service).toContain("request<Portfolio[]>('/api/portfolios')");
    expect(service).toContain("request<{ id: string }>('/api/portfolios', { method: 'POST'");
    expect(service).toContain("request<void>(`/api/portfolios/${id}`, { method: 'PUT'");
    expect(service).toContain("request<void>(`/api/portfolios/${id}`, { method: 'DELETE' })");
    expect(service).toContain('/toggle-active');
    expect(service).toContain('/toggle-line-featured');
    expect(service).toContain("request<void>('/api/portfolios/reorder'");
    expect(service.match(/adapt</g)?.length).toBeGreaterThanOrEqual(7);
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

  it('move() refuses to fake success in LINE mode (no independent backend field yet)', () => {
    const move = page.slice(page.indexOf('const move = async'), page.indexOf('/* -------------------------------------------------------------- render */'));
    expect(move).toContain("if (sortMode === 'line')");
    expect(move).toContain('t.sort.lineOrderUnavailable');
    expect(move).not.toContain('t.sort.lineOrderUpdated');
  });

  it('the sync-order button is disabled, not wired to a fake success path', () => {
    expect(page).not.toContain('syncOrder');
    expect(page).not.toContain('setSyncConfirm');
    const syncBtn = page.slice(page.indexOf('<ArrowLeftRight') - 200, page.indexOf('<ArrowLeftRight'));
    expect(syncBtn).toContain('disabled');
    expect(syncBtn).toContain('t.sort.syncUnavailable');
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

  it('boundary moves (first item up, last item down) are no-ops in the page and show no success toast', () => {
    const move = page.slice(page.indexOf('const move = async'), page.indexOf('/* -------------------------------------------------------------- render */'));
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
