/**
 * /tenant/trips/[id] 詳情頁的寫入接線 — 單元測試（GitHub issue #8）
 * -----------------------------------------------------------------------------
 * PR #266 修好了**列表頁**的五個假操作。這一檔釘的是同一張 issue 的另一半：
 * **詳情頁**。修改前，除了方案（`savePlan` / 排序）之外，寫入面全部只改頁面記憶體：
 *
 *   const saveBasic = () => {
 *     setTrip(form);                  ← 只動 state
 *     toast.show(t.messages.updated); ← 就宣告「行程已更新」
 *   };
 *
 * 店家改完標題按儲存、重新整理就恢復舊值。團次新增／編輯／批次開團／開關團、
 * 加購儲存、以及方案／加購／團次三種刪除，全部是同一個形狀。
 *
 * 缺口同樣很小：`updateTrip` / `saveTripDeparture` / `batchCreateDepartures` /
 * `saveTripAddon` / `deleteTripPlan` / `deleteTripAddon` 六支 service 與它們的端點
 * 早就在 `main` 上。唯一真的缺件的是 `DELETE /api/trip-departures/:id`
 * （原檔尾寫著「intentionally absent」）——但頁面上的刪除鍵並沒有跟著停用，
 * 於是留下的是一顆假成功。本輪把那支端點補上，見該檔的註解。
 *
 * 斷言集中在行為契約，不在畫面長相：
 *   ① 每個 handler 真的呼叫對應的 service
 *   ② 成功之後才重讀（`runAction` 內 `fn → load → toast`，不做樂觀更新）
 *   ③ 失敗顯示後端真實訊息，且不關閉對話框／不清掉 draft
 *   ④ 沒有欄位是「存了但不會保留」卻不告訴店家（#259 的五個欄位必須有註記）
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';


const ROOT = process.cwd();
const PAGE = 'src/app/tenant/trips/[id]/page.tsx';
const ROUTE = 'src/app/api/trip-departures/[id]/route.ts';
const page = readFileSync(resolve(ROOT, PAGE), 'utf8');
const route = readFileSync(resolve(ROOT, ROUTE), 'utf8');

/** 取出某個 handler 的函式主體（到下一個頂層 `const ` 宣告為止） */
function handlerBody(name: string): string {
  const start = page.indexOf(`const ${name} =`);
  expect(start, `找不到 handler ${name}`).toBeGreaterThan(-1);
  const next = page.indexOf('\n  const ', start + 1);
  return page.slice(start, next > 0 ? next : undefined);
}

const WRITE_SERVICES = [
  'batchCreateDepartures', 'deleteTripAddon', 'deleteTripDeparture', 'deleteTripPlan',
  'requestMidaoListing', 'saveTripAddon', 'saveTripDeparture', 'updateTrip',
];

describe('詳情頁的寫入操作都真的打端點（不是只改 state）', () => {
  it('頁面從 @/services/tours 匯入全部寫入 service', () => {
    const m = page.match(/import\s*\{([^}]*)\}\s*from\s*'@\/services\/tours'/);
    expect(m, '頁面沒有從 @/services/tours 匯入').not.toBeNull();
    const names = m![1].split(',').map((x) => x.trim()).filter(Boolean);
    for (const fn of WRITE_SERVICES) {
      expect(names, `${fn} 沒有被匯入`).toContain(fn);
    }
  });

  const expected: [string, string][] = [
    ['saveBasic', 'updateTrip'],
    ['saveDeparture', 'saveTripDeparture'],
    ['runBatch', 'batchCreateDepartures'],
    ['setDepartureStatus', 'saveTripDeparture'],
    ['saveAddon', 'saveTripAddon'],
  ];

  for (const [handler, service] of expected) {
    it(`${handler} 呼叫 ${service}`, () => {
      expect(handlerBody(handler)).toContain(`${service}(`);
    });
  }

  it('doDelete 三個種類各自呼叫對應的刪除 service', () => {
    const body = handlerBody('doDelete');
    for (const fn of ['deleteTripPlan(', 'deleteTripAddon(', 'deleteTripDeparture(']) {
      expect(body, `doDelete 沒有呼叫 ${fn}`).toContain(fn);
    }
  });

  it('沒有任何寫入 handler 還在用 setState 偽造結果', () => {
    for (const [handler] of expected) {
      const body = handlerBody(handler);
      for (const setter of ['setTrip(', 'setPlans(', 'setDepartures(', 'setAddons(']) {
        expect(body, `${handler} 還在用 ${setter} 直接改畫面`).not.toContain(setter);
      }
    }
    const del = handlerBody('doDelete');
    for (const setter of ['setPlans(', 'setDepartures(', 'setAddons(']) {
      expect(del, `doDelete 還在用 ${setter} 直接改畫面`).not.toContain(setter);
    }
  });
});

