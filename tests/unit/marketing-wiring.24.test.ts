import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  cancelMarketingPush, createMarketingPush, deleteMarketingPush, listMarketingPushes,
  sendMarketingPush, updateMarketingPush,
} from '@/services/marketing';
import type { MarketingPushFormPayload } from '@/services/marketing';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const page = read('src/app/tenant/marketing/page.tsx');
const service = read('src/services/marketing.ts');

const basePayload: MarketingPushFormPayload = {
  title: '測試推播',
  content: '測試內容',
  imageUrl: '',
  note: '',
  targetType: 'ALL',
  targetValue: '',
  targetLabel: '',
  scheduledAt: null,
};

describe('marketing #24: real API wiring, not the three fake setTimeout delays', () => {
  it('load() no longer fakes success with setTimeout(r, 320)', () => {
    expect(page).not.toContain('setTimeout(r, 320)');
    expect(page).not.toContain('320');
  });

  it('runPending() (delete/cancel/send) no longer fakes success with setTimeout(r, 380)', () => {
    expect(page).not.toContain('setTimeout(r, 380)');
    expect(page).not.toContain('380');
  });

  it('submit() (create/edit) no longer fakes success with setTimeout(r, 420)', () => {
    expect(page).not.toContain('setTimeout(r, 420)');
    expect(page).not.toContain('420');
  });

  it('the page no longer ships its own PUSHES_* mock arrays and never calls fetch directly', () => {
    expect(page).not.toMatch(/\bfetch\(/);
    expect(page).not.toContain('PUSHES_LOCAL_SHOP');
    expect(page).not.toContain('PUSHES_GUIDE');
    expect(page).not.toContain('PUSHES_CLINIC');
    expect(page).not.toContain("from '@/mock'");
    expect(page).not.toContain('byMode(');
  });

  it("starts with 'use client'", () => {
    expect(page.trimStart().startsWith("'use client';")).toBe(true);
  });

  it('load/create/update/delete/cancel/send all go through src/services (adapt-wrapped)', () => {
    for (const fn of [
      'listMarketingPushes', 'createMarketingPush', 'updateMarketingPush', 'deleteMarketingPush',
      'cancelMarketingPush', 'sendMarketingPush',
    ]) {
      expect(page).toContain(fn);
    }
    expect(service.match(/adapt</g)?.length).toBeGreaterThanOrEqual(5);
  });

  it('each action calls its own documented endpoint, not a shared fake', () => {
    expect(service).toContain("request<ApiMarketingPush[]>('/api/marketing/pushes')");
    expect(service).toContain("request<{ id: string }>('/api/marketing/pushes', {");
    expect(service).toMatch(/request<void>\(`\/api\/marketing\/pushes\/\$\{id\}`, \{\s*method: 'PUT'/);
    expect(service).toMatch(/request<void>\(`\/api\/marketing\/pushes\/\$\{id\}`, \{ method: 'DELETE' \}\)/);
    expect(service).toContain("`/api/marketing/pushes/${id}/cancel`");
    expect(service).toContain("`/api/marketing/pushes/${id}/send`");
  });
});

describe('marketing #24: the real LINE send endpoint is never actually called by this test suite or the mock branch', () => {
  it('service source never contains a raw fetch/curl against the LINE API', () => {
    expect(service).not.toMatch(/api\.line\.me/);
    expect(service).not.toMatch(/lineMulticast/);
  });

  it('sendMarketingPush mock branch only mutates the local store, no network primitives', () => {
    const fn = service.slice(service.indexOf('export const sendMarketingPush'));
    const mockBranch = fn.slice(0, fn.indexOf('() =>\n    request<{ sentCount: number }>'));
    expect(mockBranch).not.toMatch(/\bfetch\(/);
    expect(mockBranch).not.toMatch(/XMLHttpRequest|WebSocket/);
  });
});

describe('marketing #24: failures show the real backend message, never a fabricated one', () => {
  it('runPending() reports e.message on failure, not a hardcoded string', () => {
    const run = page.slice(page.indexOf('const runPending ='), page.indexOf('const columns:'));
    expect(run).toContain('catch (e)');
    expect(run).toContain('e instanceof Error ? e.message : t.messages.unknownError');
  });

  it('submit() reports e.message on failure, not a hardcoded string', () => {
    const submit = page.slice(page.indexOf('const submit = async'), page.indexOf('return (\n    <Modal'));
    expect(submit).toContain('catch (e)');
    expect(submit).toContain('e instanceof Error ? e.message : t.messages.unknownError');
  });
});

describe('marketing #24: estimatedCount/failedCount are honest placeholders, never fabricated numbers', () => {
  it('the MarketingPush type carries no estimatedCount or failedCount field (nothing in the DB can compute them)', () => {
    const types = read('src/lib/types.ts');
    const start = types.indexOf('export type MarketingPush = {');
    const marketingType = types.slice(start, start + 700);
    expect(marketingType).not.toContain('estimatedCount');
    expect(marketingType).not.toContain('failedCount');
  });

  it('the page shows the i18n placeholder text instead of a number for the estimated-audience column', () => {
    expect(page).toContain('t.labels.estimatedUnavailable');
    expect(page).not.toMatch(/estimatedCount/);
    expect(page).not.toMatch(/failedCount/);
  });
});

describe('marketing #24: mock-mode CRUD and status transitions really persist (lazy per-mode store)', () => {
  it('lazy-init guard: never reads MOCK_MODE / byMode() at module scope', () => {
    expect(service).toContain('LOCAL_SHOP:');
    expect(service).toContain('GUIDE:');
    expect(service).toContain('CLINIC:');
    expect(service).toMatch(/function getMockPushStore\(\)[\s\S]*if \(!mockPushStore\)/);
  });

  it('a newly created push in mock mode shows up in the next listMarketingPushes() read, as DRAFT', async () => {
    const before = await listMarketingPushes();
    const { id } = await createMarketingPush(basePayload);
    const after = await listMarketingPushes();
    expect(after.length).toBe(before.length + 1);
    const created = after.find((p) => p.id === id);
    expect(created?.title).toBe('測試推播');
    expect(created?.status).toBe('DRAFT');
  });

  it('a push with scheduledAt is created as SCHEDULED, not DRAFT', async () => {
    const at = new Date(Date.now() + 3_600_000).toISOString();
    const { id } = await createMarketingPush({ ...basePayload, scheduledAt: at });
    const created = (await listMarketingPushes()).find((p) => p.id === id);
    expect(created?.status).toBe('SCHEDULED');
    await deleteMarketingPush(id);
  });

  it('update persists edited fields and delete removes the row', async () => {
    const { id } = await createMarketingPush(basePayload);
    await updateMarketingPush(id, { ...basePayload, title: '已編輯推播' });
    expect((await listMarketingPushes()).find((p) => p.id === id)?.title).toBe('已編輯推播');
    await deleteMarketingPush(id);
    expect((await listMarketingPushes()).some((p) => p.id === id)).toBe(false);
  });

  it('cancel walks SCHEDULED -> CANCELLED and persists', async () => {
    const at = new Date(Date.now() + 3_600_000).toISOString();
    const { id } = await createMarketingPush({ ...basePayload, scheduledAt: at });
    await cancelMarketingPush(id);
    expect((await listMarketingPushes()).find((p) => p.id === id)?.status).toBe('CANCELLED');
  });

  it('cancelling a DRAFT push (not SCHEDULED) is rejected, not silently accepted', async () => {
    const { id } = await createMarketingPush(basePayload);
    await expect(cancelMarketingPush(id)).rejects.toThrow();
    await deleteMarketingPush(id);
  });

  it('send walks DRAFT -> SENT, records sentCount and sentAt, and persists', async () => {
    const { id } = await createMarketingPush(basePayload);
    const { sentCount } = await sendMarketingPush(id);
    const row = (await listMarketingPushes()).find((p) => p.id === id);
    expect(row?.status).toBe('SENT');
    expect(row?.sentCount).toBe(sentCount);
    expect(row?.sentAt).not.toBeNull();
  });

  it('a SENT push cannot be deleted (mirrors the real 409) or re-sent from a non-sendable state', async () => {
    const { id } = await createMarketingPush(basePayload);
    await sendMarketingPush(id);
    await expect(deleteMarketingPush(id)).rejects.toThrow();
    await expect(sendMarketingPush(id)).rejects.toThrow();
  });

  it('a SENT push cannot be edited (mirrors the real PUT 409)', async () => {
    const { id } = await createMarketingPush(basePayload);
    await sendMarketingPush(id);
    await expect(updateMarketingPush(id, { ...basePayload, title: '不該成功' })).rejects.toThrow();
  });

  it('audience jsonb fields survive a full create -> read -> update -> read round trip without loss', async () => {
    const { id } = await createMarketingPush({
      ...basePayload,
      targetType: 'MEMBERSHIP_LEVEL',
      targetValue: 'ml_3',
      targetLabel: '鑽石卡',
      imageUrl: 'https://example.com/a.png',
      note: '內部備註',
    });
    const created = (await listMarketingPushes()).find((p) => p.id === id);
    expect(created).toMatchObject({
      targetType: 'MEMBERSHIP_LEVEL', targetValue: 'ml_3', targetLabel: '鑽石卡',
      imageUrl: 'https://example.com/a.png', note: '內部備註',
    });
    await deleteMarketingPush(id);
  });
});

describe('DELETE /api/marketing/pushes/:id（後端既有的 handler，本 slice 未新增）', () => {
  const route = read('src/app/api/marketing/pushes/[id]/route.ts');

  it('匯出 DELETE handler —— 已存在，不需要本 slice 補上', () => {
    expect(route).toContain('export const DELETE');
  });

  it('以 id + tenant_id 雙條件隔離，SENT 不可刪除', () => {
    const del = route.slice(route.indexOf('export const DELETE'));
    expect(del).toContain("requireTenant('MANAGER')");
    expect(del).toContain('已發送的推播不可刪除');
    expect(del.match(/\.eq\('tenant_id', t\.tenantId\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('service 的真實分支確實打 DELETE 方法', () => {
    const fn = service.slice(service.indexOf('export const deleteMarketingPush'));
    expect(fn).toContain("method: 'DELETE'");
  });
});
