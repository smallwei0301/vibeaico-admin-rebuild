import { ApiError, adapt, request } from '@/lib/api';
import type { Portfolio } from '@/lib/types';
import { MOCK_MODE } from '@/mock';
import type { BusinessType } from '@/config/modes';

/**
 * 作品集（/tenant/portfolio）— Issue #7 乙表第 6 項接線。
 * 後端只有單一 sortOrder（/api/portfolios/reorder 依 ids 索引寫回），
 * 沒有獨立的 LINE 排序欄位；lineFeatured 只是「是否精選」布林。
 */
export type PortfolioPayload = {
  title: string;
  imageUrl: string;
  description?: string;
  active?: boolean;
  lineFeatured?: boolean;
};

/**
 * mock 分支「假倉庫」：三種業態各自的示範資料 + 之後透過
 * createPortfolio/updatePortfolio/deletePortfolio/reorderPortfolios 的異動，
 * 讓 mock 模式下的新增/編輯/刪除/排序也像真實後端一樣可讀回、可持久。
 *
 * 延遲初始化：只在第一次被任何函式呼叫時建立（三套都建好），不在 module
 * 頂層讀 MOCK_MODE / 呼叫 byMode()，避免凍結到錯誤業態。
 */
let mockPortfolioStore: Record<BusinessType, Portfolio[]> | null = null;
let nextMockPortfolioId = 1;

function getMockPortfolioStore(): Record<BusinessType, Portfolio[]> {
  if (!mockPortfolioStore) {
    const now = '2026-08-01T00:00:00+08:00';
    mockPortfolioStore = {
      LOCAL_SHOP: [
        { id: 'pf_1', title: '韓系空氣感層次燙', description: '微捲弧度搭配低彩度霧棕，適合細軟髮質', imageUrl: '', active: true, lineFeatured: true, sortOrder: 0, lineSortOrder: 0, createdAt: now },
        { id: 'pf_2', title: '冷霧灰藍挑染', description: '雙色挑染，退色後仍有層次', imageUrl: '', active: true, lineFeatured: true, sortOrder: 1, lineSortOrder: 1, createdAt: now },
        { id: 'pf_3', title: '新娘白紗造型', description: '', imageUrl: '', active: true, lineFeatured: false, sortOrder: 2, lineSortOrder: 3, createdAt: now },
        { id: 'pf_4', title: '男士短髮修剪', description: '兩側推高、上方保留厚度', imageUrl: '', active: false, lineFeatured: true, sortOrder: 3, lineSortOrder: 2, createdAt: now },
      ],
      GUIDE: [
        { id: 'pf_1', title: '龜山島牛奶海空拍', description: '硫磺噴氣孔染出的乳白海域，只有繞島時看得到', imageUrl: '', active: true, lineFeatured: true, sortOrder: 0, lineSortOrder: 0, createdAt: now },
        { id: 'pf_2', title: '飛旋海豚追蹤紀錄', description: '2026 年 6 月，一次遇上三群共約 200 隻', imageUrl: '', active: true, lineFeatured: true, sortOrder: 1, lineSortOrder: 1, createdAt: now },
        { id: 'pf_3', title: '砂婆礑溪谷天然滑水道', description: '', imageUrl: '', active: true, lineFeatured: true, sortOrder: 2, lineSortOrder: 2, createdAt: now },
        { id: 'pf_4', title: '九份夜色與礦坑遺址', description: '避開人潮的觀景平台，華燈初上那 20 分鐘', imageUrl: '', active: true, lineFeatured: false, sortOrder: 3, lineSortOrder: 4, createdAt: now },
        { id: 'pf_5', title: '企業包團紀錄：員工旅遊', description: '12 人包船，客製航線', imageUrl: '', active: false, lineFeatured: false, sortOrder: 4, lineSortOrder: 3, createdAt: now },
      ],
      CLINIC: [
        { id: 'pf_1', title: '健檢中心環境', description: '獨立診間與更衣空間', imageUrl: '', active: true, lineFeatured: true, sortOrder: 0, lineSortOrder: 0, createdAt: now },
        { id: 'pf_2', title: '醫療團隊介紹', description: '', imageUrl: '', active: true, lineFeatured: false, sortOrder: 1, lineSortOrder: 1, createdAt: now },
      ],
    };
  }
  return mockPortfolioStore;
}

/** GET /api/portfolios — 依 sortOrder 排序，頁面唯一資料源。 */
export const listPortfolios = () =>
  adapt<Portfolio[]>(
    () => [...getMockPortfolioStore()[MOCK_MODE]].sort((a, b) => a.sortOrder - b.sortOrder),
    () => request<Portfolio[]>('/api/portfolios'),
  );

