/**
 * 預約列表匯出的**格式段** — GitHub issue #33 第 ③ 筆。
 *
 * 原站打的是 `/api/export/bookings/${format}`（docs/specs/bookings.json 的
 * jsApiCalls），我方原本只有無 format 段的 `/api/export/bookings`。
 * 本輪補上格式段，形狀逐字對齊已存在的 `/api/export/reports/[format]` 與
 * `/api/export/inventory/[format]`。
 *
 * 本檔驗證：
 *   ① 慣例：Content-Type / Content-Disposition / **位元組層級的 UTF-8 BOM** /
 *      Cache-Control，且**不走 `{ success, data }` 信封**（csv / excel 兩個分支
 *      各驗一次同一組斷言）
 *   ② 白名單：csv / excel 以外的 format → 400 REQ_001
 *   ③ 兩個 format 的內容完全相同（端點共用同一個產生器，不是兩份實作）
 *   ④ 與無 format 段的舊端點內容一致（舊接線點不會因為本輪改動而變）
 *   ⑤ ?from&to 真的套用（台北日界線）
 *   ⑥ 未登入 → 401；RLS：B 店的預約不會出現在 A 店的匯出裡
 *
 * ⚠️ BOM 一律驗**位元組**：`Response.text()` 依 WHATWG 規範會把開頭的 BOM 吃掉，
 * `text.startsWith('\uFEFF')` 永遠是 false，那條斷言量的是 fetch 不是端點
 * （本專案踩過兩次，見 export-reports.15 / export-inventory.28 的同一段註解）。
 *
 * 清理紀律：本檔**不建立任何資料**，只讀 seed 的預約（reset-db 每次會重來），
 * 所以沒有 afterAll 要清的東西。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

let ownerA: AuthedApi;
let ownerB: AuthedApi;

/** 回 [位元組, 解碼後保留 BOM 的字串] */
async function readCsv(res: Response): Promise<[Uint8Array, string]> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  // ignoreBOM: true —— 預設的 TextDecoder 也會吃掉 BOM，這裡要留著才驗得到
  return [bytes, new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)];
}

beforeAll(async () => {
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
});

describe('GET /api/export/bookings/:format（issue #33 ③）', () => {
  for (const format of ['csv', 'excel'] as const) {
    it(`${format}：回 text/csv + attachment 檔名 + UTF-8 BOM，不走 { success, data } 信封`, async () => {
      const res = await ownerA.get(`/api/export/bookings/${format}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
      expect(res.headers.get('content-disposition')).toMatch(
        /^attachment; filename="bookings-\d{4}-\d{2}-\d{2}\.csv"$/,
      );
      expect(res.headers.get('cache-control')).toBe('no-store');

      const [bytes, csv] = await readCsv(res);
      // BOM 必須驗**位元組**（見檔頭）
      expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM

      // 不是 JSON 信封：整份內容不得解析成 { success, ... }
      expect(() => JSON.parse(csv.replace('\uFEFF', ''))).toThrow();
      expect(csv).not.toContain('"success"');

      // 第一列是表頭（去掉 BOM 之後）
      const header = csv.replace('\uFEFF', '').split('\r\n')[0];
      expect(header.split(',')).toEqual(
        ['預約編號', '預約時間', '顧客姓名', '顧客電話', '服務', '員工', '金額', '狀態'],
      );
      // 有資料列（seed 的 A 店有 4 筆預約）
      expect(csv.replace('\uFEFF', '').split('\r\n').filter(Boolean).length).toBeGreaterThan(1);
    });
  }

  it('csv 與 excel 兩個分支拿到的是同一份內容（共用同一個產生器，不是兩份實作）', async () => {
    const [, a] = await readCsv(await ownerA.get('/api/export/bookings/csv'));
    const [, b] = await readCsv(await ownerA.get('/api/export/bookings/excel'));
    expect(a).toBe(b);
  });

  it('與無 format 段的舊端點內容一致（#28 ③ 的接線點不會因本輪改動而變）', async () => {
    const [, withFormat] = await readCsv(await ownerA.get('/api/export/bookings/csv'));
    const [, legacy] = await readCsv(await ownerA.get('/api/export/bookings'));
    expect(withFormat).toBe(legacy);
  });

  it('白名單外的 format → 400 REQ_001，且回的是 JSON 信封不是檔案', async () => {
    for (const bad of ['pdf', 'xlsx', 'CSV', 'json']) {
      const res = await ownerA.get(`/api/export/bookings/${bad}`);
      expect(res.status, `format=${bad}`).toBe(400);
      const body = (await res.json()) as Envelope;
      expect(body.success).toBe(false);
      expect(body.code).toBe('REQ_001');
    }
  });

  it('?from&to 真的套用：把區間縮到未來的空窗 → 只剩表頭一列', async () => {
    const res = await ownerA.get('/api/export/bookings/csv?from=2099-01-01&to=2099-01-02');
    expect(res.status).toBe(200);
    const [, csv] = await readCsv(res);
    expect(csv.replace('\uFEFF', '').split('\r\n').filter(Boolean)).toHaveLength(1);
  });

  it('from/to 格式錯誤 → 400 REQ_001（zod 擋在產檔之前）', async () => {
    const res = await ownerA.get('/api/export/bookings/csv?from=2026%2F01%2F01');
    expect(res.status).toBe(400);
    expect(((await res.json()) as Envelope).code).toBe('REQ_001');
  });

  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(`${BASE_URL}/api/export/bookings/csv`);
    expect(res.status).toBe(401);
    expect(((await res.json()) as Envelope).code).toBe('AUTH_001');
  });

  /**
   * ⚠️ 種子只給 A 店建預約（`scripts/test/seed.mjs`「bookings：已寫入 4 筆」全在
   * A 店），B 店一筆都沒有。所以這裡**不能**斷言「B 也有資料列」——第一版這樣
   * 寫，實跑得到 `expected 0 to be greater than 0`。改成正確的口徑：
   * A 有資料列，而 B 的匯出裡連一個 A 的預約編號都找不到。
   */
  it('RLS：A 店的預約編號一個都不出現在 B 店的匯出裡', async () => {
    const [, a] = await readCsv(await ownerA.get('/api/export/bookings/csv'));
    const [, b] = await readCsv(await ownerB.get('/api/export/bookings/csv'));
    expect(a).not.toBe(b);

    const aNos = a.replace('\uFEFF', '').split('\r\n')
      .slice(1).filter(Boolean).map((l) => l.split(',')[0]);
    expect(aNos.length).toBeGreaterThan(0);
    for (const no of aNos) expect(b).not.toContain(no);

    // B 店沒有自己的預約 → 只有表頭一列（也就是它真的沒撈到別人的資料）
    expect(b.replace('\uFEFF', '').split('\r\n').filter(Boolean)).toHaveLength(1);
  });
});
