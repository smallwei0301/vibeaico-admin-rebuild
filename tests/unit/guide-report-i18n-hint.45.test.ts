import { describe, expect, it } from 'vitest';
import { reportsPage } from '@/i18n/zh-TW/pages/reports';

const t = reportsPage.guideReport;

describe('報表卡片標註文字（i18n 函式）', () => {
  it('withTruncatedHint 輸出與原組字相同', () => {
    for (const name of [t.cards.orders, t.formationCard.successRate, t.formationCard.failRate]) {
      expect(t.withTruncatedHint(name)).toBe(`${name}（${t.truncatedHint}）`);
    }
  });

  it('concludedHint：含成團後人數不足時標明，為 0 時維持原句', () => {
    const h = t.formationCard.concludedHint;
    expect(h(7, 6, 1, 1)).toBe('已結案 7 團：成團 6 團（含成團後人數不足 1 團）、未成團 1 團');
    expect(h(7, 6, 1, 0)).toBe('已結案 7 團：成團 6 團、未成團 1 團');
    expect(h(7, 6, 1)).toBe('已結案 7 團：成團 6 團、未成團 1 團');
  });
});
