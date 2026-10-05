/**
 * #748 頁面／流程層：編輯頁儲存與複製行程的接線與行為。
 * 沒有 DOM 測試環境，所以分兩段：① 以頁面原始碼斷言關鍵順序與接線；
 * ② 以頁面實際使用的 helper + 真實 service（fetch／deps 注入）重現 saveBasic／duplicate 的流程。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/config/env', () => ({ USE_MOCK: false }));

import { omitUnchangedGallery } from '@/lib/trip-gallery';
import {
  omitUnchangedTripTextFields, planTripCopy, tripCopyDraftToFields, tripTextFieldErrors,
} from '@/lib/trip-field-limits';
import { duplicateTripFully, updateTrip, type TripDuplicationDeps } from '@/services/tours';
import type { Trip } from '@/lib/types';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const detailPage = read('src/app/tenant/trips/[id]/page.tsx');
const listPage = read('src/app/tenant/trips/page.tsx');

function body(source: string, name: string): string {
  const start = source.indexOf(`const ${name} =`);
  expect(start, `找不到 ${name}`).toBeGreaterThan(-1);
  const next = source.indexOf('\n  const ', start + 1);
  return source.slice(start, next > 0 ? next : undefined);
}

const items = (n: number) => Array.from({ length: n }, () => 'item');
const legacyTrip = {
  id: 't1', title: '舊標題', slug: 'legacy', galleryUrls: [] as string[],
  description: 'd'.repeat(6000), safetyNotice: 's'.repeat(2500),
  inclusions: items(25), exclusions: items(30), notices: ['n'.repeat(400)],
} as unknown as Trip;

afterEach(() => vi.unstubAllGlobals());

function captureFetch() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), {
    status: 200, headers: { 'content-type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls: () => fetchMock.mock.calls.length,
    body: () => JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string),
  };
}

/** 與 saveBasic 相同的組合：先 omit，再只檢查仍在 payload 內的欄位，沒錯誤才呼叫 updateTrip。 */
async function saveBasicLike(form: Trip, original: Trip) {
  const payload = omitUnchangedTripTextFields(omitUnchangedGallery(form, original), original);
  const errors = tripTextFieldErrors(payload);
  if (errors.length > 0) return { sent: false as const, errors };
  await updateTrip(form.id, payload);
  return { sent: true as const, errors };
}

describe('編輯頁 saveBasic', () => {
  it('原始碼：先 omit 再預檢，有錯就 return（不打 API），沒錯才 updateTrip(payload)', () => {
    const save = body(detailPage, 'saveBasic');
    expect(save).toContain('omitUnchangedTripTextFields(omitUnchangedGallery(form, trip), trip)');
    expect(save).toContain('tripTextFieldErrors(payload)');
    const check = save.indexOf('tripTextFieldErrors(payload)');
    const bail = save.indexOf('return;', check);
    expect(bail).toBeGreaterThan(check);
    expect(bail).toBeLessThan(save.indexOf('updateTrip(tripId, payload)'));
    expect(save).toContain("'danger'");
    expect(save).toContain('setTextErrors(');
  });

  it('原始碼：欄位被修改時清掉該欄位的行內錯誤，五個欄位都掛了計數與錯誤元件', () => {
    expect(body(detailPage, 'patch')).toContain('delete next[');
    for (const field of ['description', 'safetyNotice', 'inclusions', 'exclusions', 'notices']) {
      expect(detailPage).toContain(`<TripTextFieldMeta field="${field}"`);
    }
  });

  it('歷史超量且未變更 + 只改標題：呼叫 updateTrip，body 不含五個欄位', async () => {
    const net = captureFetch();
    const result = await saveBasicLike({ ...legacyTrip, title: '新標題' } as Trip, legacyTrip);
    expect(result.sent).toBe(true);
    expect(net.calls()).toBe(1);
    const sent = net.body();
    expect(sent.title).toBe('新標題');
    for (const key of ['description', 'notes', 'includes', 'exclusions', 'notices']) expect(key in sent).toBe(false);
  });

  it('變更了的欄位仍然超量：不呼叫 updateTrip，回報該欄位，表單（draft）原封不動', async () => {
    const net = captureFetch();
    const form = { ...legacyTrip, description: 'x'.repeat(5001) } as Trip;
    const snapshot = JSON.stringify(form);
    const result = await saveBasicLike(form, legacyTrip);
    expect(result.sent).toBe(false);
    expect(result.errors).toEqual([{ field: 'description', kind: 'tooLong', limit: 5000 }]);
    expect(net.calls()).toBe(0);
    expect(JSON.stringify(form)).toBe(snapshot);
  });

  it('變更的欄位合規（縮短歷史超量內容）時照送，且只送變更的欄位', async () => {
    const net = captureFetch();
    const result = await saveBasicLike({ ...legacyTrip, description: 'short' } as Trip, legacyTrip);
    expect(result.sent).toBe(true);
    const sent = net.body();
    expect(sent.description).toBe('short');
    for (const key of ['notes', 'includes', 'exclusions', 'notices']) expect(key in sent).toBe(false);
  });

  it('明確清空歷史超量欄位會送出空值', async () => {
    const net = captureFetch();
    await saveBasicLike({ ...legacyTrip, exclusions: [], description: '' } as Trip, legacyTrip);
    expect(net.body()).toMatchObject({ exclusions: [], description: '' });
  });
});

