import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getPointBalance, listPointTransactions, requestPointTopup, transferPoints,
} from '@/services/points';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const page = read('src/app/tenant/points/page.tsx');
const service = read('src/services/points.ts');

describe('points #7: real API wiring, not page-local fake success', () => {
  it('the page never calls fetch directly and never fakes a topup success with a bare timeout', () => {
    expect(page).not.toMatch(/\bfetch\(/);
    // 反向斷言：鎖住不會退回「await new Promise((r) => setTimeout(r, 420))」假成功
    expect(page).not.toContain('setTimeout(r, 420)');
    expect(page).not.toMatch(/setTimeout\(r,\s*\d+\)/);
  });

  it('balance / transactions / transfer / topup all go through src/services/points.ts', () => {
    expect(page).toContain("from '@/services/points'");
    for (const fn of ['getPointBalance', 'listPointTransactions', 'transferPoints', 'requestPointTopup']) {
      expect(page).toContain(fn);
    }
  });

  it('every service function routes through adapt(mock, real) against the documented endpoints', () => {
    expect(service).toContain("request<{ balance: number }>('/api/points/balance')");
    expect(service).toContain("request<Paged<PointTransaction>>('/api/points/transactions'");
    expect(service).toContain("request<{ transferred: boolean }>('/api/points/transfer'");
    expect(service).toContain("request<{ topupRequested: boolean }>('/api/points/topup/pay'");
    expect(service.match(/adapt</g)?.length).toBeGreaterThanOrEqual(4);
  });
});

describe('points #7: topup is honestly restored, never fakes success', () => {
  it("the topup submit handler awaits requestPointTopup() and only closes the modal / toasts success after it resolves — it cannot show success without calling the service", () => {
    const submit = page.slice(page.indexOf('const submit = async () => {', page.indexOf('function TopupModal')), page.indexOf('return (', page.indexOf('function TopupModal')));
    expect(submit).toContain('await requestPointTopup(');
    expect(submit).toContain('catch (e)');
    // success toast/close must textually follow the awaited call, not precede it
    expect(submit.indexOf('await requestPointTopup(')).toBeLessThan(submit.indexOf('toast.show(t.messages.topupRequested)'));
    expect(submit.indexOf('await requestPointTopup(')).toBeLessThan(submit.indexOf('onClose()'));
  });

  it('on failure the handler shows the backend-provided message, not an invented one', () => {
    const submit = page.slice(page.indexOf('const submit = async () => {', page.indexOf('function TopupModal')), page.indexOf('return (', page.indexOf('function TopupModal')));
    expect(submit).toContain('e instanceof Error ? e.message : t.messages.unknownError');
    expect(submit).toContain('t.messages.payCreateFailedFull');
  });

  it('real-mode /api/points/topup/pay returning 501 rejects requestPointTopup() with the backend message, not a fake success', async () => {
    await expect(requestPointTopup({ amount: 500 })).rejects.toBeTruthy();
  });
});

describe('points #7: transfer failures show the real backend message', () => {
  it('the transfer submit handler shows e.message from transferPoints() on failure, never an invented string', () => {
    const submit = page.slice(page.indexOf('const submit = async () => {', page.indexOf('function TransferModal')), page.indexOf('return (', page.indexOf('function TransferModal')));
    expect(submit).toContain('await transferPoints(');
    expect(submit).toContain('catch (e)');
    expect(submit).toContain('e instanceof Error ? e.message : t.messages.unknownError');
  });

  it('mock transferPoints() rejects with the same 409/404/400 semantics as the real backend', async () => {
    await expect(transferPoints({ toShopCode: 'demo-guide', amount: 10 }))
      .rejects.toMatchObject({ message: '不能轉移點數給自己的店家' });
    await expect(transferPoints({ toShopCode: 'no-such-shop', amount: 10 }))
      .rejects.toMatchObject({ message: '找不到目標店家' });
    await expect(transferPoints({ toShopCode: 'demo-salon', amount: -5 }))
      .rejects.toMatchObject({ message: '轉移點數必須大於 0' });
    await expect(transferPoints({ toShopCode: 'demo-salon', amount: 999_999_999 }))
      .rejects.toMatchObject({ message: '點數餘額不足' });
  });
});

describe('points #7: mock-mode transfer really moves points, not just a fake toast', () => {
  it('a successful mock transfer decreases balance and prepends a new transaction, visible on the next reads', async () => {
    const { balance: before } = await getPointBalance();
    const beforePaged = await listPointTransactions({ page: 0, size: 5 });
    const beforeCount = beforePaged.totalElements;

    const amount = 10;
    const result = await transferPoints({ toShopCode: 'demo-salon', amount });
    expect(result.transferred).toBe(true);

    const { balance: after } = await getPointBalance();
    expect(after).toBe(before - amount);

    const afterPaged = await listPointTransactions({ page: 0, size: 5 });
    expect(afterPaged.totalElements).toBe(beforeCount + 1);
    const newest = afterPaged.content[0];
    expect(newest.type).toBe('TRANSFER_OUT');
    expect(newest.amount).toBe(-amount);
    expect(newest.balanceAfter).toBe(after);
  });
});

describe('points #7: service never reads mock live bindings at module scope', () => {
  it('the per-mode mock store is lazily initialized inside a function, not a module-level const', () => {
    expect(service).toMatch(/function getMockPointsState\(\)[\s\S]*if \(!state\)/);
    // guards against re-introducing a frozen module-scope snapshot of MOCK_MODE
    expect(service).not.toMatch(/^const\s+\w+\s*=\s*byMode\(/m);
  });
});
