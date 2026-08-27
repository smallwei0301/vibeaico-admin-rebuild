import { adapt, request } from '@/lib/api';

/**
 * 示範資料（新店家依業態預先鋪好的範例）。
 * 端點與判定規則見 src/server/demo-seed.ts 與 /api/demo-data。
 */

export type DemoDataStatus = {
  total: number;
  counts: Record<string, number>;
};

export const getDemoDataStatus = () =>
  adapt<DemoDataStatus>(
    // 骨架模式整站本來就是假資料，沒有「示範資料」這個子集合的概念
    () => ({ total: 0, counts: {} }),
    () => request<DemoDataStatus>('/api/demo-data'),
  );

export const seedDemoData = () =>
  adapt(() => undefined, () => request<void>('/api/demo-data', { method: 'POST' }));

export const clearDemoData = () =>
  adapt(() => undefined, () => request<void>('/api/demo-data', { method: 'DELETE' }));
