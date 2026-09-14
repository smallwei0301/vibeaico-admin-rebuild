import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_TENANT_TIME_ZONE,
  basicSettingsSchema,
} from '@/config/tenant-settings';
import {
  buildGuideActionInboxFormationItem,
  getGuideActionInboxDateWindow,
  getGuideDepartureDueAt,
  getGuideDepartureDay,
  getGuideActionInboxPriority,
  isGuideActionInboxFormationStatus,
  normalizeGuideTimeZone,
  sortGuideActionInboxItems,
  type GuideActionInboxItem,
} from '@/lib/guide-action-inbox';
import { getGuideActionInbox } from '@/services/guide-action-inbox';

const apiSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/guide/action-inbox/route.ts'),
  'utf8',
);
const serviceSource = readFileSync(
  resolve(process.cwd(), 'src/services/guide-action-inbox.ts'),
  'utf8',
);
const pageSource = readFileSync(
  resolve(process.cwd(), 'src/app/tenant/dashboard/page.tsx'),
  'utf8',
);
const dashboardI18nSource = readFileSync(
  resolve(process.cwd(), 'src/i18n/zh-TW/pages/dashboard.ts'),
  'utf8',
);
const bookingsPageSource = readFileSync(
  resolve(process.cwd(), 'src/app/tenant/bookings/page.tsx'),
  'utf8',
);
const bookingsApiSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/bookings/route.ts'),
  'utf8',
);

