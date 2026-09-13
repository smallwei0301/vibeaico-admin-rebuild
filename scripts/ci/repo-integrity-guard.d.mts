export interface MigrationIntegrityInput {
  trackedPaths: string[];
  baselineTrackedPaths?: string[];
  modifiedPaths?: string[];
}

export interface RepositoryIntegrityInput extends MigrationIntegrityInput {
  baselineTrackedCount: number;
  deletedPaths: string[];
  shaFindings: string[];
}

export interface RepositoryIntegrityResult {
  ok: boolean;
  errors: string[];
}

export function findStandaloneGitShas(path: string, content: string): string[];
export function findMigrationIntegrityIssues(input: MigrationIntegrityInput): string[];
export function evaluateRepositoryIntegrity(input: RepositoryIntegrityInput): RepositoryIntegrityResult;
export function resolveRevision(
  env: Record<string, string | undefined>,
  name: string,
  fallback: string,
): string;
