export type AgentRunLedger = Record<string, any>;

export function createRunLedger(runId: string, startedAt?: string): AgentRunLedger;
export function validateRunLedger(run: AgentRunLedger): string[];
export function runCli(argv?: string[]): void;
