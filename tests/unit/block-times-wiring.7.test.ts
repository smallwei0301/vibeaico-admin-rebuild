import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createBlockTime, deleteBlockTime, listBlockTimes, updateBlockTime,
} from '@/services/bookings';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const page = read('src/app/tenant/block-times/page.tsx');
const service = read('src/services/bookings.ts');
const putRoute = read('src/app/api/block-times/[id]/route.ts');
const collectionRoute = read('src/app/api/block-times/route.ts');

describe('block-times #7/#169: real API wiring, not page-local mock data', () => {
  it('loads, creates, edits, and deletes through src/services/bookings.ts, not fetch', () => {
    expect(page).not.toMatch(/\bfetch\(/);
    expect(page).toContain("from '@/services/bookings'");
    expect(page).toContain('createBlockTime');
    expect(page).toContain('updateBlockTime');
    expect(page).toContain('deleteBlockTime');
    expect(page).toContain('listBlockTimes');

    const load = page.slice(page.indexOf('const load ='), page.indexOf('React.useEffect(() => { void load(); }'));
    expect(load).toContain('await listBlockTimes()');

    const submit = page.slice(page.indexOf('const submit = async'), page.lastIndexOf('return ('));
    expect(submit).toContain('await updateBlockTime(form.id, payload)');
    expect(submit).toContain('await createBlockTime(payload)');
    expect(submit.indexOf('await updateBlockTime')).toBeLessThan(submit.indexOf('onSaved('));

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

  it('auto=true rows are rendered read-only (edit/delete buttons disabled)', () => {
    const columns = page.slice(page.indexOf("key: 'actions'"), page.indexOf('];'));
    expect(columns).toContain('disabled={b.auto}');
  });

  it('service functions route through adapt(mock, real) against the real endpoints, including the new PUT', () => {
    expect(service).toContain('export function listBlockTimes(');
    expect(service).toMatch(/listBlockTimes[\s\S]{0,400}adapt\(/);
    expect(service).toContain("request<{ id: string }>('/api/block-times', { method: 'POST'");
    expect(service).toContain("request<void>(`/api/block-times/${id}`, { method: 'PUT'");
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

describe('block-times #169: title/recurrence/full_day/auto restored end-to-end, not removed', () => {
  it('mock create/update round-trips the restored fields (title, WEEKLY dayOfWeek, fullDay)', async () => {
    const { id } = await createBlockTime({
      title: '測試每週封鎖', reason: '固定公休', recurrence: 'WEEKLY', dayOfWeek: 4, fullDay: true,
      startAt: '2026-09-24T00:00:00+08:00', endAt: '2026-09-25T00:00:00+08:00',
    });
    const created = (await listBlockTimes()).find((b) => b.id === id);
    expect(created?.title).toBe('測試每週封鎖');
    expect(created?.recurrence).toBe('WEEKLY');
    expect(created?.dayOfWeek).toBe(4);
    expect(created?.fullDay).toBe(true);

    await updateBlockTime(id, {
      title: '改期後的封鎖', reason: '固定公休', recurrence: 'SINGLE', dayOfWeek: null, fullDay: false,
      startAt: '2026-09-26T09:00:00+08:00', endAt: '2026-09-26T10:00:00+08:00',
    });
    const updated = (await listBlockTimes()).find((b) => b.id === id);
    expect(updated?.title).toBe('改期後的封鎖');
    expect(updated?.recurrence).toBe('SINGLE');
    expect(updated?.dayOfWeek).toBeNull();
    expect(updated?.fullDay).toBe(false);

    await deleteBlockTime(id);
  });

  it('mock mode rejects editing or deleting an auto=true row with the same 409-style message as the real API', async () => {
    // 種子資料裡 LOCAL_SHOP 業態的 bt_mock_3（午休）是 auto:true，見 getMockBlockTimeStore()
    const list = await listBlockTimes();
    const autoRow = list.find((b) => b.auto);
    expect(autoRow, 'seed data must include at least one auto row for this test to mean anything').toBeTruthy();
    if (!autoRow) return;

    await expect(updateBlockTime(autoRow.id, {
      title: '不該成功', reason: '', startAt: autoRow.startAt, endAt: autoRow.endAt,
    })).rejects.toThrow(/自動產生/);

    await expect(deleteBlockTime(autoRow.id)).rejects.toThrow(/自動產生/);

    // 兩次都被拒絕，資料原封不動
    const stillThere = (await listBlockTimes()).find((b) => b.id === autoRow.id);
    expect(stillThere?.title).toBe(autoRow.title);
  });
});

describe('block-times #169: PUT /api/block-times/:id — tenant isolation & auto guard wired server-side', () => {
  it('loads the existing row scoped to the caller tenant before allowing PUT or DELETE', () => {
    const loadOwnedRow = putRoute.slice(
      putRoute.indexOf('async function loadOwnedRow'), putRoute.indexOf('export const PUT'),
    );
    expect(loadOwnedRow).toContain("select('id, auto')");
    expect(loadOwnedRow).toContain(".eq('id', id).eq('tenant_id', tenantId)");
    // 兩個 handler 都先呼叫它才動作，不是各自重寫一份查詢
    expect(putRoute.match(/await loadOwnedRow\(t\.supabase, t\.tenantId, id\)/g)?.length).toBe(2);
  });

  it('rejects auto=true rows with 409 before applying any write', () => {
    const loadOwnedRow = putRoute.slice(
      putRoute.indexOf('async function loadOwnedRow'), putRoute.indexOf('export const PUT'),
    );
    expect(loadOwnedRow).toContain('if (data.auto) throw new ApiHttpError(409,');
    expect(loadOwnedRow).toContain('ERR.CONFLICT');
  });

  it('the actual PUT/DELETE mutations are also scoped to tenant_id, not just the existence check', () => {
    const put = putRoute.slice(putRoute.indexOf('export const PUT'), putRoute.indexOf('export const DELETE'));
    expect(put).toMatch(/\.eq\('id', id\)\.eq\('tenant_id', t\.tenantId\)/);
    const del = putRoute.slice(putRoute.indexOf('export const DELETE'));
    expect(del).toMatch(/\.eq\('id', id\)\.eq\('tenant_id', t\.tenantId\)/);
  });

  it('POST also scopes the staff-ownership check to the caller tenant', () => {
    expect(collectionRoute).toContain("eq('id', b.staffId).eq('tenant_id', t.tenantId)");
  });
});
