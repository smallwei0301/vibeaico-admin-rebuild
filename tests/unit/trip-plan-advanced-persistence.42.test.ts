/**
 * #42 — Quick Edit 存檔的真實接線與「不清掉 Advanced 欄位」的守門
 * -----------------------------------------------------------------------------
 * 這裡釘的是 `toAdvancedPlanPayload()` 沒有覆蓋到的下一層：service 邊界的
 * `planApiPayload()`（`src/services/tours.ts`）——它才是真正組出打向
 * `PUT /api/trip-plans/:id` 的 request body 的地方。
 *
 * 修好之前的實際缺口：`toAdvancedPlanPayload()` 早就把 `durationMinutes`／
 * `priceType`／`yearRound` 放進要送出的 `Partial<TripPlan>`（見
 * trip-plan-quick-edit.42.test.ts），但 `planApiPayload()` 組 request body 時
 * 完全沒有把這三個 key 帶上——`planUpdateSchema.parse()` 收到的 body 裡根本
 * 沒有這三個欄位，畫面上改的值因此永遠存不進 `trip_plans`。這是一個看起來
 * 成功（200、toast、reload）但值沒變的假成功，而既有的
 * `tests/integration/api/plan-advanced-settings.10.test.ts` 因為直接打
 * `PUT /api/trip-plans/:id`（繞過 `saveTripPlan`/`planApiPayload`），完全測
 * 不到這一層，所以綠燈綠了很久。
 *
 * 同一份 `planApiPayload()` 也是 Quick Edit 會不會誤把 Advanced 欄位清成
 * 預設值的關鍵：`toQuickPlanPayload()` 回傳的 `Partial<TripPlan>` 本來就不含
 * `durationMinutes`／`priceType`／`yearRound`，那三個 key 在
 * `planApiPayload()` 組出的物件裡會是 `undefined`，`JSON.stringify` 會把整個
 * key 拿掉，後端 `PUT` handler（`src/app/api/trip-plans/[id]/route.ts`）只在
 * `body.xxx !== undefined` 時才把對應欄位放進要 `update()` 的 `patch`——
 * 兩邊合起來才是「Quick Edit 存檔不動 Advanced 欄位」的完整鏈路，
 * 缺任何一段都會變成整批覆蓋或整批漏送。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const svc = readFileSync(resolve(ROOT, 'src/services/tours.ts'), 'utf8');

function fnBody(name: string): string {
  const start = svc.indexOf(`function ${name}(`);
  expect(start, `找不到 ${name}`).toBeGreaterThan(-1);
  const end = svc.indexOf('\n}', start);
  return svc.slice(start, end);
}

describe('#42 planApiPayload 真的把三個 Advanced 欄位送出去', () => {
  const body = fnBody('planApiPayload');

  it('durationMinutes / priceType / yearRound 都在組出的 request body 裡', () => {
    for (const field of ['durationMinutes', 'priceType', 'yearRound']) {
      expect(body, `${field} 沒有被送出去，Advanced Settings 存了也沒有用`).toContain(field);
    }
  });
});

describe('#42 Quick Edit 存檔不會覆蓋 Advanced-only 欄位', () => {
  it('toQuickPlanPayload 的輸出本來就不含任何 Advanced-only key（不會送出 undefined 之外的值）', () => {
    const quickEdit = readFileSync(resolve(ROOT, 'src/lib/trip-plan-quick-edit.ts'), 'utf8');
    const fn = quickEdit.slice(
      quickEdit.indexOf('export function toQuickPlanPayload'),
      quickEdit.indexOf('export function validateQuickPlan'),
    );
    for (const advancedOnlyField of [
      'durationMinutes', 'priceType', 'yearRound', 'minParticipants', 'maxParticipants',
      'depositMode', 'depositValue',
    ]) {
      expect(fn, `toQuickPlanPayload 不該帶 ${advancedOnlyField}，那是 Advanced-only 欄位`)
        .not.toContain(advancedOnlyField);
    }
  });

  it('PUT /api/trip-plans/:id 只在對應欄位存在時才寫入 patch（不是整批覆蓋）', () => {
    const route = readFileSync(
      resolve(ROOT, 'src/app/api/trip-plans/[id]/route.ts'), 'utf8',
    );
    const guarded = [
      ['name', 'patch.name'],
      ['description', 'patch.description'],
      ['pricePerPerson', 'patch.price_per_person'],
      ['childPrice', 'patch.child_price'],
      ['active', 'patch.active'],
      ['durationMinutes', 'patch.duration_minutes'],
      ['priceType', 'patch.price_type'],
      ['yearRound', 'patch.year_round'],
    ] as const;
    for (const [bodyField, patchField] of guarded) {
      const guard = `if (body.${bodyField} !== undefined) ${patchField} =`;
      expect(route, `${bodyField} 沒有做 undefined 守門，會整批覆蓋`).toContain(guard);
    }
    // 沒有任何欄位在守門之外被無條件寫進 patch。
    expect(route).not.toMatch(/const patch: Record<string, unknown> = \{[^}]+\}/);
  });
});