/** POST /api/portfolios — 回 { id }；後端一律把新作品排到最後（不接受呼叫端指定 sortOrder）。 */
export const createPortfolio = (payload: PortfolioPayload) =>
  adapt<{ id: string }>(
    () => {
      const store = getMockPortfolioStore()[MOCK_MODE];
      const id = `pf_new_${nextMockPortfolioId++}`;
      const maxOrder = store.reduce((m, p) => Math.max(m, p.sortOrder), -1);
      const maxLineOrder = store.reduce((m, p) => Math.max(m, p.lineSortOrder), -1);
      store.push({
        id,
        title: payload.title,
        imageUrl: payload.imageUrl,
        description: payload.description ?? '',
        active: payload.active ?? true,
        lineFeatured: payload.lineFeatured ?? false,
        sortOrder: maxOrder + 1,
        lineSortOrder: maxLineOrder + 1,
        createdAt: new Date().toISOString(),
      });
      return { id };
    },
    () => request<{ id: string }>('/api/portfolios', { method: 'POST', body: JSON.stringify(payload) }),
  );

/** PUT /api/portfolios/:id — 後端不接受 sortOrder（僅 reorder 端點能改）。 */
export const updatePortfolio = (id: string, payload: Partial<PortfolioPayload>) =>
  adapt<void>(
    () => {
      const store = getMockPortfolioStore()[MOCK_MODE];
      const item = store.find((p) => p.id === id);
      if (!item) throw new ApiError('找不到此作品', 'NOT_FOUND', 404);
      if (payload.title !== undefined) item.title = payload.title;
      if (payload.imageUrl !== undefined) item.imageUrl = payload.imageUrl;
      if (payload.description !== undefined) item.description = payload.description;
      if (payload.active !== undefined) item.active = payload.active;
      if (payload.lineFeatured !== undefined) item.lineFeatured = payload.lineFeatured;
    },
    () => request<void>(`/api/portfolios/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  );

/** DELETE /api/portfolios/:id — portfolios 無外鍵引用，直接硬刪。 */
export const deletePortfolio = (id: string) =>
  adapt<void>(
    () => {
      const store = getMockPortfolioStore()[MOCK_MODE];
      const idx = store.findIndex((p) => p.id === id);
      if (idx === -1) throw new ApiError('找不到此作品', 'NOT_FOUND', 404);
      store.splice(idx, 1);
    },
    () => request<void>(`/api/portfolios/${id}`, { method: 'DELETE' }),
  );

/** POST /api/portfolios/:id/toggle-active — 後端取反並回最新值。 */
export const togglePortfolioActive = (id: string) =>
  adapt<{ active: boolean }>(
    () => {
      const store = getMockPortfolioStore()[MOCK_MODE];
      const item = store.find((p) => p.id === id);
      if (!item) throw new ApiError('找不到此作品', 'NOT_FOUND', 404);
      item.active = !item.active;
      return { active: item.active };
    },
    () => request<{ active: boolean }>(`/api/portfolios/${id}/toggle-active`, { method: 'POST' }),
  );

/** POST /api/portfolios/:id/toggle-line-featured — 後端取反並回最新值。 */
export const togglePortfolioLineFeatured = (id: string) =>
  adapt<{ lineFeatured: boolean }>(
    () => {
      const store = getMockPortfolioStore()[MOCK_MODE];
      const item = store.find((p) => p.id === id);
      if (!item) throw new ApiError('找不到此作品', 'NOT_FOUND', 404);
      item.lineFeatured = !item.lineFeatured;
      return { lineFeatured: item.lineFeatured };
    },
    () => request<{ lineFeatured: boolean }>(`/api/portfolios/${id}/toggle-line-featured`, { method: 'POST' }),
  );

/**
 * POST /api/portfolios/reorder — `{ids:[]}` 依序寫 sortOrder=index。
 * 呼叫端必須帶完整順序（本頁 move() 一律送全部 id），不在清單內的列後端不會動。
 */
export const reorderPortfolios = (ids: string[]) =>
  adapt<void>(
    () => {
      const store = getMockPortfolioStore()[MOCK_MODE];
      ids.forEach((id, index) => {
        const item = store.find((p) => p.id === id);
        if (item) item.sortOrder = index;
      });
    },
    () => request<void>('/api/portfolios/reorder', { method: 'POST', body: JSON.stringify({ ids }) }),
  );

/**
 * POST /api/portfolios/reorder-line — `{ids:[]}` 依序寫 lineSortOrder=index
 * （0075 補上的 line_sort_order 欄位，LINE 作品瀏覽選單的獨立排序）。
 */
export const reorderPortfoliosLine = (ids: string[]) =>
  adapt<void>(
    () => {
      const store = getMockPortfolioStore()[MOCK_MODE];
      ids.forEach((id, index) => {
        const item = store.find((p) => p.id === id);
        if (item) item.lineSortOrder = index;
      });
    },
    () => request<void>('/api/portfolios/reorder-line', { method: 'POST', body: JSON.stringify({ ids }) }),
  );
