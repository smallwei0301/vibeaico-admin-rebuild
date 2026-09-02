import { adapt, request } from '@/lib/api';
import { byMode } from '@/mock';
import { uploadImage } from './upload';
import type { CatalogPosition } from '@/lib/catalog-order';

/** 作品集 service；頁面所有 real 寫入都走 /api/portfolios。 */
export type PortfolioItem = {
  id: string;
  title: string;
  description: string;
  coverImageUrl: string;
  extraImageCount: number;
  sortOrder: number;
  lineSortOrder: number;
  lineFeatured: boolean;
  active: boolean;
};

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

const SHOP: PortfolioItem[] = [
  { id: 'pf_1', title: '韓系空氣感層次燙', description: '微捲弧度搭配低彩度霧棕，適合細軟髮質', coverImageUrl: '', extraImageCount: 4, sortOrder: 1, lineSortOrder: 1, lineFeatured: true, active: true },
  { id: 'pf_2', title: '冷霧灰藍挑染', description: '雙色挑染，退色後仍有層次', coverImageUrl: '', extraImageCount: 6, sortOrder: 2, lineSortOrder: 2, lineFeatured: true, active: true },
  { id: 'pf_3', title: '新娘白紗造型', description: '', coverImageUrl: '', extraImageCount: 8, sortOrder: 3, lineSortOrder: 4, lineFeatured: false, active: true },
  { id: 'pf_4', title: '男士短髮修剪', description: '兩側推高、上方保留厚度', coverImageUrl: '', extraImageCount: 2, sortOrder: 4, lineSortOrder: 3, lineFeatured: true, active: false },
];
const GUIDE: PortfolioItem[] = [
  { id: 'pf_1', title: '龜山島牛奶海空拍', description: '硫磺噴氣孔染出的乳白海域，只有繞島時看得到', coverImageUrl: '', extraImageCount: 6, sortOrder: 1, lineSortOrder: 1, lineFeatured: true, active: true },
  { id: 'pf_2', title: '飛旋海豚追蹤紀錄', description: '2026 年 6 月，一次遇上三群共約 200 隻', coverImageUrl: '', extraImageCount: 12, sortOrder: 2, lineSortOrder: 2, lineFeatured: true, active: true },
  { id: 'pf_3', title: '砂婆礑溪谷天然滑水道', description: '', coverImageUrl: '', extraImageCount: 8, sortOrder: 3, lineSortOrder: 3, lineFeatured: true, active: true },
  { id: 'pf_4', title: '九份夜色與礦坑遺址', description: '避開人潮的觀景平台，華燈初上那 20 分鐘', coverImageUrl: '', extraImageCount: 5, sortOrder: 4, lineSortOrder: 4, lineFeatured: false, active: true },
  { id: 'pf_5', title: '企業包團紀錄：員工旅遊', description: '12 人包船，客製航線', coverImageUrl: '', extraImageCount: 3, sortOrder: 5, lineSortOrder: 5, lineFeatured: false, active: false },
];
const CLINIC: PortfolioItem[] = [
  { id: 'pf_1', title: '健檢中心環境', description: '獨立診間與更衣空間', coverImageUrl: '', extraImageCount: 4, sortOrder: 1, lineSortOrder: 1, lineFeatured: true, active: true },
  { id: 'pf_2', title: '醫療團隊介紹', description: '', coverImageUrl: '', extraImageCount: 3, sortOrder: 2, lineSortOrder: 2, lineFeatured: false, active: true },
];

let mockSeq = 1;

export const listPortfolios = () =>
  adapt<PortfolioItem[]>(
    () => byMode({ LOCAL_SHOP: SHOP, GUIDE, CLINIC }),
    async () => (await request<RawPortfolio[]>('/api/portfolios')).map(toItem),
  );

export type PortfolioPayload = {
  title: string;
  description?: string;
  imageUrl?: string;
  active?: boolean;
  lineFeatured?: boolean;
  sortOrder?: number;
};

export type PortfolioCreatePayload = Omit<PortfolioPayload, 'sortOrder'>;
export type PortfolioMutationResult = { id: string } & Partial<CatalogPosition>;

export const createPortfolio = (payload: PortfolioCreatePayload) =>
  adapt<PortfolioMutationResult>(
    () => ({ id: `pf_new_${mockSeq++}` }),
    () => request<PortfolioMutationResult>('/api/portfolios', { method: 'POST', body: JSON.stringify(payload) }),
  );

export const updatePortfolio = (id: string, payload: Partial<PortfolioPayload>) =>
  adapt(() => undefined, () => request<void>(`/api/portfolios/${id}`, { method: 'PUT', body: JSON.stringify(payload) }));

export const deletePortfolio = (id: string) =>
  adapt(() => undefined, () => request<void>(`/api/portfolios/${id}`, { method: 'DELETE' }));

export const togglePortfolioActive = (id: string, next: boolean) =>
  adapt<{ active: boolean }>(
    () => ({ active: next }),
    () => request<{ active: boolean }>(`/api/portfolios/${id}/toggle-active`, { method: 'POST' }),
  );

export const togglePortfolioLineFeatured = (id: string, next: boolean) =>
  adapt<{ lineFeatured: boolean }>(
    () => ({ lineFeatured: next }),
    () => request<{ lineFeatured: boolean }>(`/api/portfolios/${id}/toggle-line-featured`, { method: 'POST' }),
  );

export const reorderPortfolios = (ids: string[]) =>
  adapt(() => undefined, () => request<void>('/api/portfolios/reorder', { method: 'POST', body: JSON.stringify({ ids }) }));

export const reorderPortfoliosLine = (ids: string[]) =>
  adapt(() => undefined, () => request<void>('/api/portfolios/reorder-line', { method: 'POST', body: JSON.stringify({ ids }) }));

export const uploadPortfolioImage = (file: File) => uploadImage(file, 'portfolio-images');
