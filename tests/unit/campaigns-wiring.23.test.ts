import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  campaignDisplayStatus, createCampaign, deleteCampaign, endCampaign, listCampaigns,
  pauseCampaign, publishCampaign, resumeCampaign, updateCampaign,
} from '@/services/campaigns';
import type { CampaignFormPayload } from '@/services/campaigns';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const page = read('src/app/tenant/campaigns/page.tsx');
const service = read('src/services/campaigns.ts');

const basePayload: CampaignFormPayload = {
  name: '測試活動',
  description: '描述',
  type: 'LIMITED_TIME',
  startAt: null,
  endAt: null,
  pushMessage: '推播內容',
  couponId: null,
  bonusPoints: 0,
  thresholdAmount: null,
  recallDays: null,
  isAutoTrigger: false,
  imageUrl: '',
};

describe('campaigns #23: real API wiring, not the three fake setTimeout delays', () => {
  it('load() no longer fakes success with setTimeout(r, 320)', () => {
    expect(page).not.toContain('setTimeout(r, 320)');
    expect(page).not.toContain('320');
  });

  it('runPending() (delete/publish/pause/resume/end) no longer fakes success with setTimeout(r, 380)', () => {
    expect(page).not.toContain('setTimeout(r, 380)');
    expect(page).not.toContain('380');
  });

  it('submit() (create/edit) no longer fakes success with setTimeout(r, 420)', () => {
    expect(page).not.toContain('setTimeout(r, 420)');
    expect(page).not.toContain('420');
  });

  it('the page no longer ships its own CAMPAIGNS_* mock arrays and never calls fetch directly', () => {
    expect(page).not.toMatch(/\bfetch\(/);
    expect(page).not.toContain('CAMPAIGNS_LOCAL_SHOP');
    expect(page).not.toContain('CAMPAIGNS_GUIDE');
    expect(page).not.toContain('CAMPAIGNS_CLINIC');
    expect(page).not.toContain("from '@/mock'");
  });

  it("starts with 'use client'", () => {
    expect(page.trimStart().startsWith("'use client';")).toBe(true);
  });

  it('load/create/update/publish/pause/resume/end/delete all go through src/services (adapt-wrapped)', () => {
    for (const fn of [
      'listCampaigns', 'createCampaign', 'updateCampaign', 'deleteCampaign',
      'publishCampaign', 'pauseCampaign', 'resumeCampaign', 'endCampaign', 'campaignDisplayStatus',
    ]) {
      expect(page).toContain(fn);
    }
    expect(service.match(/adapt</g)?.length).toBeGreaterThanOrEqual(5);
  });

  it('each status transition calls its own documented endpoint, not a shared fake', () => {
    expect(service).toContain("`/api/campaigns/${id}/publish`");
    expect(service).toContain("`/api/campaigns/${id}/pause`");
    expect(service).toContain("`/api/campaigns/${id}/resume`");
    expect(service).toContain("`/api/campaigns/${id}/end`");
    expect(service).toContain("request<{ id: string }>('/api/campaigns', {");
    expect(service).toMatch(/request<void>\(`\/api\/campaigns\/\$\{id\}`, \{\s*method: 'PUT'/);
  });

  it('content jsonb round-trips every extra field the DB does not have a dedicated column for (no invented columns)', () => {
    for (const field of [
      'pushMessage', 'couponId', 'bonusPoints', 'thresholdAmount', 'recallDays', 'isAutoTrigger', 'imageUrl',
    ]) {
      expect(service).toContain(`${field}:`);
    }
    // contentOf() collapses the flattened fields back into content on write
    expect(service).toMatch(/function contentOf/);
  });
});

describe('campaigns #23: participantCount is an honest placeholder, never a fabricated number', () => {
  it('the Campaign type carries no participantCount field (nothing in the DB can compute it)', () => {
    const types = read('src/lib/types.ts');
    const campaignType = types.slice(types.indexOf('export type Campaign = {'), types.indexOf('export type Campaign = {') + 700);
    expect(campaignType).not.toContain('participantCount');
  });

  it('the page shows the i18n placeholder text instead of a number for participants', () => {
    expect(page).toContain('t.labels.participantsUnavailable');
    expect(page).not.toMatch(/participantCount/);
  });
});

describe('campaigns #23: failures show the real backend message, never a fabricated one', () => {
  it('runPending() reports e.message on failure, not a hardcoded string', () => {
    const run = page.slice(page.indexOf('const runPending ='), page.indexOf('const askPublish ='));
    expect(run).toContain('catch (e)');
    expect(run).toContain('e instanceof Error ? e.message : t.messages.unknownError');
  });

  it('submit() reports e.message on failure, not a hardcoded string', () => {
    const submit = page.slice(page.indexOf('const submit = async'), page.indexOf('return (\n    <Modal'));
    expect(submit).toContain('catch (e)');
    expect(submit).toContain('e instanceof Error ? e.message : t.messages.unknownError');
  });
});

describe('campaigns #23: mock-mode CRUD and status transitions really persist (lazy per-mode store)', () => {
  it('lazy-init guard: never reads MOCK_MODE / byMode() at module scope', () => {
    expect(service).toContain('LOCAL_SHOP:');
    expect(service).toContain('GUIDE:');
    expect(service).toContain('CLINIC:');
    expect(service).toMatch(/function getMockCampaignStore\(\)[\s\S]*if \(!mockCampaignStore\)/);
  });

  it('a newly created campaign in mock mode shows up in the next listCampaigns() read, as DRAFT', async () => {
    const before = await listCampaigns();
    const { id } = await createCampaign(basePayload);
    const after = await listCampaigns();
    expect(after.length).toBe(before.length + 1);
    const created = after.find((c) => c.id === id);
    expect(created?.name).toBe('測試活動');
    expect(created?.status).toBe('DRAFT');
  });

  it('update persists edited fields and delete removes the row', async () => {
    const { id } = await createCampaign(basePayload);
    await updateCampaign(id, { ...basePayload, name: '已編輯活動' });
    expect((await listCampaigns()).find((c) => c.id === id)?.name).toBe('已編輯活動');
    await deleteCampaign(id);
    expect((await listCampaigns()).some((c) => c.id === id)).toBe(false);
  });

  it('publish/pause/resume/end walk the real state machine and persist each transition', async () => {
    const { id } = await createCampaign(basePayload);
    expect((await listCampaigns()).find((c) => c.id === id)?.status).toBe('DRAFT');

    await publishCampaign(id);
    expect((await listCampaigns()).find((c) => c.id === id)?.status).toBe('PUBLISHED');

    await pauseCampaign(id);
    expect((await listCampaigns()).find((c) => c.id === id)?.status).toBe('PAUSED');

    await resumeCampaign(id);
    expect((await listCampaigns()).find((c) => c.id === id)?.status).toBe('PUBLISHED');

    await endCampaign(id);
    expect((await listCampaigns()).find((c) => c.id === id)?.status).toBe('ENDED');

    await deleteCampaign(id);
  });

  it('an out-of-order transition (e.g. publish an already-published campaign) is rejected, not silently accepted', async () => {
    const { id } = await createCampaign(basePayload);
    await publishCampaign(id);
    await expect(publishCampaign(id)).rejects.toThrow();
    await deleteCampaign(id);
  });

  it('an ended campaign cannot be edited (mirrors the real PUT 409)', async () => {
    const { id } = await createCampaign(basePayload);
    await publishCampaign(id);
    await endCampaign(id);
    await expect(updateCampaign(id, { ...basePayload, name: '不該成功' })).rejects.toThrow();
  });

  it('content jsonb fields survive a full create -> read -> update -> read round trip without loss', async () => {
    const { id } = await createCampaign({
      ...basePayload,
      pushMessage: '推播文案',
      couponId: 'cp_1',
      bonusPoints: 250,
      thresholdAmount: 1500,
      recallDays: 45,
      isAutoTrigger: true,
      imageUrl: 'https://example.com/a.png',
    });
    const created = (await listCampaigns()).find((c) => c.id === id);
    expect(created).toMatchObject({
      pushMessage: '推播文案', couponId: 'cp_1', bonusPoints: 250,
      thresholdAmount: 1500, recallDays: 45, isAutoTrigger: true, imageUrl: 'https://example.com/a.png',
    });
    await deleteCampaign(id);
  });
});

describe('campaigns #23: display status derives SCHEDULED from real fields, never invents a persisted one', () => {
  it('PUBLISHED + future startAt displays as SCHEDULED; PUBLISHED + past startAt displays as ACTIVE', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(campaignDisplayStatus({
      id: 'x', name: '', keyword: '', description: '', type: '', status: 'PUBLISHED',
      startAt: future, endAt: null, pushMessage: '', couponId: null, bonusPoints: 0,
      thresholdAmount: null, recallDays: null, isAutoTrigger: false, imageUrl: '', createdAt: '',
    })).toBe('SCHEDULED');
    expect(campaignDisplayStatus({
      id: 'x', name: '', keyword: '', description: '', type: '', status: 'PUBLISHED',
      startAt: past, endAt: null, pushMessage: '', couponId: null, bonusPoints: 0,
      thresholdAmount: null, recallDays: null, isAutoTrigger: false, imageUrl: '', createdAt: '',
    })).toBe('ACTIVE');
  });
});

describe('DELETE /api/campaigns/:id（本 slice 補上的 handler）', () => {
  const route = read('src/app/api/campaigns/[id]/route.ts');

  it('匯出 DELETE handler —— 沒有它，真實模式的刪除鈕必定收到 405', () => {
    expect(route).toContain('export const DELETE');
  });

  it('以 id + tenant_id 雙條件隔離，且查不到時回 404 而非洩漏存在性', () => {
    const del = route.slice(route.indexOf('export const DELETE'));
    expect(del).toContain("requireTenant('MANAGER')");
    expect(del).toContain("找不到此活動");
    // 讀取與刪除各一次，兩次都必須帶 tenant_id
    expect(del.match(/\.eq\('tenant_id', t\.tenantId\)/g)?.length).toBe(2);
    expect(del.match(/\.eq\('id', id\)/g)?.length).toBe(2);
  });

  it('service 的真實分支確實打 DELETE 方法', () => {
    const svc = read('src/services/campaigns.ts');
    const fn = svc.slice(svc.indexOf('export const deleteCampaign'));
    expect(fn).toContain("method: 'DELETE'");
  });
});
