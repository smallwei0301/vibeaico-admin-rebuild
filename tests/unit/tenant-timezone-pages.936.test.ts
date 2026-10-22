import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  formatDate, formatDateTime, formatTime, toZonedDatetimeLocal, zonedDatetimeLocalToIso, zonedLocalToIso,
} from '@/lib/utils';

const read = (rel: string) => readFileSync(resolve(__dirname, '../../src/app/tenant', rel), 'utf8');

// 2026-10-13T17:30:00Z：台北 10/14 01:30、洛杉磯 10/13 10:30
const ISO = '2026-10-13T17:30:00Z';

describe('#936 非台北瀏覽器時區下，共用格式化仍輸出店家時區', () => {
  const prevTz = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'America/Los_Angeles'; });
  afterAll(() => {
    if (prevTz === undefined) delete process.env.TZ; else process.env.TZ = prevTz;
  });

  it('瀏覽器為洛杉磯時，不帶 tz 為洛杉磯、帶店家 tz 為台北', () => {
    expect(formatDateTime(ISO)).toBe('2026/10/13 10:30');
    expect(formatDateTime(ISO, 'Asia/Taipei')).toBe('2026/10/14 01:30');
    expect(formatDate(ISO, 'Asia/Taipei')).toBe('2026/10/14');
    expect(formatTime(ISO, 'Asia/Taipei')).toBe('01:30');
  });

  it('datetime-local 預填與送出以店家時區互逆，與瀏覽器時區無關', () => {
    expect(toZonedDatetimeLocal(ISO, 'Asia/Taipei')).toBe('2026-10-14T01:30');
    expect(toZonedDatetimeLocal(ISO, 'America/Los_Angeles')).toBe('2026-10-13T10:30');
    expect(zonedDatetimeLocalToIso('2026-10-14T01:30', 'Asia/Taipei')).toBe('2026-10-13T17:30:00.000Z');
    expect(zonedDatetimeLocalToIso(toZonedDatetimeLocal(ISO, 'Asia/Tokyo'), 'Asia/Tokyo')).toBe('2026-10-13T17:30:00.000Z');
  });
});