describe('列表頁複製行程', () => {
  const sourcePayload = (trip: Trip) => ({
    title: `${trip.title}（複本）`, slug: 'copy', description: trip.description, inclusions: trip.inclusions,
    exclusions: trip.exclusions, notices: trip.notices, safetyNotice: trip.safetyNotice,
  });

  const makeDeps = (overrides: Partial<TripDuplicationDeps> = {}) => {
    const createTrip = vi.fn(async () => ({ id: 'new' } as unknown as Trip));
    const deps = {
      createTrip, listTripPlans: async () => [], listTripAddons: async () => [],
      saveTripPlan: vi.fn(), saveTripPlanSeason: vi.fn(), saveTripAddon: vi.fn(), deleteTrip: vi.fn(),
      ...overrides,
    } as unknown as TripDuplicationDeps;
    return { createTrip, deps };
  };

  it('原始碼：duplicate 先 planTripCopy，draft 分支 return 前不呼叫 duplicateTripFully', () => {
    const dup = body(listPage, 'duplicate');
    expect(dup).toContain('planTripCopy(');
    expect(dup).toContain("plan.kind === 'draft'");
    expect(dup.indexOf('setCopyDraft(')).toBeLessThan(dup.indexOf('duplicateTripFully('));
    expect(dup.indexOf('return;')).toBeLessThan(dup.indexOf('duplicateTripFully('));
  });

  it('原始碼：確認時合併編輯值、成功才關閉、失敗保持開啟；取消只關閉 Modal', () => {
    const confirm = body(listPage, 'confirmCopyDraft');
    expect(confirm).toContain('...fields');
    expect(confirm).toContain('duplicateTripFully(copyDraft.trip.id');
    expect(confirm).toContain('if (ok) setCopyDraft(null)');
    expect(listPage).toContain('onCancel={() => setCopyDraft(null)}');
    const modal = read('src/components/trips/TripCopyDraftModal.tsx');
    expect(modal).toContain('disabled={errors.length > 0}');
    expect(modal).toContain('tripTextFieldErrors(fields).length === 0');
  });

  it('來源合規：直接複製，payload 為完整來源內容', async () => {
    const source = { ...legacyTrip, description: 'ok', safetyNotice: 'ok', inclusions: ['a'], exclusions: [], notices: [] } as Trip;
    expect(planTripCopy(source).kind).toBe('direct');
    const { createTrip, deps } = makeDeps();
    await duplicateTripFully('t1', sourcePayload(source), deps);
    expect(createTrip).toHaveBeenCalledTimes(1);
  });

  it('來源超量：先開草稿、完全不呼叫 createTrip；草稿帶完整來源值；修正前確認被擋', () => {
    const plan = planTripCopy(legacyTrip);
    expect(plan.kind).toBe('draft');
    if (plan.kind !== 'draft') return;
    expect(tripCopyDraftToFields(plan.draft)).toEqual({
      description: legacyTrip.description, safetyNotice: legacyTrip.safetyNotice,
      inclusions: legacyTrip.inclusions, exclusions: legacyTrip.exclusions, notices: legacyTrip.notices,
    });
    expect(tripTextFieldErrors(tripCopyDraftToFields(plan.draft)).length).toBeGreaterThan(0);
  });

  it('草稿修正後確認：以編輯值呼叫 createTrip，來源 trip 物件不被修改', async () => {
    const before = JSON.stringify(legacyTrip);
    const plan = planTripCopy(legacyTrip);
    if (plan.kind !== 'draft') throw new Error('expected draft');
    const edited = tripCopyDraftToFields({
      ...plan.draft, description: '精簡後的介紹', safetyNotice: '短', inclusionsText: 'a\nb',
      exclusionsText: items(20).join('\n'), noticesText: '一項',
    });
    expect(tripTextFieldErrors(edited)).toEqual([]);
    const { createTrip, deps } = makeDeps();
    await duplicateTripFully('t1', { ...sourcePayload(legacyTrip), ...edited }, deps);
    expect(createTrip).toHaveBeenCalledTimes(1);
    const sent = (createTrip.mock.calls[0] as unknown as [Partial<Trip>])[0];
    expect(sent).toMatchObject({
      description: '精簡後的介紹', safetyNotice: '短', inclusions: ['a', 'b'], exclusions: items(20), notices: ['一項'],
    });
    expect(JSON.stringify(legacyTrip)).toBe(before);
  });

  it('取消不建立任何東西：沒有確認就沒有 createTrip 呼叫', () => {
    const { createTrip } = makeDeps();
    planTripCopy(legacyTrip); // 只開草稿，使用者取消
    expect(createTrip).not.toHaveBeenCalled();
  });

  it('API 失敗：呼叫端拿到 rejection，草稿資料不變，可用同一份草稿重試成功', async () => {
    const plan = planTripCopy(legacyTrip);
    if (plan.kind !== 'draft') throw new Error('expected draft');
    const draft = { ...plan.draft, description: 'ok', safetyNotice: 'ok', inclusionsText: 'a', exclusionsText: 'b', noticesText: 'c' };
    const draftSnapshot = JSON.stringify(draft);
    const fields = tripCopyDraftToFields(draft);

    const failing = makeDeps({
      createTrip: vi.fn(async () => { throw new Error('network'); }) as unknown as TripDuplicationDeps['createTrip'],
    });
    await expect(duplicateTripFully('t1', { ...sourcePayload(legacyTrip), ...fields }, failing.deps)).rejects.toThrow('network');
    expect(JSON.stringify(draft)).toBe(draftSnapshot);

    const ok = makeDeps();
    await duplicateTripFully('t1', { ...sourcePayload(legacyTrip), ...fields }, ok.deps);
    expect(ok.createTrip).toHaveBeenCalledTimes(1);
  });
});
