import { lineSetupWizardCopy as copy } from '@/i18n/zh-TW/line-setup-wizard';

export const LINE_SETUP_STEP_KEYS = [
  'CREDENTIALS',
  'WEBHOOK_URL',
  'WEBHOOK_ENABLED',
  'AUTO_REPLY',
  'RICH_MENU',
  'QUOTA',
  'TEST_MESSAGE',
  'OUTBOX',
] as const;

export type LineSetupStepKey = (typeof LINE_SETUP_STEP_KEYS)[number];
export type LineSetupStepStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'ACTION_REQUIRED' | 'BLOCKED';
export type LineSetupEvidence =
  | 'PROVIDER_ACCEPTED'
  | 'PROVIDER_STATE'
  | 'USER_CONFIRMED'
  | 'OUTBOX_RECORDED';

export interface LineSetupCheck {
  key: LineSetupStepKey;
  status: Exclude<LineSetupStepStatus, 'PENDING'>;
  detail?: string;
  summary?: string;
  evidence?: LineSetupEvidence;
  quota?: { limit: number | null; used: number };
}

export interface LineSetupStepView {
  key: LineSetupStepKey;
  label: string;
  status: LineSetupStepStatus;
  title: string;
  description: string;
  detail?: string;
  evidence?: LineSetupEvidence;
  quota?: { limit: number | null; used: number };
}

export interface LineSetupWizardView {
  steps: LineSetupStepView[];
  completedCount: number;
  ready: boolean;
}

export interface LineVerifyCheck {
  key: string;
  pass: boolean;
  message: string;
}

const DEFAULT_STATUS: Record<LineSetupStepKey, LineSetupStepStatus> = {
  CREDENTIALS: 'PENDING',
  WEBHOOK_URL: 'PENDING',
  WEBHOOK_ENABLED: 'PENDING',
  AUTO_REPLY: 'ACTION_REQUIRED',
  RICH_MENU: 'PENDING',
  QUOTA: 'PENDING',
  TEST_MESSAGE: 'BLOCKED',
  OUTBOX: 'BLOCKED',
};

function contentFor(
  step: Pick<LineSetupStepView, 'key' | 'status' | 'quota'>,
  summary?: string,
) {
  const text = copy.steps[step.key];
  if (step.status === 'PENDING') {
    return { title: text.pendingTitle, description: text.pendingDescription };
  }
  if (step.status === 'PASSED') {
    if (step.key === 'QUOTA') {
      const quotaText = copy.steps.QUOTA;
      const used = Math.max(0, step.quota?.used ?? 0);
      const limit = step.quota?.limit ?? null;
      return {
        title: quotaText.passedTitle,
        description: limit === null
          ? quotaText.passedUnlimitedDescription(used)
          : quotaText.passedLimitedDescription(Math.max(0, limit - used)),
      };
    }
    return { title: text.passedTitle, description: text.passedDescription };
  }
  if (step.status === 'FAILED') {
    return { title: text.failedTitle, description: summary ?? text.failedDescription };
  }
  if (step.status === 'ACTION_REQUIRED') {
    return { title: text.actionTitle, description: summary ?? text.actionDescription };
  }
  return { title: text.blockedTitle, description: text.blockedDescription };
}

function finish(steps: LineSetupStepView[]): LineSetupWizardView {
  const completedCount = steps.filter((step) => step.status === 'PASSED').length;
  return {
    steps,
    completedCount,
    ready: completedCount === LINE_SETUP_STEP_KEYS.length,
  };
}

export function createLineSetupWizard(): LineSetupWizardView {
  return finish(LINE_SETUP_STEP_KEYS.map((key) => {
    const status = DEFAULT_STATUS[key];
    const content = contentFor({ key, status });
    return { key, label: copy.steps[key].label, status, ...content };
  }));
}

/**
 * 只合併這次真的回傳的步驟。單一步驟重試不會清掉其他成功結果；
 * 同一步驟若新結果失敗，會清掉舊 detail/evidence/quota，避免沿用過時證據。
 */
export function mergeLineSetupChecks(
  current: LineSetupWizardView,
  checks: readonly LineSetupCheck[],
): LineSetupWizardView {
  const updates = new Map(checks.map((check) => [check.key, check]));
  const steps = current.steps.map((step): LineSetupStepView => {
    const update = updates.get(step.key);
    if (!update) return step;
    const next: LineSetupStepView = {
      key: step.key,
      label: step.label,
      status: update.status,
      title: step.title,
      description: step.description,
      detail: update.detail,
      evidence: update.evidence,
      quota: update.quota,
    };
    return { ...next, ...contentFor(next, update.summary) };
  });
  return finish(steps);
}

