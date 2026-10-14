// Issue #968 — 列表列的 REQUEST＋PENDING 申請直接可接受／婉拒，且不再顯示易誤按的取消。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPendingTourRequest } from '@/lib/tour-order-payment-actions';
import { tourOrdersPage as t } from '@/i18n/zh-TW/pages/tour-orders';

const src = readFileSync(resolve(__dirname, '../../src/app/tenant/tour-orders/page.tsx'), 'utf8');
const actionsCol = src.slice(src.indexOf("key: 'actions'"), src.indexOf('return (\n    <>'));

describe('#968 判斷', () => {
  it('REQUEST＋PENDING 才是待處理申請；INSTANT／已確認不是', () => {
    expect(isPendingTourRequest({ salesMode: 'REQUEST', status: 'PENDING' })).toBe(true);
    expect(isPendingTourRequest({ salesMode: 'INSTANT', status: 'PENDING' })).toBe(false);
    expect(isPendingTourRequest({ salesMode: 'REQUEST', status: 'CONFIRMED' })).toBe(false);
  });
});

describe('#968 列表 actions 欄', () => {
  it('待處理申請列顯示接受／婉拒（title 與 aria-label），取消在其 else 分支', () => {
    expect(actionsCol).toContain('isPendingTourRequest(o)');
    expect(actionsCol).toContain('title={t.actions.accept} aria-label={t.actions.accept}');
    expect(actionsCol).toContain('title={t.actions.reject} aria-label={t.actions.reject}');
    const reqIdx = actionsCol.indexOf('isPendingTourRequest(o)');
    const cancelIdx = actionsCol.indexOf('t.actions.cancel');
    const elseIdx = actionsCol.indexOf(": o.status === 'PENDING' || o.status === 'CONFIRMED'");
    expect(reqIdx).toBeGreaterThan(-1);
    expect(elseIdx).toBeGreaterThan(reqIdx);
    expect(cancelIdx).toBeGreaterThan(elseIdx);
  });
  it('婉拒走既有 reject ConfirmModal（原因 Textarea）；接受開啟詳情的保留時數區塊', () => {
    expect(actionsCol).toContain("setAction({ kind: 'reject', order: o })");
    expect(actionsCol).toContain('setFocusRequest(true); setDetail(o)');
    expect(src).toContain('ref={requestSectionRef}');
    expect(src).toContain('acceptRequest(detail)');
  });
  it('文案來自 i18n、頁面無新增中文字面量', () => {
    expect(t.actions.accept).toBeTruthy();
    expect(t.actions.reject).toBeTruthy();
    expect(/[一-鿿]/.test(actionsCol.replace(/\/\*[\s\S]*?\*\//g, ''))).toBe(false);
  });
});