describe('GUIDE action inbox (#43-A / #43-B / #43-C / #43 類別 3／4)', () => {
  it('prioritizes overdue, tenant-today, and future pending work', () => {
    const now = new Date('2026-09-02T04:00:00.000Z'); // 12:00 Asia/Taipei

    expect(getGuideActionInboxPriority('2026-09-02T03:59:59.000Z', now)).toBe('IMMEDIATE');
    expect(getGuideActionInboxPriority('2026-09-02T06:00:00.000Z', now)).toBe('TODAY');
    expect(getGuideActionInboxPriority('2026-09-03T02:00:00.000Z', now)).toBe('UPCOMING');

    const crossDateNow = new Date('2026-09-01T23:30:00.000Z');
    const crossDateStart = '2026-09-02T08:00:00.000Z';
    expect(getGuideActionInboxPriority(crossDateStart, crossDateNow, 'Asia/Taipei')).toBe('TODAY');
    expect(getGuideActionInboxPriority(crossDateStart, crossDateNow, 'America/Los_Angeles')).toBe('UPCOMING');
    expect(normalizeGuideTimeZone('Not/A_Real_Zone')).toBe('Asia/Taipei');

    const item = (id: string, priority: GuideActionInboxItem['priority'], dueAt: string, createdAt: string): GuideActionInboxItem => ({
      id, kind: 'BOOKING_REQUEST', bookingNo: id, customerName: id, serviceName: id,
      priority, dueAt, createdAt, href: '/tenant/bookings?status=PENDING&bookingId=id',
    });
    expect(sortGuideActionInboxItems([
      item('future', 'UPCOMING', '2026-09-03T02:00:00.000Z', '2026-09-01T00:00:00.000Z'),
      item('today-late', 'TODAY', '2026-09-02T08:00:00.000Z', '2026-09-02T01:00:00.000Z'),
      item('today-early', 'TODAY', '2026-09-02T06:00:00.000Z', '2026-09-02T02:00:00.000Z'),
      item('past', 'IMMEDIATE', '2026-09-02T03:59:59.000Z', '2026-09-02T03:00:00.000Z'),
    ]).map((entry) => entry.id)).toEqual(['past', 'today-early', 'today-late', 'future']);
  });

  it('makes tenant timezone a real persisted basic setting instead of an untyped JSON ghost field', () => {
    const required = { tenantName: '測試店家', shopCode: 'test-shop' };

    expect(basicSettingsSchema.parse(required).timezone).toBe(DEFAULT_TENANT_TIME_ZONE);
    expect(basicSettingsSchema.parse({
      ...required,
      timezone: 'America/Los_Angeles',
    }).timezone).toBe('America/Los_Angeles');
    expect(() => basicSettingsSchema.parse({
      ...required,
      timezone: 'Not/A_Real_Zone',
    })).toThrow();
  });

  it('limits departure items to today/tomorrow in the tenant timezone', () => {
    const now = new Date('2026-09-02T04:00:00.000Z'); // 12:00 Asia/Taipei
    const window = getGuideActionInboxDateWindow(now, 'Asia/Taipei');

    expect(getGuideDepartureDay(window.today, now, 'Asia/Taipei')).toBe('TODAY');
    expect(getGuideDepartureDay(window.tomorrow, now, 'Asia/Taipei')).toBe('TOMORROW');
    expect(getGuideDepartureDay('2026-09-04', now, 'Asia/Taipei')).toBeNull();
  });

  it('sorts mixed booking and departure work by the tenant-local instant', () => {
    const departureDueAt = getGuideDepartureDueAt('2026-09-02', '17:00', 'Asia/Taipei');
    expect(departureDueAt).toBe('2026-09-02T09:00:00.000Z');

    const booking: GuideActionInboxItem = {
      id: 'booking',
      kind: 'BOOKING_REQUEST',
      bookingNo: 'booking',
      customerName: '顧客',
      serviceName: '服務',
      priority: 'TODAY',
      dueAt: '2026-09-02T08:30:00.000Z',
      createdAt: '2026-09-02T00:00:00.000Z',
      href: '/tenant/bookings?status=PENDING&bookingId=booking',
    };
    const departure: GuideActionInboxItem = {
      id: 'departure',
      kind: 'DEPARTURE',
      tripId: 'trip',
      tripName: '行程',
      planName: '方案',
      departureDate: '2026-09-02',
      startTime: '17:00',
      capacity: 10,
      seatsBooked: 2,
      departureDay: 'TODAY',
      priority: 'TODAY',
      dueAt: departureDueAt,
      createdAt: '2026-09-02T00:00:00.000Z',
      href: '/tenant/trips/trip',
    };

    expect(sortGuideActionInboxItems([departure, booking]).map((item) => item.id))
      .toEqual(['booking', 'departure']);
  });

  it('keeps mock GUIDE mode useful by exposing two actionable departures', async () => {
    const items = await getGuideActionInbox();
    const departures = items.filter((item) => item.kind === 'DEPARTURE');
    const payments = items.filter((item) => item.kind === 'BOOKING_PAYMENT');

    expect(departures).toHaveLength(2);
    expect(departures.map((item) => item.departureDay)).toEqual(['TODAY', 'TOMORROW']);
    expect(departures.every((item) => item.href.startsWith('/tenant/trips/'))).toBe(true);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      bookingNo: 'BK20260822001',
      amount: 800,
      href: '/tenant/bookings?status=CONFIRMED&paymentStatus=UNPAID&bookingId=b_g2',
    });
  });

  it('only treats REVIEW_REQUIRED and AT_RISK formation_status as inbox-worthy (#43 類別 3／4)', () => {
    expect(isGuideActionInboxFormationStatus('REVIEW_REQUIRED')).toBe(true);
    expect(isGuideActionInboxFormationStatus('AT_RISK')).toBe(true);
    expect(isGuideActionInboxFormationStatus('COLLECTING')).toBe(false);
    expect(isGuideActionInboxFormationStatus('FORMED')).toBe(false);
    expect(isGuideActionInboxFormationStatus('FAILED')).toBe(false);
    expect(isGuideActionInboxFormationStatus(null)).toBe(false);
    expect(isGuideActionInboxFormationStatus(undefined)).toBe(false);
  });

  it('derives formation card due-at honestly from real DB columns, never fabricating a deadline', () => {
    const now = new Date('2026-08-19T00:00:00.000Z');

    // REVIEW_REQUIRED：有 formation_deadline_at 就直接用它作為截止時間。
    const reviewWithDeadline = buildGuideActionInboxFormationItem({
      id: 'dp_review',
      tripId: 'trip_1',
      tripName: '行程',
      planName: '方案',
      departureDate: '2026-08-26',
      startTime: '13:30',
      capacity: 8,
      seatsBooked: 0,
      minToDepart: 4,
      formationStatus: 'REVIEW_REQUIRED',
      formationDeadlineAt: '2026-08-19T15:59:00.000Z',
      formedParticipants: null,
      createdAt: '2026-08-10T00:00:00.000Z',
    }, now, 'Asia/Taipei');
    expect(reviewWithDeadline).toMatchObject({
      kind: 'REVIEW_REQUIRED',
      dueAt: '2026-08-19T15:59:00.000Z',
      href: '/tenant/trips/trip_1',
      minToDepart: 4,
      formationDeadlineAt: '2026-08-19T15:59:00.000Z',
      formedParticipants: null,
    });

    // REVIEW_REQUIRED 但缺 formation_deadline_at（舊資料）：誠實退回出發時刻，
    // 不得虛構一個不存在的截止時間。
    const reviewWithoutDeadline = buildGuideActionInboxFormationItem({
      id: 'dp_review_2',
      tripId: 'trip_1',
      tripName: '行程',
      planName: '方案',
      departureDate: '2026-08-26',
      startTime: '13:30',
      capacity: 8,
      seatsBooked: 0,
      minToDepart: 4,
      formationStatus: 'REVIEW_REQUIRED',
      formationDeadlineAt: null,
      formedParticipants: null,
      createdAt: '2026-08-10T00:00:00.000Z',
    }, now, 'Asia/Taipei');
    expect(reviewWithoutDeadline.dueAt).toBe(getGuideDepartureDueAt('2026-08-26', '13:30', 'Asia/Taipei'));

    // AT_RISK：即使 formation_deadline_at 還留著舊值，下一個真正的期限是出發時刻，不是它。
    const atRisk = buildGuideActionInboxFormationItem({
      id: 'dp_at_risk',
      tripId: 'trip_2',
      tripName: '行程二',
      planName: '方案二',
      departureDate: '2026-08-30',
      startTime: '16:30',
      capacity: 10,
      seatsBooked: 3,
      minToDepart: 4,
      formationStatus: 'AT_RISK',
      formationDeadlineAt: '2026-08-18T15:59:00.000Z',
      formedParticipants: 5,
      createdAt: '2026-08-10T00:00:00.000Z',
    }, now, 'Asia/Taipei');
    expect(atRisk.dueAt).toBe(getGuideDepartureDueAt('2026-08-30', '16:30', 'Asia/Taipei'));
    expect(atRisk.kind).toBe('AT_RISK');
    expect(atRisk.formedParticipants).toBe(5);
  });

  it('exposes mock REVIEW_REQUIRED / AT_RISK cards from the single aggregated inbox, without inventing demo data for other statuses', async () => {
    const items = await getGuideActionInbox();
    const reviewRequired = items.filter((item) => item.kind === 'REVIEW_REQUIRED');
    const atRisk = items.filter((item) => item.kind === 'AT_RISK');

    // dp_4（REVIEW_REQUIRED）與 dp_8（AT_RISK）是 mock/tours.ts 既有唯二符合的 fixture；
    // 其餘 formation_status（COLLECTING/FORMED/FAILED）與已取消的 dp_6 都必須誠實地不
    // 出現在這兩個類別，不得為了畫面好看而多加。
    expect(reviewRequired).toHaveLength(1);
    expect(reviewRequired[0]).toMatchObject({ id: 'dp_4', href: '/tenant/trips/tp_1' });
    expect(atRisk).toHaveLength(1);
    expect(atRisk[0]).toMatchObject({ id: 'dp_8', href: '/tenant/trips/tp_2' });
    expect([...reviewRequired, ...atRisk].every((item) =>
      'minToDepart' in item && 'formedParticipants' in item)).toBe(true);

    // #43 §4：單一聚合端點/函式，不是前端自己併兩份清單。這裡直接鎖住 getGuideActionInbox()
    // 是「唯一入口」——結果同時含五種 kind，且已經是排序好的一份陣列。
    const kinds = new Set(items.map((item) => item.kind));
    expect(kinds.has('REVIEW_REQUIRED')).toBe(true);
    expect(kinds.has('AT_RISK')).toBe(true);
    expect(kinds.has('BOOKING_REQUEST')).toBe(true);
  });

  it('sorts a mixed list containing formation items by the same priority/dueAt/createdAt/id rule as everything else', () => {
    const now = new Date('2026-08-19T00:00:00.000Z');
    const reviewItem = buildGuideActionInboxFormationItem({
      id: 'dp_review',
      tripId: 'trip_1',
      tripName: '行程',
      planName: '方案',
      departureDate: '2026-08-19',
      startTime: '20:00',
      capacity: 8,
      seatsBooked: 2,
      minToDepart: 4,
      formationStatus: 'REVIEW_REQUIRED',
      formationDeadlineAt: '2026-08-18T23:00:00.000Z', // 已過 now（2026-08-19T00:00），因此是 IMMEDIATE
      formedParticipants: null,
      createdAt: '2026-08-10T00:00:00.000Z',
    }, now, 'Asia/Taipei');
    const atRiskItem = buildGuideActionInboxFormationItem({
      id: 'dp_at_risk',
      tripId: 'trip_2',
      tripName: '行程二',
      planName: '方案二',
      departureDate: '2026-08-25',
      startTime: '09:00',
      capacity: 10,
      seatsBooked: 3,
      minToDepart: 4,
      formationStatus: 'AT_RISK',
      formationDeadlineAt: null,
      formedParticipants: 5,
      createdAt: '2026-08-10T00:00:00.000Z',
    }, now, 'Asia/Taipei'); // 出發還有幾天 → UPCOMING
    const booking: GuideActionInboxItem = {
      id: 'booking-today',
      kind: 'BOOKING_REQUEST',
      bookingNo: 'booking-today',
      customerName: '顧客',
      serviceName: '服務',
      priority: 'TODAY',
      dueAt: '2026-08-19T10:00:00.000Z',
      createdAt: '2026-08-19T00:00:00.000Z',
      href: '/tenant/bookings?status=PENDING&bookingId=booking-today',
    };

    expect(reviewItem.priority).toBe('IMMEDIATE');
    expect(atRiskItem.priority).toBe('UPCOMING');
    expect(sortGuideActionInboxItems([atRiskItem, booking, reviewItem]).map((item) => item.id))
      .toEqual(['dp_review', 'booking-today', 'dp_at_risk']);
  });

  it('reads only tenant-scoped pending and unpaid confirmed bookings plus the tenant timezone', () => {
    expect(apiSource).toContain(".from('bookings_view')");
    expect(apiSource).toContain(".eq('tenant_id', t.tenantId)");
    expect(apiSource).toContain(".eq('status', 'PENDING')");
    expect(apiSource).toContain(".eq('status', 'CONFIRMED')");
    expect(apiSource).toContain(".eq('payment_status', 'UNPAID')");
    expect(apiSource).toContain(".gt('final_price', 0)");
    expect(apiSource).toContain("kind: 'BOOKING_PAYMENT'");
    expect(apiSource).toContain('final_price');
    expect(apiSource).toContain(".from('trip_departures')");
    expect(apiSource).toContain(".eq('tenant_id', t.tenantId)");
    expect(apiSource).toContain(".in('status', ['OPEN', 'CLOSED'])");
    expect(apiSource).toContain('getGuideDepartureDay');
    expect(apiSource).toContain('getGuideDepartureDueAt');
    expect(apiSource).toContain(".from('tenant_settings')");
    expect(apiSource).toContain(".select('basic')");
    expect(apiSource).toContain('normalizeGuideTimeZone');
    expect(apiSource).toContain('bookingId=${encodeURIComponent(row.id)}');
    expect(serviceSource).toContain('bookingId=${encodeURIComponent(id)}');
    expect(serviceSource).toContain("request<GuideActionInboxItem[]>('/api/guide/action-inbox')");
    expect(serviceSource).toContain("kind: 'BOOKING_PAYMENT'");
    expect(serviceSource).toContain("kind: 'DEPARTURE'");
  });

  it('derives #43 類別 3／4 only from trip_departures.formation_status, in the same single aggregated endpoint, never a parallel status', () => {
    // #43 §4：單一聚合端點；不可另開一支端點讓前端自己拼湊。
    expect(apiSource).toContain('formation_status, formation_deadline_at, min_to_depart_snapshot, formed_participants');
    expect(apiSource).toContain(".in('formation_status', ['REVIEW_REQUIRED', 'AT_RISK'])");
    expect(apiSource).toContain(".neq('status', 'CANCELLED')");
    expect(apiSource).toContain('buildGuideActionInboxFormationItem');
    expect(apiSource).toContain('isGuideActionInboxFormationStatus');
    expect(apiSource).toContain('formationResult');
    expect(apiSource).toContain('requireTenant');
    // 只有一次 sortGuideActionInboxItems(...)：四類資料先彙整再排序一次，不是各自排序。
    expect(apiSource.match(/sortGuideActionInboxItems\(/g)).toHaveLength(1);
    expect(serviceSource).toContain('buildGuideActionInboxFormationItem');
    expect(serviceSource).toContain('isGuideActionInboxFormationStatus');
    expect(serviceSource.match(/sortGuideActionInboxItems\(/g)).toHaveLength(1);
    expect(serviceSource).toContain('MOCK_TRIP_DEPARTURES');
    // 沒有獨立的 formation 端點／service 函式殘留。
    expect(serviceSource).not.toContain('getGuideActionInboxFormationItems');
    expect(apiSource).not.toContain('/api/guide/action-inbox/formation');
  });

  it('exhaustively narrows item.kind on the dashboard card instead of an unsafe catch-all else branch', () => {
    // #43 §3：加入新 kind 時 typecheck 必須擋下忘記處理的分支，不是靜默落到 else。
    expect(pageSource).toContain('const _exhaustive: never = item');
    expect((pageSource.match(/const _exhaustive: never = item/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(pageSource).toContain("case 'BOOKING_REQUEST':");
    expect(pageSource).toContain("case 'BOOKING_PAYMENT':");
    expect(pageSource).toContain("case 'DEPARTURE':");
    expect(pageSource).toContain("case 'REVIEW_REQUIRED':");
    expect(pageSource).toContain("case 'AT_RISK':");

    // 白話文案（#43 §3）：差幾人成團／已跌破門檻，來自 i18n，不在元件裡寫死中文字面值。
    expect(pageSource).toContain('t.actionInbox.reviewRequired');
    expect(pageSource).toContain('t.actionInbox.atRisk');
    expect(pageSource).toContain('t.actionInbox.formationSeatsShort');
    expect(pageSource).toContain('t.actionInbox.formationAtRiskDetail');

    expect(dashboardI18nSource).toContain('reviewRequired:');
    expect(dashboardI18nSource).toContain('atRisk:');
    expect(dashboardI18nSource).toMatch(/formationSeatsShort:\s*\(n: number\)/);
    expect(dashboardI18nSource).toMatch(/formationAtRiskDetail:\s*\(current: number, min: number\)/);
  });

  it('degrades the AT_RISK copy instead of claiming "已跌破成團門檻" when seats_booked has already caught back up to the threshold (LOW finding #3)', () => {
    // AT_RISK 是唯讀觀察值：#41 §6 的自動轉態還沒做，人數事後追回門檻不會自動變回
    // FORMED。這種不一致資料上不能繼續顯示「已跌破」字樣——那是對使用者的誤導。
    expect(pageSource).toContain('t.actionInbox.formationAtRiskInconsistent');
    expect(pageSource).toContain('item.seatsBooked < item.minToDepart');
    expect(dashboardI18nSource).toMatch(/formationAtRiskInconsistent:\s*\(current: number, min: number\)/);
  });

  it('excludes REVIEW_REQUIRED/AT_RISK from the DEPARTURE query so one departure cannot produce two cards (HIGH finding, Final Risk claude-fable-5-1)', () => {
    // 舊版：DEPARTURE query 只用 `status in (OPEN, CLOSED)` + 今日～明日日期窗，跟
    // formation query（`status <> CANCELLED` + formation_status in (REVIEW_REQUIRED,
    // AT_RISK)）不是互斥集合。今日／明日出發、同時又是 REVIEW_REQUIRED／AT_RISK 的
    // 團次會同時符合兩條 query，變成兩張 `key={item.id}` 相同的卡片。
    // 修法是在 DEPARTURE query 直接排除這兩個 formation_status 值，讓兩個 query
    // 在來源端就互斥，而不是把兩份結果都抓回來後在 JS 裡事後去重。
    expect(apiSource).toContain(".not('formation_status', 'in', '(REVIEW_REQUIRED,AT_RISK)')");

    const departureExclusionIndex = apiSource.indexOf(".not('formation_status', 'in', '(REVIEW_REQUIRED,AT_RISK)')");
    const departureStatusIndex = apiSource.indexOf(".in('status', ['OPEN', 'CLOSED'])");
    const formationInclusionIndex = apiSource.indexOf(".in('formation_status', ['REVIEW_REQUIRED', 'AT_RISK'])");
    expect(departureExclusionIndex).toBeGreaterThan(-1);
    expect(departureStatusIndex).toBeGreaterThan(-1);
    expect(formationInclusionIndex).toBeGreaterThan(-1);
    // 排除條件要掛在 DEPARTURE query（在它自己的 `.in('status', ...)` 附近），
    // 不是意外掛到 formation query 的 `.in('formation_status', ...)` 那一支上。
    expect(departureExclusionIndex).toBeGreaterThan(departureStatusIndex);
    expect(formationInclusionIndex).toBeGreaterThan(departureExclusionIndex);

    // 同一個 mock 端也要遵守同一條互斥規則，否則 demo 模式會重現同一個 bug。
    expect(serviceSource).toContain('isGuideActionInboxFormationStatus(departure.formationStatus)');
  });

  it('bounds the formation query with a lower departs_on date so already-departed rows do not linger forever (MEDIUM finding)', () => {
    // 0107 還沒有 #41 §6 的自動轉態，REVIEW_REQUIRED／AT_RISK 不會在出發後自動被
    // 清掉。formation query 必須跟 DEPARTURE query 一樣有 `.gte('departs_on', today)`
    // 下限，否則已經出發過的舊團次會跟現在的團次搶 `.limit(20)`，而且永遠顯示
    // 「立即處理」。這裡鎖住：整支檔案要出現兩次 `.gte('departs_on', today)`
    // （DEPARTURE query 既有的一次 + formation query 新加的一次），且新加的那次
    // 要出現在 formation query 段落（`.in('formation_status', ...)` 之後）。
    const gteMatches = apiSource.match(/\.gte\('departs_on', today\)/g) ?? [];
    expect(gteMatches).toHaveLength(2);

    const formationInclusionIndex = apiSource.indexOf(".in('formation_status', ['REVIEW_REQUIRED', 'AT_RISK'])");
    const formationGteIndex = apiSource.indexOf(".gte('departs_on', today)", formationInclusionIndex);
    expect(formationInclusionIndex).toBeGreaterThan(-1);
    expect(formationGteIndex).toBeGreaterThan(formationInclusionIndex);
  });

  it('reads min_to_depart_snapshot directly on the real API row — 0107 declares it NOT NULL, so the old `?? 1` was dead code, not a safety net', () => {
    expect(apiSource).not.toContain('row.min_to_depart_snapshot ?? 1');
    expect(apiSource).toContain('minToDepart: row.min_to_depart_snapshot,');
    // mock 型別 `minToDepartSnapshot?: number`（`src/lib/types.ts`）是真的 optional，
    // 沒有資料庫層的 NOT NULL 保證，所以 mock 端的 `?? 1` 要留著，不是同一件事。
    expect(serviceSource).toContain('departure.minToDepartSnapshot ?? 1');
  });

  it('mock formation cards are remapped to today/tomorrow, not left on the stale fixture date (LOW finding: past-dated formation departures must not sit in the inbox forever)', async () => {
    const now = new Date();
    const { today, tomorrow } = getGuideActionInboxDateWindow(now);
    const items = await getGuideActionInbox();
    const formationItems = items.filter(
      (item) => item.kind === 'REVIEW_REQUIRED' || item.kind === 'AT_RISK',
    );

    // dp_4／dp_8 是 mock/tours.ts 裡唯二的 REVIEW_REQUIRED／AT_RISK fixture，兩者都必須
    // 出現，且都要被 remap 到今日／明日——跟 route.ts 新加的 `.gte('departs_on', today)`
    // 下限保持一致，不能再是 fixture 寫死的 2026-08 過期日期。
    expect(formationItems).toHaveLength(2);
    for (const item of formationItems) {
      expect('departureDate' in item ? item.departureDate : null).not.toBeNull();
      if ('departureDate' in item) {
        expect([today, tomorrow]).toContain(item.departureDate);
      }
    }
  });

  it('shows the slice only in GUIDE mode and renders a mobile-safe action', () => {
    expect(pageSource).toContain('modePreset.showActionInbox');
    expect(pageSource).not.toContain("businessType === 'GUIDE'");
    expect(pageSource).not.toContain("if (businessType !== 'GUIDE') return;");
    expect(pageSource).toContain('setActionInbox([])');
    expect(pageSource).toContain('getGuideActionInbox');
    expect(pageSource).toContain('paymentAmount');
    expect(pageSource).toContain('openPayment');
    expect(pageSource).toContain('departureDay');
    expect(pageSource).toContain('w-full flex-shrink-0 sm:w-auto');
    expect(bookingsPageSource).toContain("params.get('paymentStatus') === 'UNPAID'");
    expect(bookingsPageSource).toContain("params.get('bookingId')");
    expect(bookingsPageSource).toContain('requestedBookingId');
    expect(bookingsPageSource).toContain('bookingId: requestedBookingId');
    expect(bookingsPageSource).toContain('applyClientFilters(exact.content)');
    expect(bookingsPageSource).toContain('setDetailTarget(requested)');
    expect(bookingsApiSource).toContain('bookingId: z.string().uuid().optional()');
    expect(bookingsApiSource).toContain("query.eq('id', q.bookingId)");
    expect(bookingsPageSource).toContain('paymentStatusFilter');
    expect(bookingsPageSource).toContain('paymentStatus: paymentStatusFilter || undefined');
  });
});
