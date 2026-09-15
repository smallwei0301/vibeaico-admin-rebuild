/**
 * src/server/ssrf-guard.ts — 對外部使用者提供的 URL 做 SSRF 防護（Issue #21）。
 * -----------------------------------------------------------------------------
 * `external_calendars.ics_url` 是店家自己填的外部輸入，server 要去抓它，這正是
 * 教科書等級的 SSRF 面：如果不做防護，一個惡意店家可以把 `ics_url` 填成
 * `http://169.254.169.254/latest/meta-data/…`（雲端 metadata endpoint）或內網
 * 服務位址，讓我方 server 幫他打內網。
 *
 * 這是本 repo **第一支**這種外部 URL 抓取功能，所以刻意獨立成一個命名清楚、
 * 可重用、有完整測試的模組——之後任何要「代使用者去抓外部 URL」的功能都應該
 * 重用這一支，而不是各自重新發明一套不完整的檢查。
 *
 * 防護的兩層，缺一不可：
 *   1. Scheme 檢查：只准 http/https（拒絕 file:// 等其他 scheme）。
 *   2. DNS resolve 後檢查「解析出來的 IP」，不是檢查網址字串本身——網址字串
 *      永遠可以填一個看起來人畜無害的網域，DNS 才是真正決定連線目的地的東西。
 *      Redirect 也是同一個道理：Location header 一樣可能指向內網，所以每一次
 *      跳轉都要重新做完整檢查，不能只在最初的輸入 URL 做一次就信任到底。
 *
 * ⚠️ 誠實揭露一個已知局限（DNS rebinding）：這裡是「先 resolve+檢查，再讓
 * Node 原生 fetch 用同一個 hostname 自己連線」，兩次 DNS 查詢之間理論上存在
 * 一個極窄的競態窗口（攻擊者的權威 DNS 在两次查詢之間把記錄從公開 IP 換成內網
 * IP）。要完全消除這個窗口需要把「resolve 出來的 IP」直接釘進連線層（自訂
 * socket/dispatcher），這超出本輪範圍；已在 PR 說明與 Issue #21 收尾清單中
 * 如實列為殘留風險，不假裝已經完全解決。
 */
import dns from 'node:dns';

export const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 10_000;
const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

/* --------------------------------------------------------------- IPv4/IPv6 */

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n < 0 || n > 255) return null;
    bytes.push(n);
  }
  return bytes;
}

function isBlockedIPv4(bytes: number[]): boolean {
  const [a, b] = bytes;
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 0) return true; // 0.0.0.0/8「this network」，不是合法的外部目的地
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT，額外保守
  return false;
}

/** 把 IPv6 字串（可能含 `::` 縮寫、可能有 IPv4-mapped 尾段）展開成 16 bytes。 */
function parseIPv6(ip: string): number[] | null {
  let working = ip;
  const lastColon = working.lastIndexOf(':');
  const tail = working.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    const hex1 = ((v4[0] << 8) | v4[1]).toString(16);
    const hex2 = ((v4[2] << 8) | v4[3]).toString(16);
    working = `${working.slice(0, lastColon + 1)}${hex1}:${hex2}`;
  }

  const doubleColonParts = working.split('::');
  if (doubleColonParts.length > 2) return null;

  let groups: string[];
  if (doubleColonParts.length === 2) {
    const head = doubleColonParts[0] ? doubleColonParts[0].split(':').filter(Boolean) : [];
    const rest = doubleColonParts[1] ? doubleColonParts[1].split(':').filter(Boolean) : [];
    const missing = 8 - head.length - rest.length;
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill('0'), ...rest];
  } else {
    groups = working.split(':');
  }
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const g of groups) {
    if (g === '' || !/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    const v = parseInt(g, 16);
    bytes.push((v >> 8) & 0xff, v & 0xff);
  }
  return bytes;
}

function isBlockedIPv6(bytes: number[]): boolean {
  const allZero = bytes.every((b) => b === 0);
  if (allZero) return true; // :: unspecified，不是合法的外部目的地
  const isLoopback = bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1;
  if (isLoopback) return true; // ::1
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique local（RFC1918 的 IPv6 對等）

  // ::ffff:a.b.c.d — IPv4-mapped，遞迴用 IPv4 規則再檢查一次真正的目的地。
  const isIPv4Mapped = bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (isIPv4Mapped) return isBlockedIPv4(bytes.slice(12, 16));

  return false;
}

