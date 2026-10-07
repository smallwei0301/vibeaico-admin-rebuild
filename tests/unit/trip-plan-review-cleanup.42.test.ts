import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MOCK_TRIP_PLANS } from '@/mock/tours';
import { tripsPage } from '@/i18n/zh-TW/pages/trips';

// Issue #42：方案層級 reviewState/reviewNote 是 legacy（DB 無 trip_plans.review_state）。
// 真實審核真相只在 Trip 層 midaoListing / midaoListingNote。
const pageSrc = readFileSync(resolve(process.cwd(), 'src/app/tenant/trips/[id]/page.tsx'), 'utf8');

describe('Issue #42 方案審核欄位 legacy 清理', () => {
  it('trip 詳情頁不再讀取 plan.reviewState / reviewNote / REVIEW_TONE', () => {
    // 唯一允許：emptyPlan 為滿足 TripPlan 必填欄位而寫入的 legacy 預設值（非讀取）。
    expect(pageSrc).not.toMatch(/\.reviewState|\.reviewNote|REVIEW_TONE|PlanReviewState|pendingPlans/);
    expect(pageSrc.match(/reviewState/g)?.length).toBe(1);
    expect(pageSrc.match(/reviewNote/g)?.length).toBe(1);
  });
  it('不再引用已移除的方案審核 i18n key', () => {
    expect(pageSrc).not.toMatch(/plans\.columns\.review|plans\.review\.(NONE|PENDING|CHANGES_REQUESTED|pendingHint|changesHint|changesHintListed|noteLabel)/);
  });
  it('i18n 只保留 LISTED 唯讀提示用的 key', () => {
    expect(Object.keys(tripsPage.plans.review).sort()).toEqual(['listedReadonly', 'unavailable']);
    expect('review' in tripsPage.plans.columns).toBe(false);
  });
  it('Trip 層 midaoListing / midaoListingNote 仍在頁面呈現', () => {
    expect(pageSrc).toMatch(/trip\.midaoListingNote/);
    expect(pageSrc).toMatch(/listedPlanWritesBlocked = trip\?\.midaoListing === 'LISTED'/);
  });
  it('mock 方案一律 reviewState=NONE、reviewNote 為空', () => {
    expect(MOCK_TRIP_PLANS.length).toBeGreaterThan(0);
    for (const p of MOCK_TRIP_PLANS) {
      expect(p.reviewState, p.id).toBe('NONE');
      expect(p.reviewNote, p.id).toBe('');
    }
  });
});
