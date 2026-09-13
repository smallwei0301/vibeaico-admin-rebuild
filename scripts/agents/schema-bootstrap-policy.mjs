const GOVERNANCE_INSTALL_ONLY_FILES = new Set([
  '.github/workflows/agent-schema-bootstrap.yml',
  'docs/schema-truth/2026-09-11-reconciliation.md',
  'scripts/agents/schema-bootstrap-candidate.mjs',
  'scripts/agents/schema-bootstrap-policy.mjs',
  'tests/unit/schema-bootstrap-candidate.test.ts',
  'tests/unit/schema-bootstrap-policy.test.ts',
]);

/**
 * Decide whether a clean-schema run must continue past replay/probes into the
 * full Product integration + E2E acceptance suite.
 *
 * Bootstrap installation is deliberately two-phase:
 * - a PR that changes only the governance guard itself proves the guard can
 *   build/replay/probe a clean main-shaped DB, but does not pretend current
 *   Product fixtures are already compatible;
 * - any other changed path fails closed to full Product acceptance. This means
 *   migrations, seed/profile helpers, Product fixtures, or future unknown
 *   schema-sensitive paths cannot silently receive the lighter install-only
 *   treatment.
 *
 * Empty/invalid inventories also fail closed to full Product acceptance.
 */
export function classifySchemaBootstrapAcceptance(changedFiles) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
    return {
      productAcceptanceRequired: true,
      reason: 'UNKNOWN_OR_EMPTY_CHANGED_FILE_INVENTORY',
      outsideGovernanceInstallScope: [],
    };
  }

  const normalized = changedFiles
    .map((path) => String(path ?? '').trim())
    .filter(Boolean);
  if (normalized.length !== changedFiles.length || normalized.length === 0) {
    return {
      productAcceptanceRequired: true,
      reason: 'INVALID_CHANGED_FILE_INVENTORY',
      outsideGovernanceInstallScope: normalized,
    };
  }

  const outsideGovernanceInstallScope = normalized.filter(
    (path) => !GOVERNANCE_INSTALL_ONLY_FILES.has(path),
  );
  if (outsideGovernanceInstallScope.length > 0) {
    return {
      productAcceptanceRequired: true,
      reason: 'PRODUCT_OR_UNKNOWN_PATH_CHANGED',
      outsideGovernanceInstallScope,
    };
  }

  return {
    productAcceptanceRequired: false,
    reason: 'GOVERNANCE_GUARD_INSTALL_ONLY',
    outsideGovernanceInstallScope: [],
  };
}

export const schemaBootstrapGovernanceInstallOnlyFiles = Object.freeze(
  [...GOVERNANCE_INSTALL_ONLY_FILES].sort(),
);
