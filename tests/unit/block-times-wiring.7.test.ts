import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createBlockTime, deleteBlockTime, listBlockTimes } from '@/services/bookings';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const page = read('src/app/tenant/block-times/page.tsx');
const service = read('src/services/bookings.ts');

describe('block-times #7: real API wiring, not page-local mock data', () => {
  it('no longer references the old hardcoded MOCK_BLOCK_TIMES constant or its fake delay', () => {
    expect(page).not.toContain('MOCK_BLOCK_TIMES');
    expect(page).not.toContain('await new Promise((r) => setTimeout(r, 320))');
    expect(page).not.toContain("recurrence: 'SINGLE'");
  });

  it('loads, creates, and deletes through src/services/bookings.ts, not fetch', () => {
    expect(page).not.toMatch(/\bfetch\(/);
    expect(page).toContain("import { createBlockTime, deleteBlockTime, listBlockTimes");
    expect(page).toContain('from \'@/services/bookings\'');

    const load = page.slice(page.indexOf('const load ='), page.indexOf('React.useEffect(() => { void load(); }'));
    expect(load).toContain('await listBlockTimes()');

    const submit = page.slice(page.indexOf('const submit = async'), page.lastIndexOf('return ('));
    expect(submit).toContain('await createBlockTime(');
    expect(submit.indexOf('await createBlockTime(')).toBeLessThan(submit.indexOf('onCreated()'));

    const del = page.slice(page.indexOf('onConfirm={async'), page.indexOf('/>', page.indexOf('onConfirm={async')));
    expect(del).toContain('await deleteBlockTime(deleting.id)');
    expect(del.indexOf('await deleteBlockTime(')).toBeLessThan(del.indexOf("toast.show(t.messages.deleted)"));
  });

  it('shows the real error on failure instead of a fake success toast', () => {
    const load = page.slice(page.indexOf('const load ='), page.indexOf('React.useEffect(() => { void load(); }'));
    expect(load).toContain('catch (e)');
    expect(load).toContain('e instanceof Error ? e.message : t.messages.loadFailed');

    const submit = page.slice(page.indexOf('const submit = async'), page.lastIndexOf('return ('));
    expect(submit).toContain('catch (e)');
    expect(submit).toContain("e instanceof Error ? e.message : t.messages.saveFailed");

    const del = page.slice(page.indexOf('onConfirm={async'), page.indexOf('/>', page.indexOf('onConfirm={async')));
    expect(del).toContain('catch (e)');
    expect(del).toContain('t.messages.deleteFailed');
  });

  it('service functions route through adapt(mock, real) against the real endpoints', () => {
    expect(service).toContain('export function listBlockTimes(');
    expect(service).toMatch(/listBlockTimes[\s\S]{0,400}adapt\(/);
    expect(service).toContain("request<BlockTimeItem[]>('/api/block-times', { query: { from, to } })");
    expect(service).toContain("request<{ id: string }>('/api/block-times', { method: 'POST'");
    expect(service).toContain("request<void>(`/api/block-times/${id}`, { method: 'DELETE' })");
  });
});

describe('block-times #7 AUDIT fix: mock-mode create/delete actually persist (no fake success)', () => {
  it('a block time created in mock mode shows up in the next listBlockTimes() read', async () => {
    const before = await listBlockTimes();
    const { id } = await createBlockTime({
      startAt: '2026-09-20T10:00:00+08:00', endAt: '2026-09-20T11:00:00+08:00', reason: '測試新增可讀回',
    });
    const after = await listBlockTimes();
    expect(after.length).toBe(before.length + 1);
    const created = after.find((b) => b.id === id);
    expect(created).toBeTruthy();
    expect(created?.reason).toBe('測試新增可讀回');
  });

  it('a block time deleted in mock mode no longer appears in the next listBlockTimes() read', async () => {
    const { id } = await createBlockTime({
      startAt: '2026-09-21T10:00:00+08:00', endAt: '2026-09-21T11:00:00+08:00', reason: '測試刪除即消失',
    });
    expect((await listBlockTimes()).some((b) => b.id === id)).toBe(true);
    await deleteBlockTime(id);
    expect((await listBlockTimes()).some((b) => b.id === id)).toBe(false);
  });
});
