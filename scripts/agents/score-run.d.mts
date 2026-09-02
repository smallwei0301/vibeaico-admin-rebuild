import type { AgentRunLedger } from "./run-ledger.mjs";

export interface RunScore {
  runId: string;
  status: string;
  total: number;
  grade: string;
  qualified: boolean;
  scores: any;
  actualTokens: number | null;
  weightedUsageUnits: number;
  unverifiedModelTasks: number;
  deliveryUnits: number;
  weightedUsagePerDeliveryUnit: number | null;
  recommendations: string[];
}

export function computeWeightedUsage(run: AgentRunLedger): {
  weightedUsageUnits: number;
  actualTokens: number | null;
  unverifiedModelTasks: number;
};
export function computeDeliveryUnits(run: AgentRunLedger): number;
export function scoreRun(run: AgentRunLedger): RunScore;
export function computeReport(run: AgentRunLedger): Record<string, unknown>;
export function renderMarkdown(run: AgentRunLedger, result: RunScore): string;
export function runCli(argv?: string[]): void;
