import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const page = read('src/app/tenant/bookings/page.tsx');
const copy = read('src/i18n/zh-TW/pages/bookings.ts');

describe('#888 預約表單不顯示不會保存的欄位', () => {
  it('編輯模式時長為唯讀顯示，不再是下拉或必填', () => {
    expect(page).not.toContain('DURATION_OPTIONS');
    expect(page).not.toMatch(/setDuration\(Number\(/);
    expect(page).not.toContain('isEdit && !duration');
    expect(page).not.toMatch(/<Label required=\{isEdit\} htmlFor="bookingDuration"/);
    const group = page.slice(page.indexOf('htmlFor="bookingDuration"'));
    expect(group.slice(0, 600)).toContain('readOnly');
    expect(group.slice(0, 600)).not.toContain('<Select');
  });

  it('送出不再帶有誤導的 duration 試算註解', () => {
    expect(page).not.toContain('duration 下拉僅供畫面試算');
  });

  it('退房日期欄位與驗證僅在 USE_MOCK 顯示', () => {
    expect(page).toContain("import { USE_MOCK } from '@/config/env'");
    expect(page).toContain('{USE_MOCK && !isEdit ? (');
    expect(page).toContain('if (USE_MOCK && !isEdit && checkoutDate && checkoutDate <= date)');
  });

  it('新文案存在、舊文案移除', () => {
    expect(copy).toContain('時長由服務項目與加購決定');
    expect(copy).not.toContain('可調整服務時長');
  });

  it('殘留註解與未用文案已移除', () => {
    expect(page).not.toContain('編輯預約的服務時長：30–480');
    expect(copy).not.toContain('durationUnit');
  });

  it('編輯模式服務選單停用並說明', () => {
    expect(page).toContain('<Select id="bookingService" value={serviceId} disabled={isEdit}');
    expect(page).toContain('isEdit ? e.serviceLocked : c.serviceHelp');
    expect(copy).toContain('已建立的預約無法更換服務；如需更換請取消後重新建立');
  });
});
