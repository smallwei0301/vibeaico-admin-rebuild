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
export type LineSetupStepStatus = 'PENDING' | 'PASSED' | 'FAILED';
export type LineSetupEvidence = 'PROVIDER_ACCEPTED' | 'PROVIDER_DELIVERED' | 'OUTBOX_RECORDED';

export interface LineSetupCheck {
  key: LineSetupStepKey;
  status: Exclude<LineSetupStepStatus, 'PENDING'>;
  detail?: string;
  evidence?: LineSetupEvidence;
  quota?: { limit: number | null; used: number };
}

export interface LineSetupStepView {
  key: LineSetupStepKey;
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

function contentFor(step: Pick<LineSetupStepView, 'key' | 'status' | 'quota'>) {
  const text = copy[step.key];
  if (step.status === 'PENDING') {
    return { title: text.pendingTitle, description: text.pendingDescription };
  }
  if (step.status === 'FAILED') {
    return { title: text.failedTitle, description: text.failedDescription };
  }
  if (step.key === 'QUOTA') {
    const used = Math.max(0, step.quota?.used ?? 0);
    const limit = step.quota?.limit ?? null;
    return {
      title: copy.QUOTA.passedTitle,
      description: limit === null
        ? copy.QUOTA.passedUnlimitedDescription(used)
        : copy.QUOTA.passedLimitedDescription(Math.max(0, limit - used)),
    };
  }
  return { title: text.passedTitle, description: text.passedDescription };
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
    const content = contentFor({ key, status: 'PENDING' });
    return { key, status: 'PENDING', ...content };
  }));
}

/**
 * 合併一次診斷結果。只更新這次有回傳的步驟，所以單一步驟重試不會把其他已完成
 * 設定清空；同一項若後來真的失敗，仍以最新結果為準，不保留過時的成功狀態。
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
      status: update.status,
      title: step.title,
      description: step.description,
      detail: update.detail,
      evidence: update.evidence,
      quota: update.quota,
    };
    return { ...next, ...contentFor(next) };
  });
  return finish(steps);
}
