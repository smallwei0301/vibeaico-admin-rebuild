export const ALLOWED: any;

export function readField(body: string | undefined, field: string): string;
export function isPlaceholder(value: unknown): boolean;
export function readLifecycleIssue(body?: string): number | null;
export function parseLaneMetadata(pr?: any): any;
export function validateLaneMetadata(metadata: any, options?: { action?: string }): string[];
export function summarizeActiveLanes(pullRequests?: any[]): any;
export function validateGlobalWip(summary: any): string[];
export function isActiveTestValidation(metadata: any): boolean;
export function findActiveTestLaneHolders(pullRequests?: any[]): any[];
export function decideTestValidation(options?: any): any;
export function requiredFieldNames(): string[];
