import { adapt, request } from '@/lib/api';
import { byMode } from '@/mock';
import { uploadImage } from './upload';

/**
 * 作品集（/tenant/portfolio）service — 04 分冊 §B-5。
 *
 * 這一頁先前完全沒有 service 包裝：`/api/portfolios*` 六支端點都在，頁面卻只改
 * 瀏覽器內的 React state，於是「公開頁排序」「LINE 作品瀏覽排序」兩種排序都只是
 * 畫面上的動畫，重整就沒了（修復-7 / issue #15 第 ② 項）。本檔把頁面接到端點上。
 *
 * 兩套排序（0017 migration）：
 *   - 公開頁排序 = `sort_order`  → POST /api/portfolios/reorder
 *   - LINE 排序   = `line_sort_order` → POST /api/portfolios/reorder-line
 * 兩支各寫各的欄位，改其中一套不會覆蓋另一套。
 *
 * mock 分支（NEXT_PUBLIC_USE_MOCK=true 或示範店家）：假資料自 page.tsx 原封搬入
 * （三種業態各一組、id 序共用），寫入類函式一律 no-op，行為與先前純本地版一致。
 */

/** 作品（real 模式的欄位對應見 /api/portfolios 的 mapPortfolio） */
export type PortfolioItem = {
  id: string;
  title: string;
  description: string;
  coverImageUrl: string;
  /**
   * 其他圖片張數。`/api/portfolios` 只存一張 image_url，沒有多圖欄位，
   * 所以真實模式一律是 0（未知就顯示沒有，不編造張數）；mock 有假值。
   */
  extraImageCount: number;
  /** 公開頁排序（數字越小排越前面） */
  sortOrder: number;
  /** LINE 作品瀏覽的排序，與公開頁互不影響 */
  lineSortOrder: number;
  lineFeatured: boolean;
  active: boolean;
};

/** GET /api/portfolios 的原始回應列 */
type RawPortfolio = {
  id: string;
  title: string;
  imageUrl: string;
  description: string;
  active: boolean;
  lineFeatured: boolean;
  sortOrder: number;
  lineSortOrder: number;
  createdAt: string;
};

const toItem = (r: RawPortfolio): PortfolioItem => ({
  id: r.id,
  title: r.title,
  description: r.description,
  coverImageUrl: r.imageUrl,
  extraImageCount: 0,
  sortOrder: r.sortOrder,
  lineSortOrder: r.lineSortOrder,
  lineFeatured: r.lineFeatured,
  active: r.active,
});

/* ------------------------------------------------- mock 假資料（自頁面搬入） */

const PORTFOLIO_LOCAL_SHOP: PortfolioItem[] = [
  {
    id: 'pf_1', title: '韓系空氣感層次燙', description: '微捲弧度搭配低彩度霧棕，適合細軟髮質',
    coverImageUrl: '', extraImageCount: 4, sortOrder: 1, lineSortOrder: 1,
    lineFeatured: true, active: true,
  },
  {
    id: 'pf_2', title: '冷霧灰藍挑染', description: '雙色挑染，退色後仍有層次',
    coverImageUrl: '', extraImageCount: 6, sortOrder: 2, lineSortOrder: 2,
    lineFeatured: true, active: true,
  },
  {
    id: 'pf_3', title: '新娘白紗造型', description: '',
    coverImageUrl: '', extraImageCount: 8, sortOrder: 3, lineSortOrder: 4,
    lineFeatured: false, active: true,
  },
  {
    id: 'pf_4', title: '男士短髮修剪', description: '兩側推高、上方保留厚度',
    coverImageUrl: '', extraImageCount: 2, sortOrder: 4, lineSortOrder: 3,
    lineFeatured: true, active: false,
  },
];

const PORTFOLIO_GUIDE: PortfolioItem[] = [
  {
    id: 'pf_1', title: '龜山島牛奶海空拍', description: '硫磺噴氣孔染出的乳白海域，只有繞島時看得到',
    coverImageUrl: '', extraImageCount: 6, sortOrder: 1, lineSortOrder: 1,
    lineFeatured: true, active: true,
  },
  {
    id: 'pf_2', title: '飛旋海豚追蹤紀錄', description: '2026 年 6 月，一次遇上三群共約 200 隻',
    coverImageUrl: '', extraImageCount: 12, sortOrder: 2, lineSortOrder: 2,
    lineFeatured: true, active: true,
  },
  {
    id: 'pf_3', title: '砂婆礑溪谷天然滑水道', description: '',
    coverImageUrl: '', extraImageCount: 8, sortOrder: 3, lineSortOrder: 3,
    lineFeatured: true, active: true,
  },
  {
    id: 'pf_4', title: '九份夜色與礦坑遺址', description: '避開人潮的觀景平台，華燈初上那 20 分鐘',
    coverImageUrl: '', extraImageCount: 5, sortOrder: 4, lineSortOrder: 4,
    lineFeatured: false, active: true,
  },
  {
    id: 'pf_5', title: '企業包團紀錄：員工旅遊', description: '12 人包船，客製航線',
    coverImageUrl: '', extraImageCount: 3, sortOrder: 5, lineSortOrder: 5,
    lineFeatured: false, active: false,
  },
];

