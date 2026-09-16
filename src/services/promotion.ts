/**
 * src/services/promotion.ts — 推廣成效統計（Issue #23）
 * -----------------------------------------------------------------------------
 * 唯一資料入口：`/tenant/promote` 只透過 `getPromotionStats()` 拿資料
 * （鐵則「頁面永不 fetch」），mock／真實兩條路都回 `PromotionStats`
 * （`src/lib/types.ts`），`approximate` 依 Owner Decision 2026-09-14 永遠是
 * `true`。此頁不分 businessType（三種 mode 的推廣成效資料形狀相同），
 * mock 資料因此不用 `byMode()`。
 */
import { adapt, request } from '@/lib/api';
import type { PromotionStats } from '@/lib/types';

export type PromotionRange = '7' | '30' | '90';

function mockDayStats(days: number, baseDaily: number): { day: string; pv: number; uv: number }[] {
  const out: { day: string; pv: number; uv: number }[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    const day = d.toISOString().slice(0, 10);
    // 骨架模式的假資料只是讓卡片看起來有內容，不追求真實分布；用固定種子讓
    // 每次重整結果一致，避免圖表在 demo 時忽大忽小顯得像壞掉。
    const wobble = ((i * 37) % 11) - 5;
    const pv = Math.max(0, baseDaily + wobble);
    const uv = Math.max(0, Math.round(pv * 0.72));
    out.push({ day, pv, uv });
  }
  return out;
}

function sumBySource(bySource: { source: string; pv: number; uv: number }[]) {
  return {
    pv: bySource.reduce((s, r) => s + r.pv, 0),
    uv: bySource.reduce((s, r) => s + r.uv, 0),
  };
}

function buildMockStats(days: number, hasData: boolean): PromotionStats {
  if (!hasData) {
    return { pv: 0, uv: 0, bySource: [], byDay: [], approximate: true, hasData: false };
  }
  const scale = days / 7;
  const bySource = [
    { source: 'DIRECT', pv: Math.round(88 * scale), uv: Math.round(70 * scale) },
    { source: 'LINE', pv: Math.round(52 * scale), uv: Math.round(44 * scale) },
    { source: 'QR', pv: Math.round(21 * scale), uv: Math.round(17 * scale) },
  ];
  const { pv, uv } = sumBySource(bySource);
  return {
    pv,
    uv,
    bySource,
    byDay: mockDayStats(days, Math.round(pv / days)),
    approximate: true,
    hasData: true,
  };
}

const MOCK_PROMOTION_STATS: Record<PromotionRange, PromotionStats> = {
  '7': buildMockStats(7, true),
  '30': buildMockStats(30, true),
  // 90 天沿用原骨架的「這個區間本來就沒資料」情境，順便讓 demo 涵蓋
  // hasData:false 的 EmptyState 分支。
  '90': buildMockStats(90, false),
};

export const getPromotionStats = (range: PromotionRange) =>
  adapt<PromotionStats>(
    () => MOCK_PROMOTION_STATS[range],
    () => request<PromotionStats>('/api/promotion/stats', { query: { range } }),
  );
