/**
 * LINE 開通精靈（/tenant/line-settings/onboarding，Issue #47）的純邏輯層。
 * -----------------------------------------------------------------------------
 * 這支檔案**不呼叫**任何 API、**不含** React——只負責兩件事，讓 page.tsx 保持
 * 薄：
 *
 *   1. 定義精靈的七個步驟（順序、每步對應哪幾項 `verify` 檢查）。
 *   2. 把 `POST /api/settings/line/verify` 回傳的 `checks[]`（真實 provider 狀態）
 *      換算成「每一步該顯示成功／失敗／尚未檢查」，以及「重新整理頁面時應該從
 *      第幾步開始」——這是任務要求的「用真實設定/provider 狀態重建進度，而不是
 *      只靠 React state」的核心：只要 `checks` 是從 `verifyLineSetup()` 現查回來
 *      的，這裡算出來的起始步驟就一定反映資料庫＋LINE 官方的當下狀態，不是快取。
 *
 * ⚠️ 這裡**不重新實作**六項檢查的判定邏輯——那些邏輯只活在
 * `src/app/api/settings/line/verify/route.ts`（唯一真相來源）。本檔案只做
 * 「檢查結果 → 精靈步驟」的映射，避免出現第二套診斷引擎。
 */

/** 可查證檢查的 key，與 verify 端點 `VERIFIABLE_KEYS` 完全對應。 */
export type VerifiableCheckKey =
  | 'CREDENTIALS'
  | 'TOKEN'
  | 'ID_SECRET_PAIR'
  | 'BOT_MODE'
  | 'WEBHOOK'
  | 'WEBHOOK_TEST';

export type CheckStatus = 'PASS' | 'FAIL' | 'INFO';

export interface VerifyCheck {
  key: string;
  status: CheckStatus;
  pass: boolean;
  message: string;
}

/** 精靈的七個步驟，順序即畫面上由左至右／由上至下的順序。 */
export const WIZARD_STEP_KEYS = [
  'CREDENTIALS_INPUT',
  'CONNECTION',
  'BOT_MODE_WEBHOOK',
  'WEBHOOK_TEST',
  'AUTO_REPLY_CONFIRM',
  'CAPABILITIES',
  'DONE',
] as const;

export type WizardStepKey = (typeof WIZARD_STEP_KEYS)[number];

export function wizardStepIndex(key: WizardStepKey): number {
  return WIZARD_STEP_KEYS.indexOf(key);
}

/**
 * 每一步對應的可查證檢查 key（順序即 UI 顯示順序）。
 * `CREDENTIALS_INPUT`／`CAPABILITIES`／`DONE` 不對應 verify 檢查，故不列在這裡：
 * 前者是「填寫」動作本身，後兩者分別是能力摘要與完成頁。
 */
export const STEP_CHECK_KEYS: Record<
  Extract<WizardStepKey, 'CONNECTION' | 'BOT_MODE_WEBHOOK' | 'WEBHOOK_TEST' | 'AUTO_REPLY_CONFIRM'>,
  VerifiableCheckKey[] | ['AUTO_REPLY']
> = {
  CONNECTION: ['CREDENTIALS', 'TOKEN', 'ID_SECRET_PAIR'],
  BOT_MODE_WEBHOOK: ['BOT_MODE', 'WEBHOOK'],
  WEBHOOK_TEST: ['WEBHOOK_TEST'],
  AUTO_REPLY_CONFIRM: ['AUTO_REPLY'],
};

export type StepCheckStatus = 'NOT_CHECKED' | 'PASS' | 'FAIL' | 'INFO';

/** 該步驟對應的所有 checks 是否全數通過（AUTO_REPLY 一律算 INFO，不算通過/失敗）。 */
export function stepStatus(
  step: keyof typeof STEP_CHECK_KEYS,
  checks: VerifyCheck[] | null,
): StepCheckStatus {
  if (!checks) return 'NOT_CHECKED';
  const keys = STEP_CHECK_KEYS[step];
  const relevant = checks.filter((c) => (keys as string[]).includes(c.key));
  if (relevant.length === 0) return 'NOT_CHECKED';
  if (step === 'AUTO_REPLY_CONFIRM') return 'INFO';
  if (relevant.some((c) => c.status === 'FAIL')) return 'FAIL';
  if (relevant.every((c) => c.status === 'PASS')) return 'PASS';
  return 'NOT_CHECKED';
}

/** 六項可查證檢查是否全數 PASS（AUTO_REPLY 的 INFO 不計入）。 */
export function allVerifiableChecksPassed(checks: VerifyCheck[] | null): boolean {
  if (!checks) return false;
  const verifiable = checks.filter((c) => c.status !== 'INFO');
  return verifiable.length > 0 && verifiable.every((c) => c.status === 'PASS');
}

export interface CredentialsPresence {
  channelId: boolean;
  channelSecret: boolean;
  channelAccessToken: boolean;
}

export function credentialsConfigured(p: CredentialsPresence): boolean {
  return p.channelId && p.channelSecret && p.channelAccessToken;
}

/**
 * 重新整理／首次開啟精靈時，該從哪一步開始——依「真實設定是否已填」與
 * 「最近一次 verify 的真實結果」推算，不是只讀 React state。
 *
 *   - 憑證三項只要有一項尚未填 → 回到步驟一（填憑證）。
 *   - 有填但還沒有 verify 結果（`checks === null`）→ 停在步驟一，讓頁面先送出
 *     一次 verify 再重新計算（page.tsx 的職責，這裡只回報「還不知道」）。
 *   - 有 verify 結果 → 停在「第一個沒有全數通過」的步驟；六項全過 → 停在
 *     AUTO_REPLY 人工確認步驟（每次重開都值得再提醒一次，因為系統永遠查不到
 *     那顆開關的真實狀態，不能因為「上次來過」就假設它仍然關著）。
 */
export function deriveStartingStep(
  presence: CredentialsPresence,
  checks: VerifyCheck[] | null,
): WizardStepKey {
  if (!credentialsConfigured(presence)) return 'CREDENTIALS_INPUT';
  if (!checks) return 'CREDENTIALS_INPUT';

  const order: (keyof typeof STEP_CHECK_KEYS)[] = ['CONNECTION', 'BOT_MODE_WEBHOOK', 'WEBHOOK_TEST'];
  for (const step of order) {
    if (stepStatus(step, checks) === 'FAIL') return step;
  }
  return 'AUTO_REPLY_CONFIRM';
}

/** 精靈是否可以往下一步走（未查證檢查一律視為「還不能往下」，避免跳過失敗步驟）。 */
export function canAdvanceFromStep(
  step: WizardStepKey,
  checks: VerifyCheck[] | null,
): boolean {
  switch (step) {
    case 'CREDENTIALS_INPUT':
      return true; // 由 page.tsx 檢查表單必填後才呼叫
    case 'CONNECTION':
      return stepStatus('CONNECTION', checks) === 'PASS';
    case 'BOT_MODE_WEBHOOK':
      return stepStatus('BOT_MODE_WEBHOOK', checks) === 'PASS';
    case 'WEBHOOK_TEST':
      return stepStatus('WEBHOOK_TEST', checks) === 'PASS';
    case 'AUTO_REPLY_CONFIRM':
    case 'CAPABILITIES':
      return true; // 人工確認提示／能力摘要不會擋路，只是提醒
    case 'DONE':
      return true;
    default:
      return false;
  }
}
