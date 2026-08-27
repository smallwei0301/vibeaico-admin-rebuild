/**
 * 「假成功誠實化」不可回歸測試（GitHub issue #3 / 修復-1A）
 * -----------------------------------------------------------------------------
 * 對象：payment-methods、clinic-queue、donate、referrals 四頁。
 * 這四頁的後端都不存在（無 `src/app/api/**`、無對應的 `src/services/*` 寫入函式），
 * 所有互動都只改瀏覽器內的 React state。依 CLAUDE.md「Never fabricate a known」，
 * 頁面因此不得顯示成功訊息、不得自行把「已驗證／已開通」設為真、
 * 也不得宣稱對外做過任何事（例如「已 LINE 通知病患」）。
 *
 * ⚠️ 為什麼是「讀原始碼」而不是 render 測試：
 *    本專案沒有安裝 @testing-library/react，vitest 單元測試跑在 node 環境
 *    （vitest.config.mts: environment: 'node'），無法掛載 React 元件。
 *    這裡測的是「原始碼中不存在任何能把狀態設成已驗證的路徑」——
 *    是對不變條件的靜態證明，不是對某次 render 結果的抽樣。
 *    若哪天裝了 RTL，應再補一層互動層測試，但本層仍應保留。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { paymentMethodsPage } from '@/i18n/zh-TW/pages/payment-methods';
import { clinicQueuePage } from '@/i18n/zh-TW/pages/clinic-queue';
import { donatePage } from '@/i18n/zh-TW/pages/donate';
import { referralsPage } from '@/i18n/zh-TW/pages/referrals';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

const PAGES = {
  paymentMethods: 'src/app/tenant/payment-methods/page.tsx',
  clinicQueue: 'src/app/tenant/clinic-queue/page.tsx',
  donate: 'src/app/tenant/donate/page.tsx',
  referrals: 'src/app/tenant/referrals/page.tsx',
} as const;

/** 去掉註解，避免「解釋為什麼不能這樣寫」的註解被誤判成違規程式碼 */
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 把字典裡所有字串（含樣板函式的產出）攤平，方便對文案下斷言 */
const allStrings = (dict: unknown): string[] => {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') { out.push(value); return; }
    if (typeof value === 'function') {
      for (const arg of [1, 'X'] as const) {
        try { walk((value as (a: unknown) => unknown)(arg)); } catch { /* 參數型別不合就跳過 */ }
      }
      return;
    }
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (value && typeof value === 'object') { Object.values(value).forEach(walk); }
  };
  walk(dict);
  return out;
};

