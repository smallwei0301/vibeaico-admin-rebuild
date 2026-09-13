/**
 * issue #27 ②③ 的接線與文案不可回歸測試
 * -----------------------------------------------------------------------------
 * 這一輪修的是兩處「畫面宣稱通知了顧客，後端一則都沒發」：
 *   ② `PUT /api/bookings/:id` 全檔沒有任何 notify import，頁面卻寫死
 *      「預約已更新，已發送通知給顧客」——MODIFIED 是五個 kind 裡唯一沒人呼叫的。
 *   ③ 手動建單的「LINE 通知顧客消費明細」勾選框可勾、送出後 toast 把標籤原句
 *      重播一次，而 `POST /api/product-orders/manual` 只扣庫存建單，零通知。
 *
 * 純函式的內容驗證在 product-order-receipt.27.test.ts；本檔守的是**接線本身**與
 * **文案不得再度說謊**，跑起來不碰網路/DB（12 分冊 §3）。整合測試（真的打端點、
 * 驗 mock LINE/Resend 收到什麼）見 tests/integration/api/*.27.test.ts。
 *
 * ⚠️ 為什麼是「讀原始碼」：本專案沒裝 @testing-library/react，單元測試跑 node
 *    環境無法掛載元件——同 honest-not-built-interactions.test.ts 的既有作法，
 *    這裡證明的是「原始碼中存在該接線、且不存在會說謊的文案」。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { bookingsPage } from '@/i18n/zh-TW/pages/bookings';
import { productOrdersPage } from '@/i18n/zh-TW/pages/product-orders';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

/** 去掉註解：解釋「以前是這樣寫、現在不可以」的註解不該被當成違規程式碼 */
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const FILES = {
  bookingPutRoute: 'src/app/api/bookings/[id]/route.ts',
  bookingsPage: 'src/app/tenant/bookings/page.tsx',
  bookingsService: 'src/services/bookings.ts',
  manualOrderRoute: 'src/app/api/product-orders/manual/route.ts',
  productOrdersPage: 'src/app/tenant/product-orders/page.tsx',
  productsService: 'src/services/products.ts',
  lineNotify: 'src/server/line-notify.ts',
} as const;

describe('② PUT /api/bookings/:id 真的呼叫 notifyBookingStatus(..., MODIFIED)', () => {
  it('端點 import 並以 fire-and-forget（void，不 await）呼叫 MODIFIED 推播', () => {
    const code = withoutComments(src(FILES.bookingPutRoute));

    // 接線存在：import + 呼叫
    expect(code).toMatch(/import\s*\{[^}]*notifyBookingStatus[^}]*\}\s*from\s*'@\/server\/line-notify'/);
    expect(code).toMatch(/void\s+notifyBookingStatus\([^)]*'MODIFIED'\)/);

    // 06 分冊 §5 規約：不得 await（推播慢或失敗不可拖垮 API 回應）
    expect(code).not.toMatch(/await\s+notifyBookingStatus/);
  });

  it('推播只在「時間或服務人員」有變時觸發，改備註不觸發', () => {
    const code = withoutComments(src(FILES.bookingPutRoute));

    // 要能比對，就必須把現值一起讀出來（只讀 duration_minutes 是修好前的樣子）
    expect(code).toMatch(/select\('id, duration_minutes, start_at, staff_id'\)/);
    expect(code).toMatch(/notifyTriggered\s*=\s*true/);
    // 備註那一行後面不得把 notifyTriggered 設成 true
    const noteLine = code.split('\n').find((l) => l.includes('update.note = b.note'));
    expect(noteLine).toBeTruthy();
    expect(noteLine).not.toMatch(/notifyTriggered\s*=\s*true/);
    // 回應要把結果帶回頁面，頁面才有辦法照實顯示
    expect(code).toMatch(/return ok\(\{\s*notifyTriggered\s*\}\)/);
  });

  /**
   * ⚠️ 這三條在移植回 main 時**放寬成斷言性質、不再比對原分支的識別字**。
   *
   * ② 在 main 上其實已經完整落地，只是命名與文案跟那條未合併的分支不同：
   * service 用 `UpdateBookingResult` 型別別名而非 inline 物件型別、頁面用
   * `onSaved(result)` 回呼而非 `res?.notifyTriggered ? … : …` 三元式、
   * i18n 叫 `updatedWithoutNotification` 而非 `updatedNoNotify`。
   *
   * 三者行為完全等價。為了讓測試通過而去改 main 上一段能動的程式碼與文案，
   * 只是把另一條分支的用字強加上去，不是修好任何東西——所以改的是測試。
   */
  it('service 層把 notifyTriggered 透傳給頁面，mock 分支誠實回 false', () => {
    const code = withoutComments(src(FILES.bookingsService));
    // 回傳型別必須帶 notifyTriggered（inline 物件型別或具名別名都可）
    expect(code).toMatch(/notifyTriggered\s*:\s*boolean/);
    // mock 分支必須回 false —— mock 模式沒有任何推播管道，回 true 就是假的已知
    expect(code).toMatch(/\(\)\s*=>\s*\(\{\s*notifyTriggered:\s*false\s*\}\)/);
  });

  it('頁面依 notifyTriggered 分岔顯示，不再寫死同一句', () => {
    const code = withoutComments(src(FILES.bookingsPage));
    const branch = code.match(/notifyTriggered\s*\?\s*t\.messages\.(\w+)\s*:\s*t\.messages\.(\w+)/);
    expect(branch, '頁面沒有依 notifyTriggered 分岔顯示成功訊息').not.toBeNull();
    // 兩個分支必須是**不同**的文案，否則分岔等於沒做
    expect(branch![1]).not.toBe(branch![2]);
  });

  it('文案不得再宣稱「已發送通知給顧客」這種無條件的事實主張', () => {
    const { updated } = bookingsPage.messages;
    const noNotify = bookingsPage.messages.updatedWithoutNotification;
    // 修好前的原句；只要它回來，這條就紅
    expect(updated).not.toBe('預約已更新，已發送通知給顧客');
    // 有觸發時不得宣稱顧客已收到 —— 推播是 fire-and-forget，回應當下無從得知
    expect(updated).not.toMatch(/顧客已收到|已通知顧客/);
    // 沒觸發時不得出現任何「已送出／已通知」的字樣
    expect(noNotify).toMatch(/未觸發|未送出|未通知/);
    expect(noNotify).not.toMatch(/已發送|已通知|已送出/);
  });
});

