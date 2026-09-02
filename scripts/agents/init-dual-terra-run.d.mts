import type { DualTerraRun } from "./run-ledger.mjs";

export interface DualTerraRunOptions {
  runId?: string;
  mainSha?: string;
  openIssues?: number | null;
  openPrs?: number | null;
  startedAt?: string;
}

export function buildDualTerraRun(options?: DualTerraRunOptions): DualTerraRun;

export function writeDualTerraRun(options: {
  run: DualTerraRun;
  outputDir?: string;
}): string;
