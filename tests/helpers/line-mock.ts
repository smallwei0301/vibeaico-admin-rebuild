// tests/helpers/line-mock.ts
//
// 本地假 LINE Messaging API server —— 見 docs/integration/12-TESTING-TDD.md
// §「Phase 6（LINE）— 不打真 LINE API」：
//   「`line.ts` 的 fetch 以環境變數 `LINE_API_BASE` 指向測試內建的 mock server
//    （tests/helpers/line-mock.ts 用 node http 起本地假 LINE，記錄收到的請求）」
//
// 連線鏈路（重要，跟一般 mock 不同）：
//   打 LINE API 的不是「測試 process」而是 global-setup spawn 的 next dev
//   （localhost:3100）。global-setup 以 spread process.env 傳遞環境變數，而
//   .env.test 設了 LINE_API_BASE=http://localhost:4123 —— 所以 mock server 必須
//   綁在**固定 port 4123**（跟著 LINE_API_BASE 走），跑在測試 process 裡，
//   next dev 的 src/server/line.ts（lineApiBase() 延遲讀 env）就會打到這裡。
//   測試檔之間串行（--no-file-parallelism），port 不會互撞，但每檔 afterAll
//   必須 stop()，下一檔才綁得回同一個 port。
//
// 回應行為（照真 LINE API 的形狀，夠測試斷言即可）：
//   - POST /v2/bot/message/reply|push|multicast → 200 {}
//   - GET  /v2/bot/profile/{userId} → 200 { displayName, userId, pictureUrl }
//   - GET  /v2/bot/info → 200 { basicId, displayName, … }
//   - 其他路徑 → 200 {}（rich menu 等端點本波測試不驗內容）
//   - failNext(status) 佇列：下一個進來的請求改回該狀態 —— 用來模擬
//     「LINE 平台回錯 → lineFetch 丟 ApiHttpError → webhook 事件處理失敗」，
//     驗證 route 的 try/catch 仍回 200。
//
// 匯出介面（任務指定）：start / stop / requests / reset（掛在 LineMockServer 上）。

import { createServer, type Server } from 'node:http';

/** mock 收到的一筆請求紀錄（method/path/body/headers，任務指定要記錄的欄位） */
export interface RecordedLineRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  /** JSON.parse 成功時為物件，否則為 null（rawBody 永遠保留原文） */
  body: any;
  rawBody: string;
}

/** 從 LINE_API_BASE 解析 mock 該綁的 port；預設 4123（.env.test 的固定值） */
export function lineMockPort(): number {
  const base = process.env.LINE_API_BASE;
  if (!base) return 4123;
  try {
    const port = new URL(base).port;
    return port ? Number(port) : 4123;
  } catch {
    return 4123;
  }
}

/** GET /v2/bot/profile/{userId} 回的固定 displayName 前綴（測試斷言用） */
export const MOCK_PROFILE_NAME_PREFIX = 'Mock LINE User ';
/** GET /v2/bot/profile/{userId} 回的固定頭像 URL（測試斷言用） */
export const MOCK_PROFILE_PICTURE_URL = 'https://mock.line.example/avatar.png';

export class LineMockServer {
  /** 收到的全部請求，依時間序 */
  readonly requests: RecordedLineRequest[] = [];

  private server: Server | undefined;
  private failQueue: number[] = [];

  constructor(readonly port: number = lineMockPort()) {}

  /** 綁定 port 並開始收請求；重複呼叫丟錯（避免測試漏 stop 佔住 port） */
  start(): Promise<void> {
    if (this.server) {
      return Promise.reject(new Error(`LineMockServer 已在 port ${this.port} 上啟動，請先 stop()`));
    }
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        let body: any = null;
        try {
          body = rawBody ? JSON.parse(rawBody) : null;
        } catch {
          body = null;
        }
        const path = (req.url ?? '').split('?')[0];
        this.requests.push({
          method: req.method ?? '',
          path,
          headers: { ...req.headers },
          body,
          rawBody,
        });

        // failNext 佇列：模擬 LINE 平台錯誤（lineFetch 會轉成 502 ApiHttpError）
        const failStatus = this.failQueue.shift();
        if (failStatus !== undefined) {
          res.writeHead(failStatus, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: `mock forced failure (${failStatus})` }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        const profileMatch = path.match(/^\/v2\/bot\/profile\/(.+)$/);
        if (profileMatch) {
          const userId = decodeURIComponent(profileMatch[1]);
          res.end(
            JSON.stringify({
              displayName: `${MOCK_PROFILE_NAME_PREFIX}${userId.slice(-4)}`,
              userId,
              pictureUrl: MOCK_PROFILE_PICTURE_URL,
              language: 'zh-TW',
            }),
          );
          return;
        }
        if (path === '/v2/bot/info') {
          res.end(
            JSON.stringify({
              userId: 'Umockbot0000000000000000000000000',
              basicId: '@mockbot',
              displayName: 'Mock 官方帳號',
              chatMode: 'bot',
              markAsReadMode: 'auto',
            }),
          );
          return;
        }
        // reply / push / multicast / rich menu … 一律 200 {}
        // （richmenu 建立回 richMenuId，順手帶上以免未來測試踩到）
        if (path === '/v2/bot/richmenu') {
          res.end(JSON.stringify({ richMenuId: 'richmenu-mock-0001' }));
          return;
        }
        res.end('{}');
      });
    });
    this.server = server;
    return new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  }

  /** 關閉 server（afterAll 必呼叫，下一個測試檔才綁得回同一個 port） */
  stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      // closeAllConnections：next dev 的 undici keep-alive 連線會讓 close 卡住
      server.closeAllConnections?.();
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  /** 清空請求紀錄與 failNext 佇列（案例之間隔離用） */
  reset(): void {
    this.requests.length = 0;
    this.failQueue = [];
  }

  /** 讓「下一個」進來的請求回指定狀態碼（預設 500）；可疊加多次排隊 */
  failNext(status = 500): void {
    this.failQueue.push(status);
  }

  /** 依路徑過濾請求（如 '/v2/bot/message/reply'） */
  requestsFor(path: string): RecordedLineRequest[] {
    return this.requests.filter((r) => r.path === path);
  }
}
