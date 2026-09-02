export type AgentRunLedger = Record<string, any>;

export type DualTerraRun = Record<string, unknown>;

export interface RunValidation {
  valid: boolean;
  errors: string[];
}

export function createRunLedger(runId: string, startedAt?: string): AgentRunLedger;
export function validateRunLedger(run: AgentRunLedger): string[];
export function buildInitialRun(runId: string, startedAt?: string): DualTerraRun;
export function validateRun(run: DualTerraRun): RunValidation;
export function runCli(argv?: string[]): void;
