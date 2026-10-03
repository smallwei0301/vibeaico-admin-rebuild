import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formationLines, formatFormationDeadline } from '@/lib/public-departure-formation';
import { decodePublicRouteParam } from '@/lib/public-route-params';

const full = {
  minToDepart: 4,
  formationDeadlineAt: '2026-12-01T04:30:00+00:00', formationStatus: 'COLLECTING',
};

describe('#11 固定團次成團資訊顯示（19 分冊 §2.1）', () => {
  it('FIXED_DEPARTURE 顯示最低人數、截止（台北時間）、狀態；不顯示目前人數／尚差（無權威成團計數）', () => {
    expect(formationLines('FIXED_DEPARTURE', full)).toEqual([
      '最低成團 4 人', '成團截止 12/1 12:30', '招募中，尚未成團',
    ]);
  });

  it('FORMED 顯示可加入；即使傳入人數欄位也不顯示目前人數或尚差', () => {
    const lines = formationLines('FIXED_DEPARTURE', { ...full, formationStatus: 'FORMED', currentParticipants: 5 } as never);
    expect(lines).toContain('已成團，尚可加入');
    expect(lines.some((l) => /目前|尚差|已達/.test(l))).toBe(false);
  });

  it.each(['REQUEST', 'INSTANT'])('%s 方案不顯示任何成團資訊', (mode) => {
    expect(formationLines(mode, full)).toEqual([]);
  });

  it('欄位為 null／缺少時略過該項，不顯示假值；未知狀態不顯示', () => {
    expect(formationLines('FIXED_DEPARTURE', {})).toEqual([]);
    expect(formationLines('FIXED_DEPARTURE', { minToDepart: null })).toEqual([]);
    expect(formationLines('FIXED_DEPARTURE', { formationDeadlineAt: 'bad', formationStatus: 'WHATEVER' })).toEqual([]);
    expect(formationLines('FIXED_DEPARTURE', { formationStatus: 'toString' })).toEqual([]);
    expect(formatFormationDeadline(null)).toBeNull();
  });

  it('成團截止以店家時區顯示：America/Los_Angeles → 11/30 20:30；缺值或無效回退台北 12/1 12:30', () => {
    const iso = '2026-12-01T04:30:00+00:00';
    expect(formatFormationDeadline(iso, 'America/Los_Angeles')).toBe('11/30 20:30');
    expect(formatFormationDeadline(iso, 'Asia/Taipei')).toBe('12/1 12:30');
    expect(formatFormationDeadline(iso, undefined)).toBe('12/1 12:30');
    expect(formatFormationDeadline(iso, 'Mars/Phobos')).toBe('12/1 12:30');
    expect(formationLines('FIXED_DEPARTURE', full, 'America/Los_Angeles')).toContain('成團截止 11/30 20:30');
  });

  it('客滿時狀態文案不得暗示還能加入：FORMED＋soldOut → 已成團；COLLECTING＋soldOut → 名額已滿，尚未成團', () => {
    const forming = formationLines('FIXED_DEPARTURE', { ...full, formationStatus: 'FORMED', soldOut: true });
    expect(forming).toContain('已成團');
    expect(forming).not.toContain('已成團，尚可加入');
    const collecting = formationLines('FIXED_DEPARTURE', { ...full, formationStatus: 'COLLECTING', soldOut: true });
    expect(collecting).toContain('名額已滿，尚未成團');
    expect(collecting).not.toContain('招募中，尚未成團');
  });

  it.each(['REVIEW_REQUIRED', 'FAILED'])('客滿＋%s：沿用原文案，且全部狀態文案都不含「尚可加入」「招募中」以外的矛盾字眼', (status) => {
    const normal = formationLines('FIXED_DEPARTURE', { ...full, formationStatus: status });
    const sold = formationLines('FIXED_DEPARTURE', { ...full, formationStatus: status, soldOut: true });
    expect(sold).toEqual(normal);
    expect(sold.join('')).not.toMatch(/尚可加入|招募中/);
  });

  it('客滿＋AT_RISK：顯示「名額已滿，店家確認出團中」；未客滿維持原文案', () => {
    expect(formationLines('FIXED_DEPARTURE', { ...full, formationStatus: 'AT_RISK', soldOut: true }))
      .toContain('名額已滿，店家確認出團中');
    expect(formationLines('FIXED_DEPARTURE', { ...full, formationStatus: 'AT_RISK' }))
      .toContain('已成團但人數下降，店家確認中');
  });

  it('未客滿時 FORMED 仍是「已成團，尚可加入」', () => {
    expect(formationLines('FIXED_DEPARTURE', { ...full, formationStatus: 'FORMED' })).toContain('已成團，尚可加入');
  });

  it('Client 以 formationLines 呈現，文案只在 i18n', () => {
    const client = readFileSync(resolve(process.cwd(), 'src/components/public/PublicTripDetailsClient.tsx'), 'utf8');
    expect(client).toContain('formationLines(plan.salesMode, departure, timeZone)');
  });
});

describe('#11 字面 % slug 往返', () => {
  it.each(['sale%20off', '100%', '龜山島 50%'])('slug=%s：店家頁 encode → page 收到原字串 → 解碼還原', (slug) => {
    const urlSegment = encodeURIComponent(slug);
    expect(decodePublicRouteParam(urlSegment)).toBe(slug);
  });
});
