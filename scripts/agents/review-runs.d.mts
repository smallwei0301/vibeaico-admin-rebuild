export interface RunReviewEntry {
  file: string;
  run: any;
  score: any;
}

export interface RunReviewResult {
  selected: RunReviewEntry[];
  latest: RunReviewEntry | null;
  previous: RunReviewEntry | null;
  trends: any;
  recommendations: string[];
}

export function reviewRuns(runs: RunReviewEntry[], limit?: number): RunReviewResult;
export function renderReview(result: RunReviewResult): string;
export function runCli(argv?: string[]): void;