describe('修復-1A：後端不存在的四頁不得假成功', () => {
  describe('payment-methods（金流級假成功）', () => {
    const code = withoutComments(src(PAGES.paymentMethods));

    it('前端互動不可能把 gatewayVerified 設為 true', () => {
      /*
       * 舊實作：實刷測試按鈕的 onConfirm 直接
       *   setRows(list => list.map(m => m.id === testTarget.id
       *     ? { ...m, gatewayVerified: true } : m))
       * 店家會以為金流已開通而開始收單。整份頁面原始碼裡，
       * gatewayVerified 只允許出現在型別宣告與「= false」的資料上。
       */
      const assignments = [...code.matchAll(/gatewayVerified\s*:\s*([A-Za-z0-9_.]+)/g)]
        .map((m) => m[1]);
      expect(assignments.length).toBeGreaterThan(0);
      // 'boolean' 是 PaymentMethod 型別上的欄位宣告（恰好一處）；其餘一律是資料上的 false
      expect(assignments.filter((v) => v === 'boolean')).toHaveLength(1);
      expect(assignments.filter((v) => v !== 'false' && v !== 'boolean')).toEqual([]);
      expect(code).not.toMatch(/gatewayVerified\s*:\s*true/);
      expect(code).not.toMatch(/setGatewayVerified/);
    });

    it('實刷測試按下確定後只給「尚未執行」提示，不改任何一列資料', () => {
      const onConfirm = code.slice(code.indexOf('open={!!testTarget}'));
      const body = onConfirm.slice(onConfirm.indexOf('onConfirm='), onConfirm.indexOf('/>'));
      expect(body).toContain('t.notBuilt.testChargeNotAvailable');
      expect(body).not.toContain('setRows');
      expect(paymentMethodsPage.notBuilt.testChargeNotAvailable).toContain('尚未建置');
    });

    it('寫入動作（新增／編輯／刪除／啟停）一律顯示尚未生效，沒有成功訊息', () => {
      for (const key of ['savedNotEffective', 'deletedNotEffective', 'toggleNotEffective'] as const) {
        expect(code).toContain(`t.notBuilt.${key}`);
        expect(paymentMethodsPage.notBuilt[key]).toContain('尚未生效');
      }
      // 舊的成功文案已從字典移除，無法再被引用
      expect(Object.keys(paymentMethodsPage.messages)).not.toContain('created');
      expect(Object.keys(paymentMethodsPage.messages)).not.toContain('updated');
      expect(Object.keys(paymentMethodsPage.messages)).not.toContain('statusUpdated');
      expect(Object.keys(paymentMethodsPage.testCharge)).not.toContain('success');
    });

    it('頁面頂部有常駐的「尚未建置」Alert（不是一閃即逝的 toast）', () => {
      expect(code).toMatch(/<Alert[^>]*title=\{t\.notBuilt\.title\}/);
      expect(code).toContain('{t.notBuilt.body}');
      expect(code).toContain('{t.notBuilt.verifyBody}');
    });
  });

  describe('clinic-queue（謊報對外通知）', () => {
    const code = withoutComments(src(PAGES.clinicQueue));

    it('不再宣稱系統已通知病患（無任何「已／會通知」文案）', () => {
      for (const text of allStrings(clinicQueuePage)) {
        expect(text).not.toMatch(/系統(已|會)[^。]*通知/);
        expect(text).not.toMatch(/已(嘗試)?通知病患/);
        expect(text).not.toMatch(/收到取消通知/);
      }
      expect(Object.keys(clinicQueuePage.cancel)).not.toContain('successNotified');
      expect(Object.keys(clinicQueuePage.cancel)).not.toContain('notifyOk');
      expect(code).not.toContain('notifyOk');
      expect(code).not.toContain('successNotified');
    });

    it('取消掛號的確認與結果都明說不會通知病患', () => {
      expect(clinicQueuePage.notBuilt.cancelConfirm(7)).toContain('不會通知病患');
      expect(clinicQueuePage.notBuilt.cancelled(7)).toContain('未通知病患');
      expect(code).toContain('t.notBuilt.cancelConfirm(cancelTarget.queueNumber)');
      expect(code).toContain('t.notBuilt.cancelled(cancelTarget.queueNumber)');
    });

    it('所有寫入動作顯示尚未生效，舊的「已儲存／已刪除」成功文案已移除', () => {
      for (const key of [
        'sessionSaved', 'sessionDeleted', 'lockApplied', 'lockRestored',
      ] as const) {
        expect(code).toContain(`t.notBuilt.${key}`);
        expect(clinicQueuePage.notBuilt[key]).toContain('尚未生效');
      }
      expect(Object.keys(clinicQueuePage.messages)).not.toContain('saved');
      expect(Object.keys(clinicQueuePage.messages)).not.toContain('deleted');
      expect(Object.keys(clinicQueuePage.lockModal)).not.toContain('applied');
      expect(Object.keys(clinicQueuePage.lockModal)).not.toContain('restored');
    });

    it('頁面頂部有常駐的「尚未建置＋不會發通知」Alert', () => {
      expect(code).toMatch(/<Alert[^>]*title=\{t\.notBuilt\.title\}/);
      expect(code).toContain('{t.notBuilt.notifyBody}');
      expect(clinicQueuePage.notBuilt.notifyBody).toContain('不會發送');
    });
  });

  describe('donate（假送出後靜默關窗）', () => {
    const code = withoutComments(src(PAGES.donate));

    it('確認贊助只關窗＋誠實提示，不假裝已建立付款', () => {
      expect(code).toContain('t.notBuilt.submitNotEffective');
      expect(code).toContain('message={t.notBuilt.confirmMessage(');
      expect(donatePage.notBuilt.submitNotEffective).toContain('沒有產生任何付款');
      expect(donatePage.notBuilt.confirmMessage('NT$100')).toContain('尚未建置');
      // 舊確認文案宣稱「即將前往藍新金流付款頁面」，已從字典移除
      expect(Object.keys(donatePage.form)).not.toContain('confirmMessage');
    });

    it('頁面頂部有常駐的「尚未建置」Alert', () => {
      expect(code).toMatch(/<Alert[^>]*title=\{t\.notBuilt\.title\}/);
      expect(donatePage.notBuilt.body).toContain('不會建立訂單');
    });
  });

  describe('referrals（硬編碼假推薦碼）', () => {
    const code = withoutComments(src(PAGES.referrals));

    it('頁面不再有硬編碼推薦碼，也不再組出可分享的註冊連結', () => {
      expect(code).not.toMatch(/VIBE-[A-Z0-9]+-\d+/);
      expect(code).not.toContain('MOCK_REFERRAL_CODE');
      expect(code).not.toContain('/register?ref=');
      expect(code).not.toContain('line.me/R/msg/text');
      expect(Object.keys(referralsPage.code)).not.toContain('shareText');
    });

    it('推薦碼與連結顯示「尚未開通」，複製與分享按鈕停用', () => {
      expect(code).toContain('value={t.notBuilt.codeUnavailable}');
      expect(code).toContain('value={t.notBuilt.linkUnavailable}');
      expect(referralsPage.notBuilt.codeUnavailable).toBe('尚未開通');
      // 三顆按鈕（複製碼／複製連結／LINE 分享）都掛 disabled
      const disabledButtons = code.match(/<Button[^>]*\sdisabled/g) ?? [];
      expect(disabledButtons.length).toBeGreaterThanOrEqual(3);
      // 沒有任何複製成功 toast 可以再被顯示
      expect(code).not.toContain('clipboard.writeText');
      expect(Object.keys(referralsPage.messages)).not.toContain('codeCopied');
      expect(Object.keys(referralsPage.messages)).not.toContain('linkCopied');
    });
  });

  /* ==========================================================================
   * 修復-1A 補（調度者裁決 1–3）
   * ========================================================================== */

  describe('裁決 1：不得宣稱不存在的能力（與頁頂告示自相矛盾）', () => {
    it('clinic-queue 不再宣稱「病患已可在 LINE 自助掛號」', () => {
      const guide = Object.values(clinicQueuePage.guide).join('');
      expect(guide).not.toContain('已可在 LINE 自助掛號');
      expect(guide).not.toMatch(/病患已可/);
      expect(clinicQueuePage.guide.lineSelfServiceStrong).toContain('尚未建置');
    });

    it('clinic-queue 未填電話警告不再隱含「有填電話就會收到通知」', () => {
      const warning = clinicQueuePage.registerModal.noPhoneWarning;
      expect(warning).not.toContain('無法收到任何系統通知');
      expect(warning).toContain('系統不會發送任何通知');
    });

    it('donate 付款說明不再宣稱已可透過藍新金流付款', () => {
      const hint = donatePage.form.payHint;
      expect(hint).not.toContain('透過藍新金流安全付款');
      expect(hint).not.toMatch(/支援信用卡/);
      expect(hint).toContain('尚未接通');
    });
  });

  describe('裁決 2：似真的假數字一律改未知態', () => {
    it('donate 頁面原始碼裡沒有任何捏造的贊助金額', () => {
      const code = withoutComments(src(PAGES.donate));
      expect(code).not.toContain('MOCK_TOTAL_DONATED');
      expect(code).not.toContain('MOCK_MY_DONATED');
      expect(code).not.toContain('MOCK_DONORS');
      expect(code).not.toMatch(/48650|48,650/);
      // 統計值只能是字典裡的未知態，不能是任何數字字面量或格式化過的金額
      expect(code).toContain('{t.notBuilt.unknownValue}');
      expect(donatePage.notBuilt.unknownValue).toBe('--');
      const statValue = code.slice(code.indexOf('stat-value'), code.indexOf('stat-value') + 120);
      expect(statValue).toContain('t.notBuilt.unknownValue');
      expect(statValue).not.toContain('formatCurrency');
    });

    it('donate 贊助名單不放示範記錄（改誠實 EmptyState）', () => {
      const code = withoutComments(src(PAGES.donate));
      expect(code).toContain('rows={[] as Donor[]}');
      expect(code).toContain('title={t.notBuilt.donorsEmptyTitle}');
      // 舊 EmptyState 宣稱「還沒有贊助記錄」——那是沒查過就下的結論，已刪除
      expect(Object.keys(donatePage.donors)).not.toContain('emptyTitle');
      expect(Object.keys(donatePage.donors)).not.toContain('firstDonorCallout');
    });

    it('referrals 四張統計卡都是未知態，不由假記錄推算', () => {
      const code = withoutComments(src(PAGES.referrals));
      expect(code).not.toContain('MOCK_REFERRALS');
      expect(code).not.toContain('summary');
      expect(code).not.toContain('formatNumber');
      const cards = [...code.matchAll(/<StatCard[\s\S]*?\/>/g)].map((m) => m[0]);
      expect(cards).toHaveLength(4);
      for (const card of cards) {
        expect(card).toContain('value={t.notBuilt.unknownValue}');
      }
      expect(referralsPage.notBuilt.unknownValue).toBe('--');
    });

    it('referrals 推薦歷史改誠實 EmptyState，沒有任何示範記錄', () => {
      const code = withoutComments(src(PAGES.referrals));
      expect(code).toContain('const rows: ReferralRecord[] = [];');
      expect(code).toContain('title={t.notBuilt.historyEmptyTitle}');
      expect(referralsPage.notBuilt.historyEmptyDescription).toContain('尚未建置');
      // 舊 EmptyState 宣稱「還沒有推薦記錄」＋「雙方各獲得 500 點」，已刪除
      expect(Object.keys(referralsPage)).not.toContain('empty');
    });
  });

  describe('裁決 3：實刷測試按鈕不得承諾結果，且必須停用', () => {
    it('按鈕標籤不再承諾「開通」', () => {
      expect(paymentMethodsPage.actions.testCharge).not.toContain('開通');
      expect(paymentMethodsPage.actions.testCharge).not.toContain('實刷測試並');
    });

    it('實刷測試按鈕為 disabled，並用 title 說明原因', () => {
      const code = withoutComments(src(PAGES.paymentMethods));
      const button = code.slice(code.indexOf('t.actions.testCharge') - 260,
        code.indexOf('t.actions.testCharge'));
      expect(button).toContain('<Button');
      expect(button).toContain('disabled');
      expect(button).toContain('title={t.notBuilt.testChargeDisabledHint}');
      expect(paymentMethodsPage.notBuilt.testChargeDisabledHint).toContain('尚未建置');
    });
  });

  describe('裁決 4：referrals 不得以現在式承諾獎勵（那是對店家的金錢承諾）', () => {
    /** 允許談獎勵的前提：句子本身要標明這是規劃中／尚未上線的規則 */
    const PLANNED = /規劃中|尚未上線|上線前|以上線時公告/;

    it('機制說明標明規劃中，並明說目前推薦不會發放任何點數', () => {
      expect(referralsPage.explain.label).toMatch(PLANNED);
      expect(referralsPage.explain.strong).toContain('不會發放任何點數');
      const explain = Object.values(referralsPage.explain).join('');
      // 舊承諾句型（「…完成首次儲值後，雙方各獲得 500 點獎勵」）不得再出現
      expect(explain).not.toMatch(/後，雙方各獲得 500 點獎勵/);
      expect(explain).toMatch(PLANNED);
    });

    it('字典裡任何談到獎勵發放的句子都帶有「規劃中／尚未上線」標記', () => {
      /*
       * 只掃「肯定會發獎勵」的句子：長度 >= 15（排除「累計獲得點數」這類欄位標籤），
       * 且出現肯定語氣的發獎措辭。純否認句（「不會發放任何點數」）本身就是誠實化的
       * 結果，不需要再帶標記，所以用 (?<!不) 把它排除在掃描之外。
       * 反之「（註冊當下尚不會發放）」這種夾在承諾句裡的免責不算數 ——
       * 舊文案就是靠它看起來有免責，整句實際上仍是現在式承諾，必須被抓到。
       */
      const AWARD_CLAIM = /(各|即可|將|可)獲得|獲得 \d+ 點|(?<!不)會發放/;
      const sentences = allStrings(referralsPage)
        .filter((text) => text.length >= 15 && AWARD_CLAIM.test(text));
      expect(sentences.length).toBeGreaterThan(0);
      for (const sentence of sentences) {
        expect(sentence, sentence).toMatch(PLANNED);
      }
    });

    it('頁頂告示不再自稱「示範資料」（統計已改未知態、歷史已改空表）', () => {
      expect(referralsPage.notBuilt.body).not.toContain('示範資料');
      expect(referralsPage.notBuilt.body).toContain('未知態');
      expect(donatePage.notBuilt.body).not.toContain('示範資料');
      expect(donatePage.notBuilt.body).toContain('未知態');
    });
  });

  it('四頁都沒有 setTimeout 假延遲（假延遲讓假成功看起來像真的在跑）', () => {
    for (const path of Object.values(PAGES)) {
      expect(src(path), path).not.toContain('setTimeout');
    }
  });

  it('四個頁面元件都沒有中文字面量文案（新文案一律進 i18n 字典）', () => {
    /*
     * 唯一允許的例外是 `const MOCK_… = […]` 示範資料區塊（CLAUDE.md 明文允許
     * page-local mock，且業務風味字串本來就必須是中文）。其餘任何一行含中文
     * 都代表文案沒有進 i18n 字典。
     */
    const cjk = /[一-鿿]/;
    for (const [name, path] of Object.entries(PAGES)) {
      const lines = withoutComments(src(path)).split('\n');
      let inMock = false;
      const offenders: [number, string][] = [];
      lines.forEach((line, i) => {
        if (/^const MOCK_/.test(line)) inMock = true;
        else if (inMock && /^(\]|\});/.test(line)) inMock = false;
        else if (!inMock && cjk.test(line)) offenders.push([i + 1, line]);
      });
      expect(offenders, `${name} 有非 i18n 的中文字面量`).toEqual([]);
    }
  });
});