function contains(message: string, ...terms: string[]) {
  const normalized = message.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

/** 將 provider／HTTP 技術訊息轉成導遊能採取行動的白話提示。 */
export function lineUserError(
  key: 'GENERAL' | 'CREDENTIALS' | 'WEBHOOK_URL' | 'WEBHOOK_ENABLED' | 'RICH_MENU' | 'QUOTA',
  message: string,
) {
  if (key === 'QUOTA') return copy.errors.quota;
  if (contains(message, 'network', 'timeout', 'fetch failed', '無法連線')) {
    return copy.errors.network;
  }
  if (key === 'CREDENTIALS' && contains(message, '401', '403', 'token', 'secret', 'unauthorized', 'invalid')) {
    return copy.errors.credentials;
  }
  if (key === 'WEBHOOK_URL') return copy.errors.webhookUrl;
  if (key === 'WEBHOOK_ENABLED') return copy.errors.webhookEnabled;
  if (key === 'RICH_MENU') return copy.errors.richMenu;
  if (key === 'GENERAL') return copy.errors.generic;
  return copy.errors.generic;
}

export function lineTestResultToCheck(result: { ok: boolean; message: string }): LineSetupCheck {
  return {
    key: 'CREDENTIALS',
    status: result.ok ? 'PASSED' : 'FAILED',
    detail: result.message,
    evidence: result.ok ? 'PROVIDER_ACCEPTED' : undefined,
    summary: result.ok ? undefined : lineUserError('CREDENTIALS', result.message),
  };
}

/**
 * 對應既有 verify endpoint 的五項結果。WEBHOOK endpoint 同時證明 URL 與 active，
 * 所以兩個 UI 步驟會一起更新，且失敗時各自給不同的處理建議。
 * AUTO_REPLY 目前沒有公開 API；false 不覆蓋店家已做的人工確認。
 */
export function mapLineVerifyChecks(checks: readonly LineVerifyCheck[]): LineSetupCheck[] {
  const mapped: LineSetupCheck[] = [];
  for (const check of checks) {
    if (check.key === 'TOKEN') {
      mapped.push({
        key: 'CREDENTIALS',
        status: check.pass ? 'PASSED' : 'FAILED',
        detail: check.message,
        evidence: check.pass ? 'PROVIDER_STATE' : undefined,
        summary: check.pass ? undefined : lineUserError('CREDENTIALS', check.message),
      });
    }
    if (check.key === 'WEBHOOK') {
      mapped.push({
        key: 'WEBHOOK_URL',
        status: check.pass ? 'PASSED' : 'FAILED',
        detail: check.message,
        evidence: check.pass ? 'PROVIDER_STATE' : undefined,
        summary: check.pass ? undefined : lineUserError('WEBHOOK_URL', check.message),
      });
      mapped.push({
        key: 'WEBHOOK_ENABLED',
        status: check.pass ? 'PASSED' : 'FAILED',
        detail: check.message,
        evidence: check.pass ? 'PROVIDER_STATE' : undefined,
        summary: check.pass ? undefined : lineUserError('WEBHOOK_ENABLED', check.message),
      });
    }
    // AUTO_REPLY 必須由店家在 LINE 後台確認，不能將 API 的固定 false 當成新失敗覆蓋。
    if (check.key === 'AUTO_REPLY' && check.pass) {
      mapped.push({ key: 'AUTO_REPLY', status: 'PASSED', evidence: 'PROVIDER_STATE' });
    }
    if (check.key === 'RICH_MENU') {
      mapped.push({
        key: 'RICH_MENU',
        status: check.pass ? 'PASSED' : 'FAILED',
        detail: check.message,
        evidence: check.pass ? 'PROVIDER_STATE' : undefined,
        summary: check.pass ? undefined : lineUserError('RICH_MENU', check.message),
      });
    }
    if (check.key === 'QUOTA') {
      mapped.push({
        key: 'QUOTA',
        status: check.pass ? 'PASSED' : 'FAILED',
        detail: check.message,
        evidence: check.pass ? 'PROVIDER_STATE' : undefined,
        summary: check.pass ? undefined : lineUserError('QUOTA', check.message),
      });
    }
  }
  return mapped;
}

export function confirmAutoReplyCheck(): LineSetupCheck {
  return {
    key: 'AUTO_REPLY',
    status: 'PASSED',
    evidence: 'USER_CONFIRMED',
  };
}

export function createRichMenuCheck(result: { richMenuId?: string }): LineSetupCheck {
  return {
    key: 'RICH_MENU',
    status: 'PASSED',
    detail: result.richMenuId ? `richMenuId=${result.richMenuId}` : undefined,
    evidence: 'PROVIDER_ACCEPTED',
  };
}
