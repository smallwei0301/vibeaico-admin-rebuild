/**
 * tests/unit/line-setup-wizard.47.test.ts
 * -----------------------------------------------------------------------------
 * 守 `src/lib/line-setup-wizard.ts`（Issue #47 開通精靈的純邏輯層）：
 *
 *   1. `deriveStartingStep` 必須依「真實 verify 結果」重建進度，而不是憑空猜測
 *      ——這是任務要求的「重新整理要能反映真實 provider 狀態」的核心保證。
 *   2. `canAdvanceFromStep` 必須擋住「檢查沒過還能跳下一步」。
 *   3. `stepStatus` / `allVerifiableChecksPassed` 必須把 AUTO_REPLY 的 INFO
 *      跟六項可查證檢查的 PASS/FAIL 分開算，永遠不能把 INFO 算成失敗。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  allVerifiableChecksPassed, canAdvanceFromStep, credentialsConfigured,
  deriveStartingStep, stepAfterVerifyRetry, stepStatus, type VerifyCheck,
} from '@/lib/line-setup-wizard';

function check(key: string, status: 'PASS' | 'FAIL' | 'INFO', message = ''): VerifyCheck {
  return { key, status, pass: status === 'PASS', message };
}

const ALL_PASS: VerifyCheck[] = [
  check('CREDENTIALS', 'PASS'),
  check('TOKEN', 'PASS'),
  check('ID_SECRET_PAIR', 'PASS'),
  check('BOT_MODE', 'PASS'),
  check('WEBHOOK', 'PASS'),
  check('WEBHOOK_TEST', 'PASS'),
  check('AUTO_REPLY', 'INFO'),
];

describe('credentialsConfigured', () => {
  it('三項都要有才算已設定', () => {
    expect(credentialsConfigured({ channelId: true, channelSecret: true, channelAccessToken: true })).toBe(true);
    expect(credentialsConfigured({ channelId: true, channelSecret: false, channelAccessToken: true })).toBe(false);
  });
});

describe('deriveStartingStep — 用真實 verify 結果重建進度', () => {
  it('憑證沒填齊 → 一律回到步驟一，即使帶了 checks', () => {
    expect(deriveStartingStep(
      { channelId: false, channelSecret: true, channelAccessToken: true },
      ALL_PASS,
    )).toBe('CREDENTIALS_INPUT');
  });

  it('憑證填齊但還沒 verify 過（checks === null）→ 停在步驟一等 verify', () => {
    expect(deriveStartingStep(
      { channelId: true, channelSecret: true, channelAccessToken: true },
      null,
    )).toBe('CREDENTIALS_INPUT');
  });

  it('CREDENTIALS/TOKEN/ID_SECRET_PAIR 任一 FAIL → 停在 CONNECTION', () => {
    const checks = ALL_PASS.map((c) => (c.key === 'TOKEN' ? check('TOKEN', 'FAIL', 'Token 失效') : c));
    expect(deriveStartingStep({ channelId: true, channelSecret: true, channelAccessToken: true }, checks))
      .toBe('CONNECTION');
  });

  it('BOT_MODE 或 WEBHOOK FAIL → 停在 BOT_MODE_WEBHOOK', () => {
    const checks = ALL_PASS.map((c) => (c.key === 'WEBHOOK' ? check('WEBHOOK', 'FAIL', '未開啟') : c));
    expect(deriveStartingStep({ channelId: true, channelSecret: true, channelAccessToken: true }, checks))
      .toBe('BOT_MODE_WEBHOOK');
  });

  it('WEBHOOK_TEST FAIL → 停在 WEBHOOK_TEST', () => {
    const checks = ALL_PASS.map((c) => (c.key === 'WEBHOOK_TEST' ? check('WEBHOOK_TEST', 'FAIL', '測試失敗') : c));
    expect(deriveStartingStep({ channelId: true, channelSecret: true, channelAccessToken: true }, checks))
      .toBe('WEBHOOK_TEST');
  });

  it('六項全過 → 停在 AUTO_REPLY_CONFIRM（每次重開都值得再提醒，因為系統查不到真實狀態）', () => {
    expect(deriveStartingStep({ channelId: true, channelSecret: true, channelAccessToken: true }, ALL_PASS))
      .toBe('AUTO_REPLY_CONFIRM');
  });
});

describe('canAdvanceFromStep — 擋住「檢查沒過還能跳下一步」', () => {
  it('CONNECTION 沒全過不能往下一步', () => {
    const checks = ALL_PASS.map((c) => (c.key === 'CREDENTIALS' ? check('CREDENTIALS', 'FAIL') : c));
    expect(canAdvanceFromStep('CONNECTION', checks)).toBe(false);
    expect(canAdvanceFromStep('CONNECTION', ALL_PASS)).toBe(true);
  });

  it('BOT_MODE_WEBHOOK 沒全過不能往下一步', () => {
    const checks = ALL_PASS.map((c) => (c.key === 'BOT_MODE' ? check('BOT_MODE', 'FAIL') : c));
    expect(canAdvanceFromStep('BOT_MODE_WEBHOOK', checks)).toBe(false);
  });

  it('WEBHOOK_TEST 沒過不能往下一步', () => {
    const checks = ALL_PASS.map((c) => (c.key === 'WEBHOOK_TEST' ? check('WEBHOOK_TEST', 'FAIL') : c));
    expect(canAdvanceFromStep('WEBHOOK_TEST', checks)).toBe(false);
  });

  it('AUTO_REPLY_CONFIRM／CAPABILITIES／DONE 一律不擋路（人工確認與能力摘要不是硬性關卡）', () => {
    expect(canAdvanceFromStep('AUTO_REPLY_CONFIRM', null)).toBe(true);
    expect(canAdvanceFromStep('CAPABILITIES', null)).toBe(true);
    expect(canAdvanceFromStep('DONE', null)).toBe(true);
  });
});

describe('stepStatus / allVerifiableChecksPassed — INFO 永不算失敗', () => {
  it('AUTO_REPLY_CONFIRM 一律回報 INFO，不是 PASS 也不是 FAIL', () => {
    expect(stepStatus('AUTO_REPLY_CONFIRM', ALL_PASS)).toBe('INFO');
  });

  it('allVerifiableChecksPassed 只看六項可查證檢查，AUTO_REPLY 的 INFO 不影響結果', () => {
    expect(allVerifiableChecksPassed(ALL_PASS)).toBe(true);
    const withFail = ALL_PASS.map((c) => (c.key === 'WEBHOOK' ? check('WEBHOOK', 'FAIL') : c));
    expect(allVerifiableChecksPassed(withFail)).toBe(false);
  });

  it('checks 為 null 時一律回報尚未檢查／未通過', () => {
    expect(stepStatus('CONNECTION', null)).toBe('NOT_CHECKED');
    expect(allVerifiableChecksPassed(null)).toBe(false);
  });
});


describe('incomplete verification fails closed', () => {
  it.each(['CREDENTIALS', 'TOKEN', 'ID_SECRET_PAIR', 'BOT_MODE', 'WEBHOOK', 'WEBHOOK_TEST'])('missing %s cannot complete', (key) => {
    const partial = ALL_PASS.filter((c) => c.key !== key);
    expect(allVerifiableChecksPassed(partial)).toBe(false);
    const expected = ['CREDENTIALS', 'TOKEN', 'ID_SECRET_PAIR'].includes(key) ? 'CONNECTION' : key === 'WEBHOOK_TEST' ? 'WEBHOOK_TEST' : 'BOT_MODE_WEBHOOK';
    expect(deriveStartingStep({ channelId: true, channelSecret: true, channelAccessToken: true }, partial)).toBe(expected);
    expect(canAdvanceFromStep(expected, partial)).toBe(false);
  });
  it('one PASS, unknown keys and duplicate contradictions cannot imply success', () => {
    expect(stepStatus('CONNECTION', [check('TOKEN', 'PASS')])).toBe('NOT_CHECKED');
    expect(allVerifiableChecksPassed([check('OTHER', 'PASS')])).toBe(false);
    expect(allVerifiableChecksPassed([...ALL_PASS, check('TOKEN', 'FAIL')])).toBe(false);
  });
});

describe('latest request identity', () => {
  it('late old success/failure cannot overwrite a newer result or end its pending state', async () => {
    const { createWizardRequestGate } = await import('@/lib/line-setup-wizard');
    const gate = createWizardRequestGate();
    let finishOld!: (value: VerifyCheck[]) => void;
    const old = new Promise<VerifyCheck[]>((resolve) => { finishOld = resolve; });
    let visible: VerifyCheck[] | null = ALL_PASS;
    let pending = false;
    const run = async (promise: Promise<VerifyCheck[]>) => {
      const id = gate.begin(); visible = null; pending = true;
      try { const result = await promise; if (gate.isCurrent(id)) visible = result; }
      catch { if (gate.isCurrent(id)) visible = null; }
      finally { if (gate.isCurrent(id)) pending = false; }
    };
    const first = run(old);
    let finishNew!: (value: VerifyCheck[]) => void;
    const second = run(new Promise((resolve) => { finishNew = resolve; }));
    finishOld(ALL_PASS); await first;
    expect(visible).toBeNull(); expect(pending).toBe(true);
    finishNew([check('TOKEN', 'FAIL')]); await second;
    expect(visible).toEqual([check('TOKEN', 'FAIL')]); expect(pending).toBe(false);
    await run(Promise.reject(new Error('timeout')));
    expect(visible).toBeNull();
    await run(Promise.resolve(ALL_PASS));
    expect(allVerifiableChecksPassed(visible)).toBe(true);
  });
  it('reload/unmount invalidates previous responses; new requests still work', async () => {
    const { createWizardRequestGate } = await import('@/lib/line-setup-wizard');
    const gate = createWizardRequestGate(); const old = gate.begin();
    gate.invalidate(); expect(gate.isCurrent(old)).toBe(false);
    const fresh = gate.begin(); expect(gate.isCurrent(fresh)).toBe(true);
  });
});

describe('stepAfterVerifyRetry — 儲存成功後 verify 失敗的重試（只重驗）', () => {
  const saved = { channelId: true, channelSecret: true, channelAccessToken: true };
  it('再次網路錯誤（checks=null）→ 仍留在步驟一，不假裝成功', () => {
    expect(stepAfterVerifyRetry('CREDENTIALS_INPUT', saved, null)).toBe('CREDENTIALS_INPUT');
  });
  it('已儲存憑證 + 重驗憑證 FAIL → 依真實 checks 停在 CONNECTION 並可看到 FAIL，不放行', () => {
    const checks = [check('CREDENTIALS', 'PASS'), check('TOKEN', 'FAIL'), check('ID_SECRET_PAIR', 'PASS')];
    const next = stepAfterVerifyRetry('CREDENTIALS_INPUT', saved, checks);
    expect(next).toBe('CONNECTION');
    expect(canAdvanceFromStep(next, checks)).toBe(false);
  });
  it('已儲存憑證 + 重驗成功 → 不需重存，依 checks 前進', () => {
    expect(stepAfterVerifyRetry('CREDENTIALS_INPUT', saved, ALL_PASS)).toBe('AUTO_REPLY_CONFIRM');
    const partial = ALL_PASS.map((c) => (c.key === 'WEBHOOK' ? check('WEBHOOK', 'FAIL') : c));
    expect(stepAfterVerifyRetry('CREDENTIALS_INPUT', saved, partial)).toBe('BOT_MODE_WEBHOOK');
  });
  it('已儲存憑證不齊 → 仍須留在步驟一（先儲存）', () => {
    expect(stepAfterVerifyRetry('CREDENTIALS_INPUT', { ...saved, channelAccessToken: false }, ALL_PASS)).toBe('CREDENTIALS_INPUT');
  });
  it('已在步驟二以後的重新檢查不自動跳步', () => {
    expect(stepAfterVerifyRetry('BOT_MODE_WEBHOOK', saved, ALL_PASS)).toBe('BOT_MODE_WEBHOOK');
  });
});

describe('page 接線 source-pin（page 無法在 node render，改釘原始碼）', () => {
  let src = '';
  beforeAll(async () => {
    const { readFileSync } = await import('node:fs');
    src = readFileSync('src/app/tenant/line-settings/onboarding/page.tsx', 'utf8');
    if (src.length < 1000 || !src.includes('retryVerify')) throw new Error('page.tsx source-pin: unexpected source');
  });

  it('保護：原始碼已讀入（避免負向斷言空過）', () => {
    expect(src.length).toBeGreaterThan(1000);
    expect(src).toContain('retryVerify');
  });

  it('錯誤提示的重試鈕走 retryVerify（會更新 step），不是裸 runVerify', () => {
    expect(src).toMatch(/onClick=\{\(\) => void retryVerify\(\)\}>\{t\.nav\.retryCheck\}[\s\S]{0,40}<\/Alert>/);
    expect(src).toContain('stepAfterVerifyRetry(cur');
  });
});

/* ---------------------------------------------------------------------------
 * DONE gating（Issue #47，#714 審查缺口）。
 * 進入 DONE 的唯一路徑是 page.tsx goNext 由 CAPABILITIES 往下一步；
 * deriveStartingStep / stepAfterVerifyRetry 最遠只會落在 AUTO_REPLY_CONFIRM。
 * AUTO_REPLY 為 INFO 人工提示，不計入失敗，autoReplyAck 僅 UI 便利、不是關卡（Issue #47 本文）。
 * ------------------------------------------------------------------------- */
