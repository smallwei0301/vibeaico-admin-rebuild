// tests/helpers/resend-mock.ts
//
// 本地假 Resend API server —— issue #27 ③ 的「未綁 LINE 自動改寄 Email」需要
// 證明信**真的寄出去了**，而不是只證明程式走到了 email 分支。
//
// 作法與 tests/helpers/line-mock.ts 完全對稱（同一套理由，照抄那份的鏈路說明）：
//   打 Resend 的不是「測試 process」而是 global-setup spawn 的 next dev
//   （localhost:3100）。resend 套件（v4）在 **模組載入時** 讀一次
//   `process.env.RESEND_BASE_URL`（node_modules/resend/dist/index.js:526
//   `var baseUrl = process.env.RESEND_BASE_URL || 'https://api.resend.com'`），
//   而 global-setup 以 spread process.env 傳環境變數 —— 所以只要 .env.test /
//   CI 的 env 有 RESEND_BASE_URL=http://localhost:4124，next dev 裡的
//   src/server/email/send.ts 就會打到這裡。因此 port 必須**固定 4124**。
//
//   另外 send.ts 有 `if (!process.env.RESEND_API_KEY) return 'SKIPPED_NO_KEY'`
//   的短路，所以整合測試環境也要給一把**假的** RESEND_API_KEY（值不重要，
//   mock 不驗），否則信根本不會送出，測到的只會是「沒設定 key」那條路。
//
//   測試檔之間串行（--no-file-parallelism），port 不會互撞，但每檔 afterAll
//   必須 stop()，下一檔才綁得回同一個 port。
//
// 回應行為（照真 Resend API 的形狀，夠測試斷言即可）：
//   - POST /emails → 200 { id }
//   - 其他路徑 → 200 {}
//   - failNext(status) 佇列：下一個進來的請求改回該狀態 —— 用來模擬寄信失敗，
//     驗證呼叫端不會把失敗報成「已改寄 Email」。

import { createServer, type Server } from 'node:http';

/** mock 收到的一封信 */
export interface RecordedEmail {
  method: string;
  path: string;
  /** JSON.parse 成功時為物件，否則為 null（rawBody 永遠保留原文） */
  body: any;
  rawBody: string;
}

/** 從 RESEND_BASE_URL 解析 mock 該綁的 port；預設 4124 */
export function resendMockPort(): number {
  const base = process.env.RESEND_BASE_URL;
  if (!base) return 4124;
  try {
    const port = new URL(base).port;
    return port ? Number(port) : 4124;
  } catch {
    return 4124;
  }
}

export class ResendMockServer {
  /** 收到的全部請求，依時間序 */
  readonly requests: RecordedEmail[] = [];

  private server: Server | undefined;
  private failQueue: number[] = [];

  constructor(readonly port: number = resendMockPort()) {}

  /** 綁定 port 並開始收請求；重複呼叫丟錯（避免測試漏 stop 佔住 port） */
  start(): Promise<void> {
    if (this.server) {
      return Promise.reject(new Error(`ResendMockServer 已在 port ${this.port} 上啟動，請先 stop()`));
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
        this.requests.push({ method: req.method ?? '', path, body, rawBody });

        const failStatus = this.failQueue.shift();
        if (failStatus !== undefined) {
          res.writeHead(failStatus, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ name: 'application_error', message: `mock forced failure (${failStatus})` }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: `mock-email-${this.requests.length}` }));
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

  /** 只取寄信請求（POST /emails） */
  get emails(): RecordedEmail[] {
    return this.requests.filter((r) => r.method === 'POST' && r.path === '/emails');
  }
}
