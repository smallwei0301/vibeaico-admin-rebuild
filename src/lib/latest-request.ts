/**
 * 只套用「最新一次」請求的回應（純函式，可在 node 環境測試）。
 * 用法：const token = guard.next(); const res = await fetch(); if (!guard.isLatest(token)) return;
 * 元件卸載或要作廢進行中的請求時呼叫 invalidate()。
 */
export function createLatestGuard() {
  let seq = 0;
  return {
    next: () => { seq += 1; return seq; },
    isLatest: (token: number) => token === seq,
    invalidate: () => { seq += 1; },
  };
}
