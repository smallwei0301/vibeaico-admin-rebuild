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

  it('Client 以 formationLines 呈現，文案只在 i18n', () => {
    const client = readFileSync(resolve(process.cwd(), 'src/components/public/PublicTripDetailsClient.tsx'), 'utf8');
    expect(client).toContain('formationLines(plan.salesMode, departure)');
  });
});

describe('#11 字面 % slug 往返', () => {
  it.each(['sale%20off', '100%', '龜山島 50%'])('slug=%s：店家頁 encode → page 收到原字串 → 解碼還原', (slug) => {
    const urlSegment = encodeURIComponent(slug);
    expect(decodePublicRouteParam(urlSegment)).toBe(slug);
  });
});
