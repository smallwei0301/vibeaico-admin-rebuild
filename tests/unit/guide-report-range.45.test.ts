import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { presetRange, shiftDate, todayIn } from '@/lib/guide-report-range';

describe('guide-report-range（預設區間按鈕）', () => {
  // 2026-10-07T20:00:00Z = 台北 10/08 04:00、紐約 10/07 16:00
  const now = Date.UTC(2026, 9, 7, 20, 0, 0);
  it('shiftDate 跨月、跨年', () => {
    expect(shiftDate('2026-10-01', -1)).toBe('2026-09-30');
    expect(shiftDate('2027-01-01', -1)).toBe('2026-12-31');
  });
  it('todayIn 依時區換日', () => {
    expect(todayIn('Asia/Taipei', now)).toBe('2026-10-08');
    expect(todayIn('America/New_York', now)).toBe('2026-10-07');
  });
  it('沒有報表（無時區）時回退台北，近 7／30 天含今天', () => {
    expect(presetRange(7, undefined, now)).toEqual({ from: '2026-10-02', to: '2026-10-08' });
    expect(presetRange(30, undefined, now)).toEqual({ from: '2026-09-09', to: '2026-10-08' });
  });
  it('有店家時區時用該時區的今天', () => {
    expect(presetRange(7, 'America/New_York', now)).toEqual({ from: '2026-10-01', to: '2026-10-07' });
  });
});

describe('GuideReportView 首次載入失敗', () => {
  const view = readFileSync(resolve(process.cwd(), 'src/app/tenant/reports/GuideReportView.tsx'), 'utf8');
  it('無既有報表時顯示錯誤狀態與重試；state updater 內不呼叫 setter', () => {
    expect(view).toContain('setLoadError(true)');
    expect(view).toContain('t.errors.retry');
    expect(view).toContain('presetRange(days, report?.range.timeZone)');
    expect(view).not.toMatch(/setReport\(\(prev\)/);
  });
});
