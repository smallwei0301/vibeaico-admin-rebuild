import { describe, expect, it } from 'vitest';
import { publicTourRequestPage as t } from '@/i18n/zh-TW/pages/public-tour-request';

describe('旅客狀態頁已確認未付款文案（#769）', () => {
  it('confirmedDescription 含期限、店家可能取消，且不承諾自動釋放', () => {
    const text = t.status.confirmedDescription('2026-10-20');
    expect(text).toContain('2026-10-20');
    expect(text).toContain('店家可能取消訂單');
    expect(text).not.toContain('將被釋放');
  });
  it('confirmedDepositDescription 含期限、金額、店家可能取消，且不承諾自動釋放', () => {
    const text = t.status.confirmedDepositDescription('2026-10-20', 'NT$300');
    expect(text).toContain('2026-10-20');
    expect(text).toContain('NT$300');
    expect(text).toContain('店家可能取消訂單');
    expect(text).not.toContain('將被釋放');
  });
});
