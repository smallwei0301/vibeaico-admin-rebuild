/**
 * /tenant/trips 列表頁的寫入接線 — 單元測試（GitHub issue #8）
 * -----------------------------------------------------------------------------
 * 這一檔釘的是**五個原本只改頁面記憶體的操作**：發布、下架、申請 Midao 上架、
 * 刪除，以及「新增行程」（原本是一個空的 onClick，註解寫著「骨架：新增行程表單」）。
 *
 * 修改前的形狀（14 分冊 §1 根因 A）：
 *
 *   const doDelete = () => {
 *     setRows((prev) => prev.filter((r) => r.id !== deleteTarget.id));  ← 只動 state
 *     toast.show(t.messages.deleted);                                   ← 就宣告成功
 *   };
 *
 * 店家按下刪除、看到「行程已刪除」，**重新整理行程就回來了**。四個操作都是這個形狀。
 *
 * ⚠️ 值得記下來的是缺口有多小：`publishTrip` / `requestMidaoListing` / `deleteTrip` /
 * `createTrip` 四支 service **與它們的端點早就都在 `main` 上**（`src/services/tours.ts`、
 * `src/app/api/trips/**`）。缺的只有頁面這一層的呼叫。
 *
 * 所以斷言集中在三件事，而不是畫面長相：
 *   ① 每個 handler 真的呼叫對應的 service
 *   ② **成功之後才重讀清單**（不做樂觀更新——失敗時畫面會停在假狀態）
 *   ③ 失敗顯示後端真實訊息，且不關閉對話框（店家能重試）
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { tripsPage } from '@/i18n/zh-TW/pages/trips';

const ROOT = process.cwd();
const PAGE = 'src/app/tenant/trips/page.tsx';
const page = readFileSync(resolve(ROOT, PAGE), 'utf8');

/** 取出某個 handler 的函式主體（到下一個 `const ` 宣告為止） */
function handlerBody(name: string): string {
  const start = page.indexOf(`const ${name} =`);
  expect(start, `找不到 handler ${name}`).toBeGreaterThan(-1);
  const next = page.indexOf('\n  const ', start + 1);
  return page.slice(start, next > 0 ? next : undefined);
}

describe('四個寫入操作都真的打端點（不是只改 state）', () => {
  it('頁面從 @/services/tours 匯入四支寫入 service', () => {
    const m = page.match(/import\s*\{([^}]*)\}\s*from\s*'@\/services\/tours'/);
    expect(m, '頁面沒有從 @/services/tours 匯入').not.toBeNull();
    const names = m![1].split(',').map((x) => x.trim());
    for (const fn of ['createTrip', 'deleteTrip', 'publishTrip', 'requestMidaoListing']) {
      expect(names, `${fn} 沒有被匯入`).toContain(fn);
    }
  });

  it.each([
    ['togglePublish', 'publishTrip(trip.id, true)'],
    ['doUnpublish', 'publishTrip(unpublishTarget.id, false)'],
    ['doRequestMidao', 'requestMidaoListing(midaoTarget.id)'],
    ['doDelete', 'deleteTrip(deleteTarget.id)'],
    ['doCreate', 'createTrip('],
  ])('%s 呼叫 %s', (handler, call) => {
    expect(handlerBody(handler)).toContain(call);
  });

  it('**沒有任何 handler 還在用 setRows 直接偽造結果**', () => {
    for (const h of ['togglePublish', 'doUnpublish', 'doRequestMidao', 'doDelete', 'doCreate']) {
      expect(
        handlerBody(h),
        `${h} 仍然直接改 rows —— 那就是重整後會恢復舊狀態的假成功`,
      ).not.toContain('setRows(');
    }
  });

  it('「新增行程」的按鈕不再是空的 onClick', () => {
    expect(page).not.toContain('/* 骨架：新增行程表單 */');
    expect(page).toContain('onClick={() => void doCreate()}');
  });
});

describe('共用的 runAction：先成功、再重讀、失敗不騙人', () => {
  const body = handlerBody('runAction');

  it('成功之後才 await load()（不是樂觀更新）', () => {
    const awaitFn = body.indexOf('await fn();');
    const awaitLoad = body.indexOf('await load();');
    const toastOk = body.indexOf('toast.show(successMessage)');
    expect(awaitFn).toBeGreaterThan(-1);
    expect(awaitLoad, 'load() 不在 fn() 之後').toBeGreaterThan(awaitFn);
    expect(toastOk, '成功訊息不在 load() 之後').toBeGreaterThan(awaitLoad);
  });

  it('成功訊息在 try 內、catch 之前——失敗不得顯示成功', () => {
    const toastOk = body.indexOf('toast.show(successMessage)');
    const catchAt = body.indexOf('} catch');
    expect(catchAt).toBeGreaterThan(-1);
    expect(toastOk).toBeLessThan(catchAt);
  });

  it('失敗顯示後端真實訊息（ApiError.message），不是自己編一句', () => {
    expect(body).toContain('e instanceof ApiError ? e.message');
    expect(body).toContain('t.messages.actionFailedPrefix');
    expect(body).toContain("'danger'");
  });

  it('回傳成功與否，讓呼叫端決定要不要關對話框', () => {
    expect(body).toContain('return true;');
    expect(body).toContain('return false;');
  });
});

describe('失敗時對話框不關閉，店家可以重試', () => {
  it.each([
    ['doUnpublish', 'setUnpublishTarget(null)'],
    ['doRequestMidao', 'setMidaoTarget(null)'],
    ['doDelete', 'setDeleteTarget(null)'],
  ])('%s 只在成功時才清掉 target', (handler, clear) => {
    const body = handlerBody(handler);
    // 形狀必須是 `if (ok) setXxxTarget(null)`，不能無條件清掉
    expect(body).toMatch(new RegExp(`if\\s*\\(ok\\)\\s*${clear.replace(/[()]/g, '\\$&')}`));
  });
});

describe('文案', () => {
  it('失敗前綴與草稿標題都在字典裡（頁面不得寫死中文）', () => {
    expect(tripsPage.messages.actionFailedPrefix).toBeTruthy();
    expect(tripsPage.messages.untitled).toBeTruthy();
  });
});