describe('runAction：先呼叫端點、成功才重讀、失敗報後端真實訊息', () => {
  const body = handlerBody('runAction');

  it('順序是 fn() → load() → toast，不是樂觀更新', () => {
    const iFn = body.indexOf('await fn()');
    const iLoad = body.indexOf('await load()');
    const iToast = body.indexOf('toast.show(');
    expect(iFn, '沒有 await fn()').toBeGreaterThan(-1);
    expect(iLoad, '沒有 await load()').toBeGreaterThan(iFn);
    expect(iToast, '成功訊息必須在重讀之後').toBeGreaterThan(iLoad);
  });

  it('失敗時顯示 ApiError.message，而不是自己編一句', () => {
    expect(body).toContain('ApiError');
    expect(body).toContain('actionFailedPrefix');
    expect(body).toContain("'danger'");
  });

  it('回傳布林讓呼叫端決定要不要關閉對話框', () => {
    expect(body).toContain('return true');
    expect(body).toContain('return false');
  });
});

describe('失敗時不關閉對話框、不清掉 draft', () => {
  const cases: [string, string][] = [
    ['saveDeparture', 'setDepartureDraft(null)'],
    ['saveAddon', 'setAddonDraft(null)'],
    ['doDelete', 'setDeleteTarget(null)'],
    ['runBatch', 'setBatchOpen(false)'],
  ];
  for (const [handler, clear] of cases) {
    it(`${handler} 只有在成功時才 ${clear}`, () => {
      const body = handlerBody(handler);
      expect(body, `${handler} 沒有 ${clear}`).toContain(clear);
      const idx = body.indexOf(clear);
      const before = body.slice(0, idx);
      expect(before, `${clear} 必須在 if (ok) 之後`).toMatch(/if \(ok\)/);
    });
  }
});

