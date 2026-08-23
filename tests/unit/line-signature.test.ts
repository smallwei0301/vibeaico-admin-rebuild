// tests/unit/line-signature.test.ts
//
// Phase 6 單元測試（12 分冊 §「Phase 6（LINE）」：webhook 簽章驗證 正確/錯誤/缺 header）。
//
// ⚠️ 可測性說明（任務要求「若無法純函式化，退而求其次」）：
//   簽章驗證邏輯 inline 在 src/app/api/line/webhook/[shopCode]/route.ts 裡
//   （createHmac → 長度預檢 → timingSafeEqual），route handler 依所有權不得
//   改動（抽成純函式屬 src/** 修改）。因此這裡：
//   1. 以 node:crypto **逐字重現** route 的驗簽演算法（下面的 sign()/verify()
//    直接對照 route.ts L42-48 的實作，兩邊若有一邊改動必須同步），對它做
//    正確簽章/壞簽章/缺 header/長度不等 的矩陣 —— 「正確簽章能算出來」這件事
//    同時被 tests/integration/api/line-webhook.06.test.ts 用同一個 sign()
//    邏輯打真 route 驗證（好簽章 200、壞簽章 401），整合層補上單元層搆不到的
//    route 行為本身。
//   2. lineApiBase()/lineDataApiBase()（src/server/line.ts）是真的可匯入純函式：
//      驗「延遲讀 LINE_API_BASE」的契約 —— import 之後才設 env 也要生效，
//      這是整個 Phase 6 mock server 手法能運作的前提。
//
// 事件分派決策（keyword 優先序 ①→⑤）在 handleEvent 內部與 Supabase 查詢交織、
// 未以純函式形式匯出，無法在「不碰網路/DB」（12 分冊 §3）前提下單元化 ——
// 由 line-webhook.06 整合測試以真資料覆蓋（keyword 命中回覆、未命中不回）。

import { describe, it, expect, afterAll, vi } from 'vitest';
import { createHmac, timingSafeEqual } from 'node:crypto';

// src/server/line.ts →（經 ./supabase）→ next/headers：在 vitest node 環境
// 需要 mock 掉（比照 tests/unit/supabase.test.ts 的做法；本檔只呼叫不碰
// Supabase 的 lineApiBase/lineDataApiBase，mock 永遠不會被真的用到）。
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ getAll: () => [], set: () => {} }) }));

import { lineApiBase, lineDataApiBase } from '@/server/line';

/* ------------------------------------------------------------------------- */
/* 1. 簽章計算/驗證 —— route.ts 演算法的逐字重現（見檔頭說明）                  */
/* ------------------------------------------------------------------------- */

/** LINE 官方規則：HMAC-SHA256(channel secret, raw request body) 的 base64 */
function sign(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('base64');
}

/** route.ts L42-48 的驗證邏輯（含 timingSafeEqual 長度預檢） */
function verify(secret: string, rawBody: string, gotSignature: string | null): boolean {
  const expect_ = sign(secret, rawBody);
  const got = gotSignature ?? '';
  const expectBuf = Buffer.from(expect_);
  const gotBuf = Buffer.from(got);
  if (!got || expectBuf.length !== gotBuf.length) return false;
  return timingSafeEqual(expectBuf, gotBuf);
}

const SECRET = 'test-line-channel-secret';
const BODY = JSON.stringify({
  destination: 'Uabcdef0123456789abcdef0123456789',
  events: [{ type: 'message', message: { type: 'text', text: '哈囉' } }],
});

describe('LINE webhook 簽章（06 §3；演算法鏡像自 route.ts）', () => {
  it('正確簽章 → 驗證通過', () => {
    expect(verify(SECRET, BODY, sign(SECRET, BODY))).toBe(true);
  });

  it('簽章值是 HMAC-SHA256 base64（44 字元、可還原成 32 bytes）', () => {
    const s = sign(SECRET, BODY);
    expect(s).toHaveLength(44); // 32 bytes → base64 = 44 chars（含 padding）
    expect(Buffer.from(s, 'base64')).toHaveLength(32);
  });

  it('body 被竄改（多一個空白）→ 驗證失敗', () => {
    const s = sign(SECRET, BODY);
    expect(verify(SECRET, BODY + ' ', s)).toBe(false);
  });

  it('secret 不對 → 驗證失敗', () => {
    expect(verify(SECRET, BODY, sign('wrong-secret', BODY))).toBe(false);
  });

  it('缺 header（null / 空字串）→ 驗證失敗', () => {
    expect(verify(SECRET, BODY, null)).toBe(false);
    expect(verify(SECRET, BODY, '')).toBe(false);
  });

  it('長度不等的簽章 → 直接 false（不因 timingSafeEqual 長度限制丟錯）', () => {
    // timingSafeEqual 對長度不同的 buffer 會 throw —— route 先比長度短路，
    // 這裡驗證鏡像實作在這種輸入下不 throw、回 false
    expect(() => verify(SECRET, BODY, 'short')).not.toThrow();
    expect(verify(SECRET, BODY, 'short')).toBe(false);
  });

  it('同長度但內容不同的簽章 → false（走到 timingSafeEqual 分支）', () => {
    const s = sign(SECRET, BODY);
    // 翻轉第一個字元，長度不變
    const flipped = (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    expect(flipped).toHaveLength(s.length);
    expect(verify(SECRET, BODY, flipped)).toBe(false);
  });
});

/* ------------------------------------------------------------------------- */
/* 2. lineApiBase / lineDataApiBase 延遲讀 env（src/server/line.ts 真函式）    */
/* ------------------------------------------------------------------------- */

const ORIGINAL_API_BASE = process.env.LINE_API_BASE;
const ORIGINAL_DATA_API_BASE = process.env.LINE_DATA_API_BASE;

afterAll(() => {
  if (ORIGINAL_API_BASE === undefined) delete process.env.LINE_API_BASE;
  else process.env.LINE_API_BASE = ORIGINAL_API_BASE;
  if (ORIGINAL_DATA_API_BASE === undefined) delete process.env.LINE_DATA_API_BASE;
  else process.env.LINE_DATA_API_BASE = ORIGINAL_DATA_API_BASE;
});

describe('lineApiBase / lineDataApiBase — 延遲讀 LINE_API_BASE（12 分冊 Phase 6 前提）', () => {
  it('未設 env → 回真 LINE 端點', () => {
    delete process.env.LINE_API_BASE;
    delete process.env.LINE_DATA_API_BASE;
    expect(lineApiBase()).toBe('https://api.line.me');
    expect(lineDataApiBase()).toBe('https://api-data.line.me');
  });

  it('import 之後才設 env 也生效（延遲讀取，不是模組載入時凍結）', () => {
    // 模組已在檔頭 import 完；現在才設 env —— 若實作在模組層讀死就會假綠不了這條
    process.env.LINE_API_BASE = 'http://localhost:4123';
    process.env.LINE_DATA_API_BASE = 'http://localhost:4123';
    expect(lineApiBase()).toBe('http://localhost:4123');
    expect(lineDataApiBase()).toBe('http://localhost:4123');
  });

  it('清掉 env 後又回落到預設（每次呼叫都重讀）', () => {
    process.env.LINE_API_BASE = 'http://localhost:9999';
    expect(lineApiBase()).toBe('http://localhost:9999');
    delete process.env.LINE_API_BASE;
    expect(lineApiBase()).toBe('https://api.line.me');
  });
});
