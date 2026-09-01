import type { AgentRunLedger } from "./run-ledger.mjs";

export type RunScore = Record<string, any>;

export function computeWeightedUsage(run: AgentRunLedger): {
  weightedUsageUnits: number;
  actualTokens: number | null;
  unverifiedModelTasks: number;
};
export function computeDeliveryUnits(run: AgentRunLedger): number;
export function scoreRun(run: AgentRunLedger): RunScore;
export function renderMarkdown(run: AgentRunLedger, result: RunScore): string;
export function runCli(argv?: string[]): void;
