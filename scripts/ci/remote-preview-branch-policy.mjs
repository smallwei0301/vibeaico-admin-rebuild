#!/usr/bin/env node

const REMOTE_PROFILE = 'REMOTE_BRANCH_REQUIRED';
const LOCAL_PROFILE = 'LOCAL_ISOLATED';
const SOURCE_PROFILE = 'SOURCE_ONLY';

export const REMOTE_BRANCH_POLICY = Object.freeze({
  hourlyCostUsd: 0.01344,
  maxBranches: 2,
  maxLeaseMinutes: 60,
  confirmationText: 'CONFIRM_BRANCH_COST_USD_0.01344_PER_HOUR',
  managedPrefix: 'vibeaico-pr',
  parentProjectRef: 'nmwhwngojosmagjuvxol',
});

function normalizePath(value) {
  return String(value ?? '').replace(/^\.\//, '').replaceAll('\\', '/');
}

function readField(body = '', field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^[ \\t]*[-*]?[ \\t]*${escaped}[ \\t]*:[ \\t]*(.*?)[ \\t]*$`, 'mi');
  return (String(body).match(pattern)?.[1] ?? '').trim();
}

function unique(values) {
  return [...new Set(values)];
}

export function classifyRemoteBranchRequirement({ changedPaths = [], prBody = '' } = {}) {
  const paths = changedPaths.map(normalizePath).filter(Boolean);
  const reasons = [];
  const explicitProfile = readField(prBody, 'TEST_PROFILE').toUpperCase();
  const migrationTouch = readField(prBody, 'MIGRATION_TOUCH').toUpperCase() === 'TRUE';
  const authTouch = readField(prBody, 'AUTH_TOUCH').toUpperCase() === 'TRUE';
  const storageTouch = readField(prBody, 'STORAGE_TOUCH').toUpperCase() === 'TRUE';

  if (explicitProfile === REMOTE_PROFILE) reasons.push('EXPLICIT_REMOTE_PROFILE');
  if (migrationTouch) reasons.push('DECLARED_MIGRATION_TOUCH');
  if (authTouch) reasons.push('DECLARED_AUTH_TOUCH');
  if (storageTouch) reasons.push('DECLARED_STORAGE_TOUCH');

  for (const path of paths) {
    if (path.startsWith('supabase/migrations/')) reasons.push('DATABASE_MIGRATION');
    if (path === 'supabase/config.toml') reasons.push('SUPABASE_CONFIG');
    if (
      /^middleware\.(ts|js|mts|mjs)$/.test(path) ||
      /^src\/middleware\.(ts|js|mts|mjs)$/.test(path) ||
      path.startsWith('src/app/api/auth/') ||
      /(^|\/)auth([./-]|$)/.test(path)
    ) reasons.push('AUTH');
    if (
      path.startsWith('src/app/api/upload/') ||
      /(^|\/)storage([./-]|$)/.test(path) ||
      /(^|\/)upload([./-]|$)/.test(path)
    ) reasons.push('STORAGE');
  }

  const remoteReasons = unique(reasons);
  if (remoteReasons.length) {
    return { profile: REMOTE_PROFILE, reasons: remoteReasons, changedPaths: paths };
  }

  const needsLocal = paths.some((path) => (
    path.startsWith('src/app/api/') ||
    path.startsWith('scripts/test/') ||
    path.startsWith('tests/integration/') ||
    path.startsWith('tests/e2e/') ||
    path.startsWith('supabase/local-migrations/')
  ));

  return {
    profile: needsLocal ? LOCAL_PROFILE : SOURCE_PROFILE,
    reasons: needsLocal ? ['LOCAL_RUNTIME_OR_TEST_PATH'] : ['SOURCE_ONLY_PATHS'],
    changedPaths: paths,
  };
}

export function buildManagedBranchName(prNumber, exactHead, slot) {
  const number = Number(prNumber);
  const head = String(exactHead ?? '').trim().toLowerCase();
  const slotNumber = Number(slot);
  if (!Number.isInteger(number) || number < 1) throw new Error('PR number must be a positive integer');
  if (!/^[0-9a-f]{40}$/.test(head)) throw new Error('exact head must be a full 40-character commit SHA');
  if (![1, 2].includes(slotNumber)) throw new Error('remote branch slot must be 1 or 2');
  return `${REMOTE_BRANCH_POLICY.managedPrefix}${number}-s${slotNumber}-${head.slice(0, 8)}`;
}

export function estimateBranchCostUsd(leaseMinutes, branchCount = 1) {
  const minutes = Number(leaseMinutes);
  const count = Number(branchCount);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('lease minutes must be greater than zero');
  if (!Number.isInteger(count) || count < 1) throw new Error('branch count must be a positive integer');
  const billedHours = Math.ceil(minutes / 60);
  return Number((billedHours * REMOTE_BRANCH_POLICY.hourlyCostUsd * count).toFixed(5));
}

export function isManagedBranch(branch = {}) {
  const name = String(branch.name ?? branch.branch_name ?? '');
  const status = String(branch.status ?? branch.preview_project_status ?? '').toUpperCase();
  return name.startsWith(REMOTE_BRANCH_POLICY.managedPrefix) &&
    !['DELETED', 'DELETING', 'REMOVED'].includes(status);
}

export function buildRemoteBranchLeasePlan({
  prNumber,
  exactHead,
  slot,
  leaseMinutes = 60,
  changedPaths = [],
  prBody = '',
  existingBranches = [],
  executePaidBranch = false,
  paidBranchesEnabled = false,
  accessTokenAvailable = false,
  costConfirmation = '',
  now = new Date(),
} = {}) {
  const classification = classifyRemoteBranchRequirement({ changedPaths, prBody });
  if (classification.profile !== REMOTE_PROFILE) {
    throw new Error(`PR is ${classification.profile}; a paid remote branch is not justified`);
  }

  const minutes = Number(leaseMinutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > REMOTE_BRANCH_POLICY.maxLeaseMinutes) {
    throw new Error(`lease minutes must be between 1 and ${REMOTE_BRANCH_POLICY.maxLeaseMinutes}`);
  }

  const branchName = buildManagedBranchName(prNumber, exactHead, slot);
  const managedBranches = existingBranches.filter(isManagedBranch);
  if (managedBranches.length >= REMOTE_BRANCH_POLICY.maxBranches) {
    throw new Error(`managed remote branch count is ${managedBranches.length}; max is ${REMOTE_BRANCH_POLICY.maxBranches}`);
  }
  if (managedBranches.some((branch) => String(branch.name ?? branch.branch_name) === branchName)) {
    throw new Error(`managed branch already exists for this exact PR/head/slot: ${branchName}`);
  }

  const slotMarker = `-s${Number(slot)}-`;
  if (managedBranches.some((branch) => String(branch.name ?? branch.branch_name).includes(slotMarker))) {
    throw new Error(`remote branch slot ${slot} is already occupied`);
  }

  if (executePaidBranch) {
    if (!paidBranchesEnabled) throw new Error('paid Supabase preview branches are not enabled');
    if (!accessTokenAvailable) throw new Error('SUPABASE_ACCESS_TOKEN is required for paid branch creation');
    if (costConfirmation !== REMOTE_BRANCH_POLICY.confirmationText) {
      throw new Error(`cost confirmation must equal ${REMOTE_BRANCH_POLICY.confirmationText}`);
    }
  }

  const startedAt = new Date(now);
  if (Number.isNaN(startedAt.getTime())) throw new Error('invalid lease start time');
  const expiresAt = new Date(startedAt.getTime() + minutes * 60_000);

  return {
    version: 1,
    status: executePaidBranch ? 'AUTHORIZED_TO_CREATE' : 'PLAN_ONLY',
    operation: 'CREATE_AND_DESTROY_ONLY',
    forbiddenOperations: ['MERGE_BRANCH', 'PUSH_TO_PARENT', 'WITH_PRODUCTION_DATA'],
    parentProjectRef: REMOTE_BRANCH_POLICY.parentProjectRef,
    prNumber: Number(prNumber),
    exactHead: String(exactHead).toLowerCase(),
    slot: Number(slot),
    branchName,
    testProfile: REMOTE_PROFILE,
    reasons: classification.reasons,
    withData: false,
    persistent: false,
    leaseMinutes: minutes,
    plannedAt: startedAt.toISOString(),
    leaseExpiresAt: expiresAt.toISOString(),
    hourlyCostUsd: REMOTE_BRANCH_POLICY.hourlyCostUsd,
    estimatedCostUsd: estimateBranchCostUsd(minutes),
    activeManagedBranchCountBeforeCreate: managedBranches.length,
    branchId: null,
    projectRef: null,
    createdAt: null,
    destroyedAt: null,
    cleanupStatus: 'NOT_CREATED',
  };
}

export function verifyBranchDestroyed({ branchId, projectRef, branchName, remainingBranches = [] } = {}) {
  const identifiers = new Set(
    [branchId, projectRef, branchName].map((value) => String(value ?? '').trim()).filter(Boolean),
  );
  if (identifiers.size === 0) throw new Error('at least one branch identifier is required');

  const remaining = remainingBranches.filter((branch) => {
    const values = [branch.id, branch.project_ref, branch.ref, branch.name, branch.branch_name]
      .map((value) => String(value ?? '').trim());
    return values.some((value) => identifiers.has(value));
  });

  return {
    verifiedDestroyed: remaining.length === 0,
    cleanupStatus: remaining.length === 0 ? 'VERIFIED_DESTROYED' : 'DESTROY_FAILED',
    remaining,
  };
}
