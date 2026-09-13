/**
 * issue #259：行程詳情頁那五個「編輯得到、卻存不進去」的欄位。
 *
 * 這支測試要證明的不是「畫面上有輸入框」，也不是「migration 裡有 add column」——
 * 那兩件事都可以在欄位其實沒被寫入時成立（PB-027）。這裡走完整的 HTTP 來回：
 * 送出值 → 重新讀回來 → 值還在。只有這樣才算「真的存住了」。
 *
 * 需要共用 TEST reset/seed lane，CI 以 TEST_VALIDATION holder 序列化。
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

interface TripView {
  id: string;
  tagline: string;
  meetingPointMapUrl: string;
  exclusions: string[];
  notices: string[];
  refundPolicyType: string;
}

async function json<T>(response: Response): Promise<Envelope<T>> {
  return (await response.json()) as Envelope<T>;
}

let ownerA: AuthedApi;

/** `GET /api/trips/:id` 回的是 `{ trip, plans }`，不是 trip 本身。 */
async function getTrip(id: string): Promise<TripView> {
  const response = await ownerA.get(`/api/trips/${id}`);
  expect(response.status).toBe(200);
  const body = await json<{ trip: TripView }>(response);
  expect(body.data?.trip, 'GET /api/trips/:id 沒有回 trip').toBeTruthy();
  return body.data!.trip;
}

beforeAll(async () => {
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
});

describe('trips 展示欄位真的持久化（#259）', () => {
  it('PUT 寫進去的五個欄位，重新 GET 還在', async () => {
    const created = await ownerA.post('/api/trips', { title: `display-${randomUUID()}` });
    expect(created.status).toBe(200);
    const tripId = (await json<{ id: string }>(created)).data!.id;

    const tagline = `一句話說完這趟 ${randomUUID().slice(0, 8)}`;
    const mapUrl = 'https://maps.example.com/?q=25.033,121.565';
    const exclusions = ['個人旅平險', '自費行程'];
    const notices = ['請攜帶身分證件', '雨天照常出發'];

    const updated = await ownerA.put(`/api/trips/${tripId}`, {
      tagline,
      meetingPointMapUrl: mapUrl,
      exclusions,
      notices,
      refundPolicyType: 'FLEXIBLE',
    });
    expect(updated.status).toBe(200);

    // 關鍵：不看 PUT 的回應，重新讀一次——回應可以是把送進來的東西原樣吐回。
    const trip = await getTrip(tripId);
    expect(trip.tagline, 'tagline 沒有存住').toBe(tagline);
    expect(trip.meetingPointMapUrl, 'meetingPointMapUrl 沒有存住').toBe(mapUrl);
    expect(trip.exclusions, 'exclusions 沒有存住').toEqual(exclusions);
    expect(trip.notices, 'notices 沒有存住').toEqual(notices);
    expect(trip.refundPolicyType, 'refundPolicyType 沒有存住').toBe('FLEXIBLE');
  });

  it('建立時就帶上的五個欄位一樣存得住（不是只有 PUT 那條路）', async () => {
    const created = await ownerA.post('/api/trips', {
      title: `display-create-${randomUUID()}`,
      tagline: '建立當下就帶進來的一句話',
      meetingPointMapUrl: 'https://maps.example.com/?q=24.147,120.673',
      exclusions: ['小費'],
      notices: ['集合遲到不等人'],
      refundPolicyType: 'STRICT',
    });
    expect(created.status).toBe(200);
    const tripId = (await json<{ id: string }>(created)).data!.id;

    const trip = await getTrip(tripId);
    expect(trip.tagline).toBe('建立當下就帶進來的一句話');
    expect(trip.meetingPointMapUrl).toBe('https://maps.example.com/?q=24.147,120.673');
    expect(trip.exclusions).toEqual(['小費']);
    expect(trip.notices).toEqual(['集合遲到不等人']);
    expect(trip.refundPolicyType).toBe('STRICT');
  });

  it('沒帶這五個欄位的舊呼叫維持原樣（既有列不因 0089 改變行為）', async () => {
    const created = await ownerA.post('/api/trips', { title: `display-default-${randomUUID()}` });
    const tripId = (await json<{ id: string }>(created)).data!.id;
    const trip = await getTrip(tripId);
    expect(trip.tagline).toBe('');
    expect(trip.meetingPointMapUrl).toBe('');
    expect(trip.exclusions).toEqual([]);
    expect(trip.notices).toEqual([]);
    expect(trip.refundPolicyType).toBe('STANDARD');
  });

  it('不在列舉內的退費規則被擋下來，不會寫進資料庫', async () => {
    const created = await ownerA.post('/api/trips', { title: `display-bad-${randomUUID()}` });
    const tripId = (await json<{ id: string }>(created)).data!.id;

    const bad = await ownerA.put(`/api/trips/${tripId}`, { refundPolicyType: 'WHATEVER' });
    expect(bad.status, '任意字串被接受了，check 約束或 zod 有一邊沒守住').toBe(400);
    expect((await json(bad)).code).toBe('REQ_001');

    const trip = await getTrip(tripId);
    expect(trip.refundPolicyType).toBe('STANDARD');
  });
});
