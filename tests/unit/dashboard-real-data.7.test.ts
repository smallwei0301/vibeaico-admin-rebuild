// Issue #7 — /tenant/dashboard 三塊假資料改真：週趨勢／本月來源／最近活動。
// 反向斷言鎖住不會退回頁面內建的假資料（setTimeout 假成功、page-local MOCK_*
// 常數），並確認 real 分支打向文件約定的端點、mock 分支在三種業態下都有資料。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyMockMode } from '@/mock';
import { getMonthSources, getRecentActivity, getWeeklyTrend } from '@/services/reports';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const page = read('src/app/tenant/dashboard/page.tsx');
const service = read('src/services/reports.ts');

describe('dashboard #7: real API wiring, not page-local fake data', () => {
  it('no longer fakes recent-activity with a bare timeout', () => {
    expect(page).not.toContain('setTimeout(r, 320)');
    expect(page).not.toMatch(/setTimeout\(r,\s*\d+\)/);
  });

  it('the page no longer defines the page-local mock arrays (moved into src/services/reports.ts)', () => {
    expect(page).not.toContain('ACTIVITY_LOCAL_SHOP');
    expect(page).not.toContain('TREND_LOCAL_SHOP');
    expect(page).not.toContain('SOURCES_LOCAL_SHOP');
  });

  it('the page loads all three blocks through src/services/reports.ts, never fetch directly', () => {
    expect(page).not.toMatch(/\bfetch\(/);
    expect(page).toContain("from '@/services/reports'");
    for (const fn of ['getWeeklyTrend', 'getMonthSources', 'getRecentActivity']) {
      expect(page).toContain(fn);
    }
  });

  it('every new service function routes through adapt(mock, real) against the documented endpoints', () => {
    expect(service).toContain("request<{ label: string; bookings: number; revenue: number }[]>(\n        '/api/reports/daily'");
    expect(service).toContain("request<MonthSourcePoint[]>('/api/reports/booking-sources')");
    expect(service).toContain("request<RecentActivity[]>('/api/reports/dashboard-activity')");
  });
});

describe('dashboard #7: mock branch still has flavored data for every BusinessType', () => {
  it('getWeeklyTrend returns 7 points for LOCAL_SHOP / GUIDE / CLINIC', async () => {
    for (const mode of ['LOCAL_SHOP', 'GUIDE', 'CLINIC'] as const) {
      applyMockMode(mode);
      const trend = await getWeeklyTrend();
      expect(trend).toHaveLength(7);
      expect(new Set(trend.map((p) => p.weekday)).size).toBe(7);
    }
  });

  it('getMonthSources returns a non-empty source breakdown for LOCAL_SHOP / GUIDE / CLINIC', async () => {
    for (const mode of ['LOCAL_SHOP', 'GUIDE', 'CLINIC'] as const) {
      applyMockMode(mode);
      const sources = await getMonthSources();
      expect(sources.length).toBeGreaterThan(0);
    }
  });

  it('getRecentActivity returns non-empty, mode-flavored activity for LOCAL_SHOP / GUIDE / CLINIC', async () => {
    const seenNames = new Set<string>();
    for (const mode of ['LOCAL_SHOP', 'GUIDE', 'CLINIC'] as const) {
      applyMockMode(mode);
      const activity = await getRecentActivity();
      expect(activity.length).toBeGreaterThan(0);
      seenNames.add(activity[0]!.name);
    }
    // 三種業態的假資料人名應該不同（骨架階段的業態風味檢查，同 CLAUDE.md 慣例）
    expect(seenNames.size).toBe(3);
  });
});