const PORTFOLIO_CLINIC: PortfolioItem[] = [
  {
    id: 'pf_1', title: '健檢中心環境', description: '獨立診間與更衣空間',
    coverImageUrl: '', extraImageCount: 4, sortOrder: 1, lineSortOrder: 1,
    lineFeatured: true, active: true,
  },
  {
    id: 'pf_2', title: '醫療團隊介紹', description: '',
    coverImageUrl: '', extraImageCount: 3, sortOrder: 2, lineSortOrder: 2,
    lineFeatured: false, active: true,
  },
];

/** mock 新增作品的流水號（沿用頁面原本的 pf_new_N 命名） */
let mockSeq = 1;

/* ----------------------------------------------------------------- 端點 */

/** GET /api/portfolios — 全量，sort_order asc */
export const listPortfolios = () =>
  adapt<PortfolioItem[]>(
    () => byMode({
      LOCAL_SHOP: PORTFOLIO_LOCAL_SHOP, GUIDE: PORTFOLIO_GUIDE, CLINIC: PORTFOLIO_CLINIC,
    }),
    async () => (await request<RawPortfolio[]>('/api/portfolios')).map(toItem),
  );

/** POST/PUT /api/portfolios 收的欄位 */
export type PortfolioPayload = {
  title: string;
  description?: string;
  imageUrl?: string;
  active?: boolean;
  /** 公開頁排序（表單的「排序」欄位）；LINE 排序只由 reorderPortfoliosLine 決定 */
  sortOrder?: number;
};

/**
 * 新增作品。`/api/portfolios` 的 imageUrl 是必填（後端 min(1)），所以頁面選了
 * 封面圖時要先 uploadImage() 換成 public URL 再帶進來。
 */
export const createPortfolio = (payload: PortfolioPayload) =>
  adapt<{ id: string }>(
    () => ({ id: `pf_new_${mockSeq++}` }),
    () => request<{ id: string }>('/api/portfolios', {
      method: 'POST', body: JSON.stringify(payload),
    }),
  );

export const updatePortfolio = (id: string, payload: Partial<PortfolioPayload>) =>
  adapt(() => undefined, () =>
    request<void>(`/api/portfolios/${id}`, {
      method: 'PUT', body: JSON.stringify(payload),
    }));

export const deletePortfolio = (id: string) =>
  adapt(() => undefined, () =>
    request<void>(`/api/portfolios/${id}`, { method: 'DELETE' }));

/** POST /api/portfolios/:id/toggle-active — 後端取反並回最新值 */
export const togglePortfolioActive = (id: string, next: boolean) =>
  adapt<{ active: boolean }>(
    () => ({ active: next }),
    () => request<{ active: boolean }>(`/api/portfolios/${id}/toggle-active`, { method: 'POST' }),
  );

/** POST /api/portfolios/:id/toggle-line-featured — 後端取反並回最新值 */
export const togglePortfolioLineFeatured = (id: string, next: boolean) =>
  adapt<{ lineFeatured: boolean }>(
    () => ({ lineFeatured: next }),
    () => request<{ lineFeatured: boolean }>(
      `/api/portfolios/${id}/toggle-line-featured`, { method: 'POST' },
    ),
  );

/** POST /api/portfolios/reorder — 依 ids 順序寫 sort_order（＝公開頁排序） */
export const reorderPortfolios = (ids: string[]) =>
  adapt(() => undefined, () =>
    request<void>('/api/portfolios/reorder', {
      method: 'POST', body: JSON.stringify({ ids }),
    }));

/** POST /api/portfolios/reorder-line — 依 ids 順序寫 line_sort_order（＝LINE 排序） */
export const reorderPortfoliosLine = (ids: string[]) =>
  adapt(() => undefined, () =>
    request<void>('/api/portfolios/reorder-line', {
      method: 'POST', body: JSON.stringify({ ids }),
    }));

/** 封面圖上傳（bucket=portfolio-images）；回 public URL */
export const uploadPortfolioImage = (file: File) => uploadImage(file, 'portfolio-images');
