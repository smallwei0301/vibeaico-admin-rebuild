import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const page = readFileSync(resolve(process.cwd(), 'src/app/tenant/donate/page.tsx'), 'utf8');
const copy = readFileSync(resolve(process.cwd(), 'src/i18n/zh-TW/pages/donate.ts'), 'utf8');

function stripComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

describe('donate honesty regression guard (#25)', () => {
  it('does not restore fabricated donor or finance constants', () => {
    const executable = stripComments(page);
    expect(executable).not.toContain('MOCK_DONORS');
    expect(executable).not.toContain('MOCK_TOTAL_DONATED');
    expect(executable).not.toContain('MOCK_MY_DONATED');
    expect(executable).not.toContain('48650');
  });

  it('does not simulate payment with a timer or Promise delay', () => {
    const executable = stripComments(page);
    expect(executable).not.toMatch(/setTimeout\s*\(/);
    expect(executable).not.toMatch(/new\s+Promise\s*\(/);
  });

  it('renders the always-visible truthful warning and unknown finance state', () => {
    expect(page).toContain('title={t.notBuilt.title}');
    expect(page).toContain('{t.notBuilt.body}');
    expect(page).toContain('{t.notBuilt.unknownValue}');
    expect(page).toContain('{t.notBuilt.myDonationUnknown}');
    expect(page).toContain('rows={[] as Donor[]}');
  });

  it('submit only reports that no payment was created', () => {
    expect(page).toContain("toast.show(t.notBuilt.submitNotEffective, 'warning')");
    expect(page).not.toContain('/api/donations');
  });

  it('does not claim NewebPay or wallet payment support before the backend exists', () => {
    expect(copy).toContain("payHint: '贊助金流尚未接通，目前無法用任何付款方式完成贊助。'");
    expect(copy).not.toContain("payHint: '透過藍新金流安全付款，支援信用卡 / Apple Pay / Google Pay'");
    expect(copy).toContain("submitNotEffective: '未送出贊助：贊助金流後端尚未建置，沒有產生任何付款，你的帳戶不會被扣款。'");
  });
});