describe('③ 手動建單的「LINE 通知顧客消費明細」勾選框真的有後端', () => {
  it('端點收 notifyCustomer 並呼叫 notifyProductOrderReceipt，結果回在 notify', () => {
    const code = withoutComments(src(FILES.manualOrderRoute));
    expect(code).toMatch(/notifyCustomer:\s*z\.boolean\(\)/);
    expect(code).toMatch(/import\s*\{[\s\S]*?notifyProductOrderReceipt[\s\S]*?\}\s*from\s*'@\/server\/line-notify'/);
    expect(code).toMatch(/await notifyProductOrderReceipt\(t\.tenantId, order\.id\)/);
    // 沒勾 → 'NONE'（不做也不謊稱做了）
    expect(code).toMatch(/:\s*'NONE'/);
    expect(code).toMatch(/return ok\(\{ id: order\.id, orderNo: order\.order_no, notify \}\)/);
  });

  it('通知模組照標籤規則分流：LINE 優先、未綁 LINE 改寄 Email、只有 LINE 扣額度', () => {
    const code = withoutComments(src(FILES.lineNotify));
    // LINE 分支：綁定才走，扣 1 額度後推播
    expect(code).toMatch(/if \(customer\.line_user_id\)/);
    expect(code).toMatch(/consumePushQuota\(tenantId, 1\)/);
    expect(code).toMatch(/return 'QUOTA_EXCEEDED'/);
    // Email 分支：在 LINE 分支之後（＝未綁定才會走到），且不碰額度
    const lineBranch = code.indexOf('if (customer.line_user_id)');
    const emailCall = code.indexOf('sendProductOrderReceiptEmail(email');
    const quotaCall = code.indexOf('consumePushQuota(tenantId, 1)');
    expect(lineBranch).toBeGreaterThan(-1);
    expect(emailCall).toBeGreaterThan(lineBranch);
    expect(quotaCall).toBeLessThan(emailCall);   // 扣額度只發生在 email 之前的 LINE 分支
    // 信沒寄出去（沒設 key／Resend 回錯）不得報成 'EMAIL'
    expect(code).toMatch(/result === 'SENT' \? 'EMAIL' : 'FAILED'/);
  });

  /**
   * 變異測試補上的一條：把 `consumePushQuota` 也搬進 Email 分支時，上面那條
   * 「LINE 優先、未綁 LINE 改寄 Email」的斷言仍然全綠 —— 它守的是分流，不是額度。
   * 而「每則扣 1 推播額度」在勾選框標籤上是**寫給店家看的計費承諾**：Email 也扣
   * 就是多收一則額度，店家永遠不會知道。整合測試有驗，但那要跑真實 DB；
   * 這一條讓它在單元層就紅。
   */
  it('推播額度只在 LINE 分支扣，Email 分支一則都不扣', () => {
    const code = withoutComments(src(FILES.lineNotify));
    const fn = code.slice(code.indexOf('export async function notifyProductOrderReceipt'));
    const body = fn.slice(0, fn.indexOf('\n}'));

    const calls = body.match(/consumePushQuota\(/g) ?? [];
    expect(calls.length, 'consumePushQuota 在這支函式裡只能出現一次').toBe(1);

    // 那一次必須在 linePush 之前（＝LINE 分支內），且在取 email 之前就結束
    const iQuota = body.indexOf('consumePushQuota(');
    const iPush = body.indexOf('linePush(');
    const iEmail = body.indexOf('customer.email');
    expect(iPush, '找不到 linePush').toBeGreaterThan(-1);
    expect(iEmail, '找不到 Email 分支').toBeGreaterThan(-1);
    expect(iQuota, '扣額度必須在 LINE 推播之前').toBeLessThan(iPush);
    expect(iQuota, '扣額度不得落在 Email 分支').toBeLessThan(iEmail);
  });

  it('service 層把勾選框與結果都接上，mock 分支誠實回 NONE', () => {
    const code = withoutComments(src(FILES.productsService));
    expect(code).toMatch(/notifyCustomer\?:\s*boolean/);
    expect(code).toMatch(/notify:\s*ProductOrderNotifyOutcome/);
    expect(code).toMatch(/notify:\s*'NONE'/);
  });

  it('頁面把勾選框送到後端，並依實際結果顯示，不再重播勾選框標籤', () => {
    const code = withoutComments(src(FILES.productOrdersPage));
    expect(code).toMatch(/notifyCustomer:\s*notify/);
    expect(code).toMatch(/NOTIFY_TOAST\[created\.notify\]/);
    // 修好前的那一行：把標籤原句當成功訊息重播
    expect(code).not.toMatch(/toast\.show\(t\.manual\.notify/);
  });

  it('六種結果各有一句只描述實際發生過的事的文案', () => {
    const r = productOrdersPage.messages.notifyResult;
    expect(r.line).toContain('LINE');
    expect(r.email).toMatch(/Email/);
    expect(r.email).toMatch(/不扣/);                    // email 不扣推播額度
    expect(r.noContact).toMatch(/未送出/);
    expect(r.quotaExceeded).toMatch(/未送出/);
    expect(r.failed).toMatch(/失敗|未送出/);
    // 沒有任何一句是把勾選框標籤照抄回來
    for (const message of Object.values(r)) {
      expect(message).not.toBe(productOrdersPage.manual.notify);
    }
  });

  /**
   * 14 分冊 §8.10（全站通則）：推播／簡訊／email 之後的成功訊息只能宣稱
   * 「已送出」，不得宣稱「已通知」「顧客已收到」。理由是技術天花板——LINE 回 200
   * 只代表 LINE 收下了。這一條守本 issue 動到的兩個 i18n 檔。
   */
  it('§8.10：成功訊息只講「送出」，不講「已通知顧客／顧客已收到」', () => {
    const claims = [
      productOrdersPage.messages.notifyResult.line,
      productOrdersPage.messages.notifyResult.email,
      bookingsPage.messages.updated,
      bookingsPage.messages.updatedWithoutNotification,
    ];
    for (const message of claims) {
      expect(message).not.toMatch(/已通知|已收到|已發送通知/);
    }
    // 真的送出去的那兩句，必須明講「送出」
    expect(productOrdersPage.messages.notifyResult.line).toContain('送出');
    expect(productOrdersPage.messages.notifyResult.email).toContain('送出');
    // main 的預約文案講的是「已觸發 LINE 通知流程」——同樣不宣稱顧客收到了，
    // 只是用「觸發」而非「送出」描述同一件事，§8.10 的要求一樣成立。
    expect(bookingsPage.messages.updated).toMatch(/已送出|已觸發/);
  });
});