describe('DONE gating — verify 未全 PASS 不得抵達 DONE', () => {
  const saved = { channelId: true, channelSecret: true, channelAccessToken: true };
  const VERIFIABLE = ['CREDENTIALS', 'TOKEN', 'ID_SECRET_PAIR', 'BOT_MODE', 'WEBHOOK', 'WEBHOOK_TEST'];

  it('六項全 PASS 才通過；任一項 FAIL／INFO／缺漏／重複矛盾都不通過', () => {
    expect(allVerifiableChecksPassed(ALL_PASS)).toBe(true);
    for (const key of VERIFIABLE) {
      expect(allVerifiableChecksPassed(ALL_PASS.map((c) => (c.key === key ? check(key, 'FAIL') : c)))).toBe(false);
      expect(allVerifiableChecksPassed(ALL_PASS.map((c) => (c.key === key ? check(key, 'INFO') : c)))).toBe(false);
      expect(allVerifiableChecksPassed(ALL_PASS.filter((c) => c.key !== key))).toBe(false);
      expect(allVerifiableChecksPassed([...ALL_PASS, check(key, 'FAIL')])).toBe(false);
    }
    expect(allVerifiableChecksPassed([])).toBe(false);
    expect(allVerifiableChecksPassed(null)).toBe(false);
  });

  it('AUTO_REPLY（INFO）不阻擋：有、無、甚至標成 FAIL 都不影響六項判斷', () => {
    expect(allVerifiableChecksPassed(ALL_PASS.filter((c) => c.key !== 'AUTO_REPLY'))).toBe(true);
    expect(allVerifiableChecksPassed(ALL_PASS.map((c) => (c.key === 'AUTO_REPLY' ? check('AUTO_REPLY', 'FAIL') : c)))).toBe(true);
  });

  it('deriveStartingStep / stepAfterVerifyRetry 永遠不會直接落在 CAPABILITIES 或 DONE', () => {
    const variants: (VerifyCheck[] | null)[] = [null, [], ALL_PASS];
    for (const key of VERIFIABLE) {
      variants.push(ALL_PASS.map((c) => (c.key === key ? check(key, 'FAIL') : c)));
      variants.push(ALL_PASS.filter((c) => c.key !== key));
    }
    for (const checks of variants) {
      for (const step of [deriveStartingStep(saved, checks), stepAfterVerifyRetry('CREDENTIALS_INPUT', saved, checks)]) {
        expect(['CAPABILITIES', 'DONE']).not.toContain(step);
        if (!allVerifiableChecksPassed(checks)) expect(step).not.toBe('AUTO_REPLY_CONFIRM');
      }
    }
  });

  it('全 PASS 時 deriveStartingStep 落在 AUTO_REPLY_CONFIRM（不跳過人工提醒、也不直達 DONE）', () => {
    expect(deriveStartingStep(saved, ALL_PASS)).toBe('AUTO_REPLY_CONFIRM');
  });
});