describe('#936 各頁已改用店家時區機制（原始碼斷言）', () => {
  const pages = [
    'dashboard', 'calendar', 'customers', 'product-orders', 'campaigns', 'marketing',
    'settings/impersonation-log', 'referrals', 'donate', 'points', 'inventory', 'calendar-sync', 'chat',
  ];

  it.each(pages)('%s 使用 useTenantTimeZone，且不再有未帶時區的格式化呼叫', (page) => {
    const src = read(`${page}/page.tsx`);
    expect(src).toMatch(/useTenantTimeZone(State)?\(\)/);
    expect(src).not.toMatch(/\bformat(Date|Time|DateTime)\(\s*[^(),]+(\([^()]*\))?\s*\)/);
    expect(src).not.toMatch(/\.toLocale(Date|Time)?String\(\s*'zh-TW'.*hour12/);
  });

  it('impersonation-log 不再直接呼叫 toLocaleString', () => {
    expect(read('settings/impersonation-log/page.tsx')).not.toContain('toLocaleString');
  });

  it('campaigns／marketing 的 datetime-local 以店家時區換算，且未就緒不得送出', () => {
    for (const page of ['campaigns', 'marketing']) {
      const src = read(`${page}/page.tsx`);
      expect(src).toContain('zonedDatetimeLocalToIso');
      expect(src).toContain('toZonedDatetimeLocal');
      expect(src).toContain('!tzReady');
      expect(src).not.toMatch(/\.slice\(0, 16\)/);
    }
  });

  it('calendar 以店家時區分組、換算時段與建立封鎖', () => {
    const src = read('calendar/page.tsx');
    expect(src).toContain('zonedYmd(b.startAt, tz)');
    expect(src).toContain('zonedLocalToIso(');
    expect(src).not.toMatch(/new Date\(b\.startAt\)\.getHours/);
  });

  it('dashboard 的「今日」依店家時區界定', () => {
    const src = read('dashboard/page.tsx');
    expect(src).toContain('tenantDayRange(new Date(), tz)');
    expect(src).toContain('tenantDateString(new Date(), tz)');
  });
});

describe('#936 後續：寫入路徑等時區就緒、其餘頁面改店家時區', () => {
  it('calendar 封鎖寫入要求 ready，未就緒停用按鈕並顯示可重試錯誤', () => {
    const src = read('calendar/page.tsx');
    expect(src).toContain('useTenantTimeZoneState()');
    expect(src).toContain('if (!tzReady) return;');
    expect(src.match(/disabled=\{!tzReady\}/g)?.length).toBe(2);
    expect(src).toContain('t.messages.timeZoneLoadFailed');
    expect(src).toContain('onClick={tzRetry}');
  });

  it('block-times 以店家時區顯示與寫入，且未就緒不得送出', () => {
    const src = read('block-times/page.tsx');
    expect(src).toContain('zonedLocalToIso(startDate, startTime, tz)');
    expect(src).toContain('zonedLocalToIso(endDate, endTime, tz)');
    expect(src).toContain('if (!tzReady) return;');
    expect(src).toContain('disabled={!tzReady}');
    expect(src).not.toMatch(/new Date\(`\$\{/);
    expect(src).not.toMatch(/formatDate\(b\.startAt\)|formatTime\(b\.(start|end)At\)/);
  });

  it('coupons 有效期以店家時區預填與送出，且未就緒不得儲存', () => {
    const src = read('coupons/page.tsx');
    expect(src).toContain('toZonedDatetimeLocal(src.startAt, tz)');
    expect(src).toContain('zonedDatetimeLocalToIso(startLocal, tz)');
    expect(src).toContain('if (!tzReady) return;');
    expect(src).toContain('disabled={!tzReady}');
    expect(src).not.toMatch(/\.slice\(0, 16\)/);
    expect(src).not.toMatch(/formatDate\((c|coupon)\.startAt\)/);
  });

  it('recurring-bookings、feature-store 顯示使用店家時區', () => {
    const rb = read('recurring-bookings/page.tsx');
    expect(rb).toContain('useTenantTimeZone()');
    expect(rb).toContain('formatDate(r.lastGeneratedAt, tz)');
    const fs = read('feature-store/page.tsx');
    expect(fs).toContain('useTenantTimeZone()');
    expect(fs).toContain('formatDate(sub.expiresAt, tz)');
  });

  it('dashboard 今日查詢以 isLatest 守門舊請求', () => {
    const src = read('dashboard/page.tsx');
    expect(src).toContain('let isLatest = true;');
    expect(src).toContain('return () => { isLatest = false; };');
  });

  it('campaigns／marketing 表單預填不依賴 tz 重設其他欄位', () => {
    for (const page of ['campaigns', 'marketing']) {
      const src = read(`${page}/page.tsx`);
      expect(src).toContain('tzRef.current');
      expect(src).not.toMatch(/\[open, (campaign|push), tz\]/);
    }
  });
});

describe('#936 非台北店家輸入 10:00，送出 ISO 對應店家時區（與瀏覽器時區無關）', () => {
  const prevTz = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'Asia/Taipei'; });
  afterAll(() => {
    if (prevTz === undefined) delete process.env.TZ; else process.env.TZ = prevTz;
  });

  it('block-times／calendar：10:00 在洛杉磯店家為 17:00Z（PDT）', () => {
    expect(zonedLocalToIso('2026-10-14', '10:00', 'America/Los_Angeles')).toBe('2026-10-14T17:00:00.000Z');
    expect(zonedLocalToIso('2026-10-14', '10:00', 'Asia/Taipei')).toBe('2026-10-14T02:00:00.000Z');
    expect(zonedLocalToIso('2026-12-14', '10:00', 'America/Los_Angeles')).toBe('2026-12-14T18:00:00.000Z');
  });

  it('coupons：datetime-local 10:00 以店家時區轉 UTC，且預填可逆', () => {
    const iso = zonedDatetimeLocalToIso('2026-10-14T10:00', 'America/Los_Angeles');
    expect(iso).toBe('2026-10-14T17:00:00.000Z');
    expect(toZonedDatetimeLocal(iso, 'America/Los_Angeles')).toBe('2026-10-14T10:00');
    expect(toZonedDatetimeLocal(iso, 'Asia/Taipei')).toBe('2026-10-15T01:00');
  });
});

describe('#936 第二輪：未就緒時不得以預設時區換算並寫入', () => {
  it('coupons：draft 以當地字串暫存，送出時才換算 ISO，且未就緒停用輸入', () => {
    const src = read('coupons/page.tsx');
    expect(src).toContain('setStartLocal(e.target.value)');
    expect(src).toContain('setEndLocal(e.target.value)');
    expect(src).not.toMatch(/onChange=\{\(e\) => patch\(\{ (start|end)At/);
    expect(src).toMatch(/startAt: startIso,\s*endAt: endIso/);
    expect(src).toMatch(/id="couponValidStartAt"[^>]*disabled=\{!tzReady\}/);
    expect(src).toMatch(/id="couponValidEndAt"[^>]*disabled=\{!tzReady\}/);
  });

  it('block-times：編輯／新增依 ready 停用，且時區改變時關閉 modal', () => {
    const src = read('block-times/page.tsx');
    expect(src).toMatch(/disabled=\{b\.auto \|\| !tzReady\}/);
    expect(src).toMatch(/<Button disabled=\{!tzReady\} onClick=\{\(\) => setEditing\(emptyDraft\(\)\)\}/);
    expect(src).toContain('setEditing(null)');
    expect(src).toContain('editingTzRef');
  });
});
