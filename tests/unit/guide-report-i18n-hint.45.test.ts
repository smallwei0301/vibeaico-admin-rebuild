import { describe, expect, it } from 'vitest';
import { reportsPage } from '@/i18n/zh-TW/pages/reports';

const t = reportsPage.guideReport;

describe('報表卡片標註文字（i18n 函式）', () => {
  it('withTruncatedHint 輸出與原組字相同', () => {
    for (const name of [t.cards.orders, t.formationCard.successRate, t.formationCard.failRate]) {
      expect(t.withTruncatedHint(name)).toBe(`${name}（${t.truncatedHint}）`);
    }
  });
});
