export const ALLOWED: any;
/** 同時可存在的 Product candidate 上限（單一事實來源，見 .mjs 的說明）。 */
export const MAX_ACTIVE_CANDIDATES: number;

/** 同一欄位在原始內文中宣告多個不同值時的哨兵值；含 `|`，因此必被 isPlaceholder 與各 classifier 拒絕。 */
export const AMBIGUOUS_FIELD: string;
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
