/**
 * #748 Codex P1：舊行程相簿超過寫入上限（歷史超量資料）時，
 * 編輯頁只改標題也會因 `gallery` max 驗證 400；複製行程同理。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { MAX_TRIP_GALLERY_IMAGES, omitUnchangedGallery, clampGalleryForCopy } from '@/lib/trip-gallery';
import { updateTrip, duplicateTripFully, type TripDuplicationDeps } from '@/services/tours';
import { tripUpdateSchema } from '@/server/tour-domain';
import type { Trip } from '@/lib/types';

const urls = (n: number) => Array.from({ length: n }, (_, i) => `https://img.test/${i}.jpg`);
const trip = (gallery: string[]) => ({ id: 't1', title: '舊標題', galleryUrls: gallery } as unknown as Trip);

describe('編輯頁儲存：相簿未變更不送 gallery', () => {
  const legacy = urls(MAX_TRIP_GALLERY_IMAGES + 3);

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('未變更：payload 不含 gallery，其餘欄位照送，且 server schema 接受', async () => {
    let capturedBody: unknown = null;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const original = trip(legacy);
    await updateTrip('t1', omitUnchangedGallery({ ...original, title: '新標題' }, original));

    expect('gallery' in (capturedBody as Record<string, unknown>)).toBe(false);
    expect((capturedBody as Record<string, unknown>).title).toBe('新標題');
    expect(tripUpdateSchema.safeParse(capturedBody).success).toBe(true);
  });

  it('已變更：payload 含完整 gallery', async () => {
    let capturedBody: unknown = null;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const original = trip(urls(3));
    const next = [...urls(3), 'https://img.test/new.jpg'];
    await updateTrip('t1', omitUnchangedGallery({ ...original, galleryUrls: next }, original));

    expect((capturedBody as Record<string, unknown>).gallery).toEqual(next);
  });

  it('順序改變也視為變更', () => {
    const original = trip(urls(3));
    const out = omitUnchangedGallery({ ...original, galleryUrls: [...urls(3)].reverse() }, original);
    expect(out.galleryUrls).toBeDefined();
  });

  it('頁面 saveBasic 確實使用 omitUnchangedGallery', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/app/tenant/trips/[id]/page.tsx'), 'utf8');
    expect(page).toContain('updateTrip(tripId, omitUnchangedGallery(form, trip))');
  });
});

describe('複製行程：超量來源相簿截到上限', () => {
  it('clampGalleryForCopy 截到 MAX、不足不動、undefined 不動', () => {
    expect(clampGalleryForCopy(urls(12))).toEqual(urls(MAX_TRIP_GALLERY_IMAGES));
    expect(clampGalleryForCopy(urls(2))).toEqual(urls(2));
    expect(clampGalleryForCopy(undefined)).toBeUndefined();
  });

  it('duplicateTripFully 以截斷後相簿呼叫 createTrip，且前 MAX 張順序保留', async () => {
    const createTrip = vi.fn(async () => ({ id: 'new' } as unknown as Trip));
    const deps = {
      createTrip,
      listTripPlans: vi.fn(async () => []),
      listTripAddons: vi.fn(async () => []),
      saveTripPlan: vi.fn(),
      saveTripPlanSeason: vi.fn(),
      saveTripAddon: vi.fn(),
      deleteTrip: vi.fn(),
    } as unknown as TripDuplicationDeps;
    await duplicateTripFully('src', { title: 'x', galleryUrls: urls(12) }, deps);
    const sent = (createTrip.mock.calls[0] as unknown as [Partial<Trip>])[0];
    expect(sent.galleryUrls).toEqual(urls(MAX_TRIP_GALLERY_IMAGES));
  });
});
