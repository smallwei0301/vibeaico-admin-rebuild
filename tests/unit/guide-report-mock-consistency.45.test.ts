/**
 * Issue #45：mock 模式下，報表數字與下鑽清單來自同一份訂單、同一個日期基準。
 * 預設區間（近 30 天）內報表各項計數，必須等於對應下鑽連結在訂單清單 mock 回傳的 totalElements。
 */
import { describe, expect, it } from 'vitest';
import { getGuideReport } from '@/services/reports';
import { listTourOrders, parseTourOrdersDeepLink } from '@/services/tours';
import {
  rangeLink, rankingLink, refundPendingLink, repeatCustomersLink, sourceLink,
} from '@/lib/guide-report-links';

const listFor = async (href: string) => {
  const dl = parseTourOrdersDeepLink(href.split('?')[1]);
  return listTourOrders({
    size: 100,
    status: dl.status, paymentStatus: dl.paymentStatus, source: dl.source, tripId: dl.tripId, planId: dl.planId,
    createdFrom: dl.createdFrom, createdTo: dl.createdTo, createdBefore: dl.createdBefore,
    ...(dl.activeOnly ? { activeOnly: '1' as const } : {}),
    ...(dl.repeatCustomers ? { repeatCustomers: '1' as const } : {}),
  });
};

describe('mock：報表與下鑽清單同一份資料', () => {
  it('預設區間：總數、各狀態、來源、退款處理中、行程／方案排行、重複旅客皆與清單筆數一致，且不是全 0', { timeout: 30000 }, async () => {
    const report = await getGuideReport({});
    const range = { ...report.range, asOf: report.asOf, timeZone: report.range.timeZone };

    expect(report.summary.totalOrders).toBeGreaterThan(0);
    expect((await listFor(rangeLink(range))).totalElements).toBe(report.summary.totalOrders);

    for (const st of ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'] as const) {
      expect((await listFor(rangeLink(range, st))).totalElements, st).toBe(report.summary.byStatus[st]);
    }
    expect((await listFor(refundPendingLink(range))).totalElements).toBe(report.summary.refundPendingCount);

    let sourceTotal = 0;
    for (const k of ['MIDAO', 'VIBEAI_SHOP', 'LINE', 'MANUAL'] as const) {
      const n = (await listFor(sourceLink(range, k))).totalElements;
      expect(n, k).toBe(report.summary.bySource[k].orders);
      sourceTotal += n;
    }
    expect(sourceTotal).toBeGreaterThan(0);

    for (const dim of ['trip', 'plan'] as const) {
      expect(report.ranking[dim].orders.length).toBeGreaterThan(0);
      for (const row of report.ranking[dim].orders) {
        const list = await listFor(rankingLink(range, dim, row.id, 'orders'));
        expect(list.totalElements, `${dim}/${row.id} 訂單數`).toBe(row.orders);
        expect(list.content.reduce((a, o) => a + o.partySize, 0), `${dim}/${row.id} 人數`).toBe(row.people);
      }
    }

    expect(report.repeat.repeatOrders).toBeGreaterThan(0);
    expect((await listFor(repeatCustomersLink(range))).totalElements).toBe(report.repeat.repeatOrders);
  });

  it('日期是相對今天算的（不是寫死的 2026-08）：最新種子訂單落在昨天', async () => {
    const report = await getGuideReport({});
    const list = await listTourOrders({ size: 100 });
    const newest = Math.max(...list.content.map((o) => Date.parse(o.createdAt)));
    expect(newest).toBeLessThan(Date.now());
    expect(Date.now() - newest).toBeLessThan(3 * 86400000);
    expect(report.range.days).toBe(30);
  });

  it('成團表現 mock：由 MOCK_TRIP_DEPARTURES 的成團狀態算出（相對今天的日期），預設區間非零且與手算一致', async () => {
    const f = (await getGuideReport({})).formation!;
    // 種子團次全部已過出發日：COLLECTING×3、REVIEW_REQUIRED×1 沒有成團決策紀錄 → undecidedPast 4（不是募集中、不是尚未結案）。
    // 種子團次：FORMED×5（dp_1、2、6、7、9；dp_6 已成團後因颱風取消，成團結果保留）、COLLECTING×3、REVIEW_REQUIRED×1、AT_RISK×1（dp_8，成團承諾未撤銷，計入已成團 → 已成團 6）；
    // 本期補充：mock_failed_1（已取消＋未成團＝導遊決策取消）、mock_cancel_1（已取消＋募集中，未經成團決策）；全部落在預設區間
    expect(f.summary.byStatus).toEqual({ COLLECTING: 0, FORMED: 5, REVIEW_REQUIRED: 0, AT_RISK: 1, FAILED: 1 });
    expect(f.summary).toMatchObject({
      total: 12, concluded: 7, formed: 6, formedAtRisk: 1, failed: 1, cancelledUndecided: 1, undecidedPast: 4, open: 0, successRatePercent: 85.7, failRatePercent: 14.3,
    });
    // 上一期補的 3 筆：FORMED×2、FAILED×1 → 66.7／33.3；差 +19.0／-19.0 個百分點
    expect(f.previous).toMatchObject({ concluded: 3, successRatePercent: 66.7, failRatePercent: 33.3 });
    expect(f.successRatePoints).toBe(19);
    expect(f.failRatePoints).toBe(-19);
  });
});
