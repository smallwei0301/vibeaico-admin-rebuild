/**
 * #42 — updateTrip（mock 分支）真的寫回 MOCK_TRIPS（Codex P2：封面不再假成功）。
 * 不 mock env（預設 USE_MOCK=true）；測試自建行程，結束後清掉。
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Trip } from '@/lib/types';
import { ApiError } from '@/lib/api';
import { MOCK_TRIPS } from '@/mock/tours';
import { getTrip, listTrips, updateTrip } from '@/services/tours';

const IDS = ['t42u_none', 't42u_listed'];
const seed = (id: string, midaoListing: 'NONE' | 'LISTED') => {
  MOCK_TRIPS.push({ ...MOCK_TRIPS[0], id, midaoListing, title: 'orig', coverImageUrl: 'https://x/a.jpg' } as Trip);
};

afterEach(() => {
  for (let i = MOCK_TRIPS.length - 1; i >= 0; i -= 1) if (IDS.includes(MOCK_TRIPS[i].id)) MOCK_TRIPS.splice(i, 1);
});

describe('#42 updateTrip（mock 分支）', () => {
  it('更新封面後 getTrip／listTrips 都讀得到', async () => {
    seed('t42u_none', 'NONE');
    await expect(updateTrip('t42u_none', { coverImageUrl: 'https://x/b.jpg' })).resolves.toBeUndefined();
    expect((await getTrip('t42u_none'))?.coverImageUrl).toBe('https://x/b.jpg');
    const list = await listTrips();
    const rows = Array.isArray(list) ? list : ((list as { content?: Trip[] }).content ?? []);
    expect(rows.find((t) => t.id === 't42u_none')?.coverImageUrl).toBe('https://x/b.jpg');
  });

  it("移除封面（'') 會持久化", async () => {
    seed('t42u_none', 'NONE');
    await updateTrip('t42u_none', { coverImageUrl: '' });
    expect((await getTrip('t42u_none'))?.coverImageUrl).toBe('');
  });

  it('undefined 欄位不覆寫既有值', async () => {
    seed('t42u_none', 'NONE');
    await updateTrip('t42u_none', { title: 'new', coverImageUrl: undefined });
    const t = await getTrip('t42u_none');
    expect(t?.title).toBe('new');
    expect(t?.coverImageUrl).toBe('https://x/a.jpg');
  });

  it('LISTED 動封面 reject 409 且不變動', async () => {
    seed('t42u_listed', 'LISTED');
    const err = await updateTrip('t42u_listed', { coverImageUrl: '' }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((await getTrip('t42u_listed'))?.coverImageUrl).toBe('https://x/a.jpg');
  });

  it('LISTED 的非封面欄位仍可儲存（與 server 一致）', async () => {
    seed('t42u_listed', 'LISTED');
    await updateTrip('t42u_listed', { title: 'renamed' });
    expect((await getTrip('t42u_listed'))?.title).toBe('renamed');
  });

  it('未知 id reject 404', async () => {
    const err = await updateTrip('nope_t42u', { title: 'x' }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
  });
});