describe('批次開團回報的是後端實際建立的筆數', () => {
  const body = handlerBody('runBatch');

  it('不用前端自己算的 batchCount 當成功訊息', () => {
    const msg = body.slice(body.indexOf('departureBatchCreated'));
    expect(msg.slice(0, 60), '成功訊息不得直接用 batchCount').not.toContain('batchCount');
  });

  it('數字取自後端回傳的 created', () => {
    expect(body).toMatch(/result\s*=\s*await batchCreateDepartures\(/);
    expect(body).toContain('departureBatchCreated(result.created)');
  });

  it('後端略過的筆數也要告訴店家，不能只報建立成功的那些', () => {
    expect(body).toContain('result.skipped');
    expect(body).toContain('departureBatchSkipped');
  });

  it('service 真的把 created／skipped 傳回來（不是型別上寫著、實際回 void）', () => {
    const svc = readFileSync(resolve(ROOT, 'src/services/tours.ts'), 'utf8');
    const fn = svc.slice(
      svc.indexOf('export const batchCreateDepartures'),
      svc.indexOf('export const deleteTripDeparture'),
    );
    expect(fn).toContain('BatchDepartureResult');
    expect(fn).not.toContain('request<void>');
  });
});

describe('DELETE /api/trip-departures/:id 補齊，且有名額守門', () => {
  it('端點真的存在（原本刪除鍵指向一支不存在的路由）', () => {
    expect(route).toMatch(/export const DELETE = handle\(/);
  });

  it('先驗租戶身分與 TOUR_MODULE 訂閱，才做任何寫入', () => {
    const del = route.slice(route.indexOf('export const DELETE'));
    const iTenant = del.indexOf('requireTenantManager()');
    const iFeature = del.indexOf("requireFeature(t.tenantId, 'TOUR_MODULE')");
    const iDelete = del.indexOf(".delete()");
    expect(iTenant).toBeGreaterThan(-1);
    expect(iFeature).toBeGreaterThan(iTenant);
    expect(iDelete, '刪除必須在兩道閘門之後').toBeGreaterThan(iFeature);
  });

  it('已有人報名（seats_booked > 0）回 409，不會靜默把名額吃掉', () => {
    const del = route.slice(route.indexOf('export const DELETE'));
    expect(del).toContain('seats_booked');
    expect(del).toMatch(/fail\(409,/);
    const iGuard = del.indexOf('seats_booked > 0');
    const iDelete = del.indexOf('.delete()');
    expect(iGuard, '沒有 seats_booked > 0 守門').toBeGreaterThan(-1);
    expect(iDelete, '守門必須在實際刪除之前').toBeGreaterThan(iGuard);
  });

  it('查無此團次回 404，而不是回成功', () => {
    const del = route.slice(route.indexOf('export const DELETE'));
    expect(del).toMatch(/fail\(404,/);
  });

  it('刪除限定在自己的租戶（tenant_id 過濾）', () => {
    const del = route.slice(route.indexOf('export const DELETE'));
    const eqs = del.match(/\.eq\('tenant_id', t\.tenantId\)/g) ?? [];
    expect(eqs.length, '讀與刪都必須帶 tenant_id').toBeGreaterThanOrEqual(2);
  });
});

describe('五個展示欄位真的存得進資料庫（#259）', () => {
  /**
   * 這一段原本斷言的是相反的事：`trips`（0066）沒有這五個欄位，所以畫面上必須掛
   * notPersistedYet 註記、`tripApiPayload()` 也不准帶上它們。0089 把欄位補上之後
   * 這個約束整組反過來——欄位建了、值卻還是送不出去，會是比原本更難察覺的假成功。
   */
  const FIELDS = ['tagline', 'exclusions', 'notices', 'meetingPointMapUrl', 'refundPolicyType'];
  const COLUMNS = ['tagline', 'exclusions', 'notices', 'meeting_point_map_url', 'refund_policy_type'];

  it('0089 為五個欄位各加了一個 trips 欄位', () => {
    const sql = readFileSync(resolve(ROOT, 'supabase/migrations/0089_trip_display_fields.sql'), 'utf8');
    expect(sql).toContain('alter table public.trips');
    for (const col of COLUMNS) {
      expect(sql, `${col} 沒有出現在 0089`).toMatch(
        new RegExp(`add column if not exists\\s+${col}\\b`),
      );
    }
  });

  it('陣列欄位用 jsonb，並且對「同名不同型」大聲失敗（PB-026）', () => {
    const sql = readFileSync(resolve(ROOT, 'supabase/migrations/0089_trip_display_fields.sql'), 'utf8');
    // overlay 0016 早就用 jsonb 建過同名欄位。寫 text[] 會在 local-isolated lane
    // 上靜默跳過——CI 綠燈跑 jsonb、真實庫是 text[]，測試永遠測不到那個差異。
    for (const col of ['exclusions', 'notices']) {
      expect(sql, `${col} 不是 jsonb，會與 overlay 的既有形狀分歧`).toMatch(
        new RegExp(`add column if not exists\\s+${col}\\s+jsonb`),
      );
    }
    expect(sql, '沒有把靜默跳過轉成失敗').toContain('information_schema.columns');
    expect(sql, '型別不符時沒有中止').toMatch(/raise exception/);
  });

  it('畫面上不再有「儲存後不會保留」的註記', () => {
    expect(page, '欄位已經會存了，註記留著就是說謊').not.toContain('notPersistedYet');
    const dict = readFileSync(resolve(ROOT, 'src/i18n/zh-TW/pages/trips.ts'), 'utf8');
    expect(dict, '字典裡的舊句子沒有清掉').not.toContain('notPersistedYet');
  });

  it('service 的 tripApiPayload 會把五個欄位送出去', () => {
    const svc = readFileSync(resolve(ROOT, 'src/services/tours.ts'), 'utf8');
    const payload = svc.slice(
      svc.indexOf('function tripApiPayload'),
      svc.indexOf('function planApiPayload'),
    );
    for (const field of FIELDS) {
      expect(payload, `${field} 沒有被送出去，欄位建了也存不進值`).toContain(field);
    }
  });

  it('mapTrip 讀真欄位，不再回硬寫死的空值', () => {
    const mappers = readFileSync(resolve(ROOT, 'src/server/mappers.ts'), 'utf8');
    const fn = mappers.slice(mappers.indexOf('export function mapTrip'));
    const body = fn.slice(0, fn.indexOf('\nexport '));
    for (const col of COLUMNS) {
      expect(body, `mapTrip 沒有讀 ${col}`).toContain(col);
    }
    expect(body, 'refundPolicyType 仍然被寫死成 STANDARD').not.toMatch(
      /refundPolicyType:\s*'STANDARD'/,
    );
  });

  it('新建與更新兩條路徑都會寫入這五個欄位', () => {
    const domain = readFileSync(resolve(ROOT, 'src/server/tour-domain.ts'), 'utf8');
    const row = domain.slice(domain.indexOf('export function tripRow'));
    const rowBody = row.slice(0, row.indexOf('\nexport '));
    for (const col of COLUMNS) {
      expect(rowBody, `tripRow 沒有寫入 ${col}，新建的行程會是空值`).toContain(col);
    }
    const put = readFileSync(resolve(ROOT, 'src/app/api/trips/[id]/route.ts'), 'utf8');
    for (const col of COLUMNS) {
      expect(put, `PUT 沒有更新 ${col}`).toContain(col);
    }
  });

  it('五個欄位仍然可以編輯（復原功能，不是把功能拿掉）', () => {
    for (const field of FIELDS) {
      expect(page, `${field} 的輸入被移除了`).toContain(`patch({ ${field}:`);
    }
  });
});

describe('Midao 上架申請按鈕不再是空殼', () => {
  it('提示區塊的按鈕有 onClick 且呼叫 requestMidaoListing', () => {
    const i = page.indexOf('t.actions.requestMidao');
    expect(i).toBeGreaterThan(-1);
    const block = page.slice(Math.max(0, i - 500), i);
    expect(block, '按鈕沒有接上任何行為').toContain('requestMidaoListing(tripId)');
  });
});