/**
 * 單一 IP 字串（DNS 查詢結果，或 fetch 前的最後把關）是否屬於必須拒絕的範圍。
 * 匯出供測試直接打各種邊界值，不必每次都經過一次真的 DNS 查詢。
 */
export function isBlockedIp(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) return isBlockedIPv4(v4);
  const v6 = parseIPv6(ip);
  if (v6) return isBlockedIPv6(v6);
  // 無法辨識的格式一律當成不安全，fail closed。
  return true;
}

/* ------------------------------------------------------------ DNS resolve */

export type DnsLookupFn = (
  hostname: string,
) => Promise<{ address: string; family: number }[]>;

/** 預設用 Node 內建 `dns.lookup`；測試可注入假的 lookup 函式。 */
const defaultLookup: DnsLookupFn = (hostname) =>
  new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });

/**
 * 驗證一個 URL 是否可以安全地被 server 抓取：scheme 必須是 http/https，
 * hostname 解析出的**每一個** IP 都不得落在被封鎖的範圍——只要有一個位址
 * 是內網/loopback/link-local，就整個拒絕（多址 DNS 常見於做負載平衡的服務，
 * 只要有一個地址落在私網就足以構成 SSRF 風險，不能因為「其中一個是公開的」
 * 就放行）。
 */
export async function assertUrlIsFetchable(
  url: URL,
  lookup: DnsLookupFn = defaultLookup,
): Promise<void> {
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new SsrfBlockedError(`不允許的協定：${url.protocol}`);
  }
  if (!url.hostname) {
    throw new SsrfBlockedError('URL 缺少主機名稱');
  }

  // 使用者直接填 IP 字面值（不需要 DNS 查詢）的情況，一樣要檢查。
  const literal = url.hostname.replace(/^\[|\]$/g, ''); // IPv6 URL 會被中括號包住
  if (parseIPv4(literal) || parseIPv6(literal)) {
    if (isBlockedIp(literal)) {
      throw new SsrfBlockedError(`拒絕內網／loopback 位址：${literal}`);
    }
    return;
  }

  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(url.hostname);
  } catch (error) {
    throw new SsrfBlockedError(
      `無法解析主機名稱：${url.hostname}（${error instanceof Error ? error.message : String(error)}）`,
    );
  }
  if (!addresses.length) {
    throw new SsrfBlockedError(`主機名稱沒有解析出任何位址：${url.hostname}`);
  }
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new SsrfBlockedError(`拒絕內網／loopback 位址：${url.hostname} → ${address}`);
    }
  }
}

/* ------------------------------------------------------------- 安全 fetch */

/**
 * 安全地把一個外部 URL 的內容抓回來（純文字，供 ICS 解析用）：
 * 每一次真正發出請求前都重新驗證當下的 URL（輸入本身、以及每一次 redirect
 * 之後的新目的地），最多跟隨 `MAX_REDIRECTS` 次跳轉，超過視為異常直接拒絕。
 */
export async function fetchTextWithSsrfGuard(
  rawUrl: string,
  opts?: { lookup?: DnsLookupFn; fetchImpl?: typeof fetch },
): Promise<string> {
  const lookup = opts?.lookup ?? defaultLookup;
  const fetchImpl = opts?.fetchImpl ?? fetch;

  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(`不是合法的 URL：${rawUrl}`);
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertUrlIsFetchable(current, lookup);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetchImpl(current, { redirect: 'manual', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new SsrfBlockedError('伺服器回傳 redirect 卻沒有 Location header');
      if (hop === MAX_REDIRECTS) {
        throw new SsrfBlockedError(`redirect 次數超過上限（${MAX_REDIRECTS}）`);
      }
      current = new URL(location, current);
      continue;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.text();
  }

  throw new SsrfBlockedError(`redirect 次數超過上限（${MAX_REDIRECTS}）`);
}
