import { readField } from './agent-wip-policy.mjs';

const PRODUCT = 'PRODUCT_MAINLINE';
const GOVERNANCE = 'MODEL_GOVERNANCE';

const matchesConfiguredPath = (path, entry) => {
  const candidate = String(path ?? '');
  const configured = String(entry ?? '');
  if (!candidate || !configured) return false;
  return configured.endsWith('/') ? candidate.startsWith(configured) : candidate === configured;
};

/**
 * Workstream routing fails toward Product safety.
 *
 * Legacy PRs that predate the 2026-09-10 workstream field keep working by
 * defaulting a missing WORKSTREAM to PRODUCT_MAINLINE. An explicitly invalid
 * value is never silently defaulted: it becomes an error. MODEL_GOVERNANCE is
 * accepted only when every changed path is inside the trusted-main governance
 * allowlist; mixed or Product paths therefore cannot use the label as a bypass.
 */
export function classifyWorkstream({ body = '', changedFiles = null } = {}, policy = {}) {
  const config = policy?.workstreams;
  const errors = [];
  const allowed = config?.allowed;
  const governance = config?.modelGovernance;
  const raw = readField(body, 'WORKSTREAM').trim().toUpperCase();

  if (
    !config ||
    !Array.isArray(allowed) ||
    allowed.length !== 2 ||
    !allowed.includes(GOVERNANCE) ||
    !allowed.includes(PRODUCT) ||
    config.legacyMissingDefaultsTo !== PRODUCT ||
    config.invalidExplicitValue !== 'REJECT' ||
    governance?.value !== GOVERNANCE ||
    governance?.executorModel !== 'gpt-5.6-sol' ||
    governance?.finalRiskPolicy !== 'NOT_REQUIRED_BY_OWNER_POLICY' ||
    !Array.isArray(governance?.scopePrefixes) ||
    !governance.scopePrefixes.length
  ) {
    errors.push('Trusted workstream policy is missing or malformed');
  }

  let workstream = raw || PRODUCT;
  if (raw && !allowed?.includes(raw)) {
    errors.push(`Invalid WORKSTREAM: ${raw}`);
    workstream = PRODUCT;
  }

  if (workstream !== GOVERNANCE) {
    return {
      workstream: PRODUCT,
      explicit: Boolean(raw),
      pureGovernance: false,
      outsideGovernanceScope: [],
      errors,
    };
  }

  if (!Array.isArray(changedFiles) || !changedFiles.length) {
    errors.push('MODEL_GOVERNANCE requires actual changed files');
  }

  const outsideGovernanceScope = (changedFiles ?? []).filter(
    path => !governance?.scopePrefixes?.some(prefix => matchesConfiguredPath(path, prefix)),
  );
  if (outsideGovernanceScope.length) {
    errors.push(`MODEL_GOVERNANCE contains non-governance paths: ${outsideGovernanceScope.join(', ')}`);
  }

  return {
    workstream: GOVERNANCE,
    explicit: true,
    pureGovernance: errors.length === 0,
    outsideGovernanceScope,
    errors,
  };
}
