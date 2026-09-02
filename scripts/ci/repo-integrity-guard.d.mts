export interface RepositoryIntegrityInput {
  trackedPaths: string[];
  baselineTrackedCount: number;
  deletedPaths: string[];
  shaFindings: string[];
}

export interface RepositoryIntegrityResult {
  ok: boolean;
  errors: string[];
}

export function findStandaloneGitShas(path: string, content: string): string[];
export function evaluateRepositoryIntegrity(input: RepositoryIntegrityInput): RepositoryIntegrityResult;