describe('DONE gating source-pin（page 無法在 node render，釘住 page.tsx 接線；source-pin 非行為測試）', () => {
  let src = '';
  beforeAll(async () => {
    const { readFileSync } = await import('node:fs');
    src = readFileSync('src/app/tenant/line-settings/onboarding/page.tsx', 'utf8');
    if (src.length < 1000 || !src.includes('const goNext') || !src.includes('const goPrev') || !src.includes("{step === 'AUTO_REPLY_CONFIRM' ? (") || !src.includes("{step === 'CAPABILITIES' ? ("))
      throw new Error('page.tsx source-pin: unexpected source');
  });

  it('保護：原始碼已讀入且含 goNext／goPrev（避免負向斷言空過）', () => {
    expect(src.length).toBeGreaterThan(1000);
    expect(src).toContain('const goNext');
    expect(src).toContain('const goPrev');
  });

  it("沒有任何地方直接 setStep('DONE')／setStep('CAPABILITIES')，DONE 只能經 goNext 逐步抵達", () => {
    expect(src).not.toMatch(/setStep\(\s*['"](DONE|CAPABILITIES)['"]/);
  });

  it('goNext 仍使用 canAdvanceFromStep，且 CAPABILITIES→DONE 以 allVerifiableChecksPassed 擋住', () => {
    const body = src.slice(src.indexOf('const goNext'), src.indexOf('const goPrev'));
    expect(body).toContain('canAdvanceFromStep(step, checks)');
    expect(body).toMatch(/step === 'CAPABILITIES' && !allVerifiableChecksPassed\(checks\)\) return/);
  });

  it('AUTO_REPLY_CONFIRM 與 CAPABILITIES 各自的下一步按鈕 disabled 含「否定」的 allVerifiableChecksPassed，且不依賴 autoReplyAck', () => {
    const start = src.indexOf("{step === 'AUTO_REPLY_CONFIRM' ? (");
    const mid = src.indexOf("{step === 'CAPABILITIES' ? (");
    const end = src.indexOf("{step === 'DONE' ? (");
    expect(start).toBeGreaterThan(-1);
    expect(mid).toBeGreaterThan(start);
    expect(end).toBeGreaterThan(mid);
    const blocks = [src.slice(start, mid), src.slice(mid, end)];
    for (const block of blocks) {
      const buttons = block.match(/<Button disabled=\{[^}]*\} onClick=\{goNext\}>/g) ?? [];
      expect(buttons.length).toBe(1);
      expect(buttons[0]).toMatch(/!allVerifiableChecksPassed\(checks\)/);
      expect(buttons[0]).not.toMatch(/(^|[^!])allVerifiableChecksPassed\(checks\)/);
      expect(buttons[0]).not.toContain('autoReplyAck');
    }
  });
});
