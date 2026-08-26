import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bookingsPage } from '@/i18n/zh-TW/pages/bookings';

/**
 * issue #28 ②：`/pay/*` 路由不存在，但畫面曾經
 * 叫店家「複製付款連結傳給顧客」——顧客打開必然 404。
 *
 * 依擁有者裁決（補齊優先於刪除）：不建 `/pay` 頁，`payLinkOf`／`copyPayLink` 邏輯
 * 與相關文案不刪除，只是複製鈕停用、旁邊直接顯示「付款頁尚未建置（issue #32）」。
 *
 * ⚠️ 指向的 issue 改過一次：停用當下寫的是 #12（旅客 checkout），因為那時看起來
 * `/pay` 會由 #12 建出來。後來 #28 ⑩ 的執行者查證發現 #12 明確限定行程／團次訂單，
 * 一般預約與商品訂單的顧客端付款**沒有任何 issue 涵蓋**，因此另開了 #32。
 * 指錯 issue 的文案跟指錯的規格一樣會誤導下一個人，所以連同註解一起更正。
 *
 * 這份測試鎖住兩件事：
 *   1. 詳情 modal 的複製鈕在原始碼裡是 disabled、且鈕旁真的渲染了說明文字
 *      （不是只在 tooltip 或註解裡）——沒有元件渲染環境（無 jsdom／
 *      @testing-library/react），所以直接對原始碼做結構檢查；這樣寫的好處是
 *      這份測試會咬住「有人把 disabled 拿掉」或「把說明文字搬去別的地方」
 *      這兩種真實會發生的回歸，而不只是斷言某個字串存在。
 *   2. i18n 文案不再宣稱那是一個可付款的連結，但收現後「標記尾款已結清」這條
 *      真的可行的路仍然保留在文案裡。
 */

const PAGE_PATH = resolve(import.meta.dirname, '../../src/app/tenant/bookings/page.tsx');
const pageSource = readFileSync(PAGE_PATH, 'utf-8');

/** 抓出「複製付款連結」鈕所在的最小 JSX 區塊（含往前找到的 <Button 開頭與往後找到的 </Button>）。 */
function extractCopyPayLinkButton(source: string): string {
  const markerIdx = source.indexOf('t.rowActions.copyPayLink');
  if (markerIdx === -1) {
    throw new Error('找不到 copyPayLink 按鈕標籤的渲染位置（t.rowActions.copyPayLink）');
  }
  const openIdx = source.lastIndexOf('<Button', markerIdx);
  const closeIdx = source.indexOf('</Button>', markerIdx);
  if (openIdx === -1 || closeIdx === -1) {
    throw new Error('找不到包住 copyPayLink 標籤的完整 <Button>...</Button>');
  }
  return source.slice(openIdx, closeIdx + '</Button>'.length);
}

/** 鈕所在的整個外層 wrapper（往前抓一段固定範圍），用來確認說明文字渲染在鈕的旁邊。 */
function extractCopyPayLinkNeighborhood(source: string): string {
  const markerIdx = source.indexOf('t.rowActions.copyPayLink');
  if (markerIdx === -1) {
    throw new Error('找不到 copyPayLink 按鈕標籤的渲染位置（t.rowActions.copyPayLink）');
  }
  const closeIdx = source.indexOf('</Button>', markerIdx);
  return source.slice(Math.max(0, markerIdx - 300), closeIdx + 400);
}

describe('bookings 頁：付款連結鈕誠實化（issue #28 ②）', () => {
  it('detail modal 的「複製付款連結」鈕在原始碼裡是 disabled（真的不能再按）', () => {
    const button = extractCopyPayLinkButton(pageSource);
    expect(button).toMatch(/<Button\b[^>]*\bdisabled\b/);
  });

  it('鈕旁邊真的渲染了「payLinkUnavailable」說明文字，而不是只出現在註解或 tooltip', () => {
    const neighborhood = extractCopyPayLinkNeighborhood(pageSource);
    // 必須是被畫面渲染的 JSX 表達式 {t.detailModal.payLinkUnavailable}，
    // 不能只當作 title/aria-label 這種要 hover 才看得到的東西。
    expect(neighborhood).toContain('{t.detailModal.payLinkUnavailable}');
    expect(neighborhood).not.toMatch(/title=\{t\.detailModal\.payLinkUnavailable\}/);
  });

  it('payLinkOf／copyPayLink 邏輯仍保留在原始碼中，供 issue #32 完成後回頭啟用（不是刪除功能）', () => {
    expect(pageSource).toContain('const payLinkOf');
    expect(pageSource).toContain('const copyPayLink');
    expect(pageSource).toContain('navigator.clipboard.writeText(payLinkOf(b))');
  });

  it('i18n：detailModal.payLinkUnavailable 指向 issue #32，且不宣稱付款頁可用', () => {
    const msg = bookingsPage.detailModal.payLinkUnavailable;
    expect(msg).toMatch(/#32/);
    expect(msg).not.toMatch(/傳給顧客|可貼給顧客|可付款/);
  });

  /*
   * ⚠️ 前提變更（issue #35，非放寬斷言）：這條原本要求 balanceHint 指向
   * 「標記尾款已結清」。那顆鈕當時看得到，是因為它的顯示條件吃頁內假資料
   * `BOOKING_EXTRAS_*.paidAmount > 0`——我方沒有 `bookings.paid_amount`，
   * 判定不出「還有沒有尾款」。#35 把假資料拿掉之後，「標記尾款已結清」**沒有
   * 任何渲染路徑**，再叫店家去按它就變成第二個假的已知。
   *
   * 這條斷言當初防的是「文案指向一條走不通的路」（#28 ② 的 /pay 頁不存在）。
   * 那個意圖原封不動保留，只把「真的可行的那條路」的名字換成現在真的存在的
   * 「標記已線下收款」——不是為了讓測試變綠而放寬。
   */
  it('i18n：markPaidModal.balanceHint 不教店家用不存在的路（不提「複製付款連結」，也不提沒有渲染路徑的「標記尾款已結清」），而是指向真的按得到的「標記已線下收款」', () => {
    const msg = bookingsPage.markPaidModal.balanceHint;
    expect(msg).not.toContain('複製付款連結');
    expect(msg).not.toContain('標記尾款已結清');
    expect(msg).toContain('標記已線下收款');
  });

  /*
   * 原本這裡還有一條 `messages.addonDowngradePaid` 的斷言。rebase 到整合分支後
   * 發現該鍵已在 `742f33d`（修復-1B，issue #3）整組移除——加購那批文案上游早就
   * 誠實化過了，本輪的執行者是在一個 66 個 commit 前的基底上看到它的。
   * 鍵不存在，斷言就沒有意義；刪掉而不是留一條永遠比對 undefined 的測試。
   */

  it('i18n：payLinkCopied／payLinkIntro／copyPayLink 標籤保留未刪除（#32 完成後要回頭啟用）', () => {
    expect(bookingsPage.messages.payLinkCopied).toBeTruthy();
    expect(bookingsPage.markPaidModal.payLinkIntro).toBeTruthy();
    expect(bookingsPage.rowActions.copyPayLink).toBeTruthy();
  });
});
