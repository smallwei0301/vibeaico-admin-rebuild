/**
 * #785：清單欄位「原始」大小上限（儲存安全天花板）。
 * 可見上限（忽略空白、trim 後計數）擋不住「靠空白／空項塞超大 payload」，
 * 所以另設：清單原始項數 ≤ 200、每項原始（未 trim）≤ 3000 code points、includes 整體原始 ≤ 20000 code points。
 * server schema 與後台 UI（tripTextFieldErrors）共用同一份判斷。
 */
import { describe, expect, it } from 'vitest';
import { tripCreateSchema, tripUpdateSchema } from '@/server/tour-domain';
import {
  tripIncludesViolation, tripListViolation, tripTextFieldErrors, withinTripIncludesLimits,
} from '@/lib/trip-field-limits';
import {
  MAX_TRIP_INCLUDES_RAW_CHARS, MAX_TRIP_LIST_ITEM_RAW_CHARS, MAX_TRIP_LIST_RAW_ITEMS,
} from '@/lib/public-trip-limits';

const SCHEMAS = [
  { kind: 'create', schema: tripCreateSchema, base: { title: 't' } },
  { kind: 'update', schema: tripUpdateSchema, base: {} },
] as const;

const EMOJI = '😀';

/** 恰好 n 個 code point 的 includes：每行 'x' + 空白（每行 ≤ 2000 code points，不觸發單項原始上限）。 */
function includesOfLength(n: number, lead = 'x'): string {
  const lines: string[] = [];
  let left = n;
  while (left > 0) {
    const take = Math.min(left, 2000);
    lines.push(lead + ' '.repeat(take - Array.from(lead).length));
    left -= take + 1; // 含換行
  }
  const value = lines.join('\n');
  return value + ' '.repeat(n - Array.from(value).length);
}

const ATTACKS = [
  ['exclusions 單項 100 萬空白', { exclusions: [' '.repeat(1_000_000)] }],
  ['notices 10 萬個空字串', { notices: Array(100_000).fill('') }],
  ['includes 100 萬換行', { includes: '\n'.repeat(1_000_000) }],
  ['exclusions 單項 x + 50 萬空白', { exclusions: ['x' + ' '.repeat(500_000)] }],
] as const;

describe.each(SCHEMAS)('$kind schema：原始大小上限', ({ schema, base }) => {
  it.each(ATTACKS)('%s 被拒', (_label, payload) => {
    expect(schema.safeParse({ ...base, ...payload }).success).toBe(false);
  });

  it('攻擊 payload 檢查是 early-exit（不會因 100 萬字元卡住）', () => {
    const started = Date.now();
    for (const [, payload] of ATTACKS) schema.safeParse({ ...base, ...payload });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('清單剛好 200 個原始項（可見項 ≤ 20）通過且原樣保存；201 失敗', () => {
    const at = [...Array(20).fill('item'), ...Array(MAX_TRIP_LIST_RAW_ITEMS - 20).fill('')];
    const ok = schema.safeParse({ ...base, exclusions: at, notices: at });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.exclusions).toEqual(at);
    expect(schema.safeParse({ ...base, exclusions: [...at, ''] }).success).toBe(false);
    expect(schema.safeParse({ ...base, notices: [...at, ''] }).success).toBe(false);
  });

  it('每項原始剛好 3000 通過（含 padding）；3001 失敗', () => {
    const padded = 'x' + ' '.repeat(MAX_TRIP_LIST_ITEM_RAW_CHARS - 1);
    const ok = schema.safeParse({ ...base, exclusions: [padded] });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.exclusions).toEqual([padded]);
    expect(schema.safeParse({ ...base, exclusions: [padded + ' '] }).success).toBe(false);
    expect(schema.safeParse({ ...base, notices: [padded + ' '] }).success).toBe(false);
  });

  it('includes 整體原始剛好 20000 通過；20001 失敗（每行都合規）', () => {
    expect(Array.from(includesOfLength(MAX_TRIP_INCLUDES_RAW_CHARS)).length).toBe(MAX_TRIP_INCLUDES_RAW_CHARS);
    expect(schema.safeParse({ ...base, includes: includesOfLength(MAX_TRIP_INCLUDES_RAW_CHARS) }).success).toBe(true);
    expect(schema.safeParse({ ...base, includes: includesOfLength(MAX_TRIP_INCLUDES_RAW_CHARS + 1) }).success).toBe(false);
  });

  it('可見值合規加少量 padding 仍通過且原樣保存', () => {
    const includes = '  含早餐  \n\n  含接送  \n';
    const exclusions = ['  小費  ', '', '   '];
    const ok = schema.safeParse({ ...base, includes, exclusions });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.includes).toBe(includes);
      expect(ok.data.exclusions).toEqual(exclusions);
    }
  });
});

describe('code point 計數（emoji 算 1）', () => {
  it('每項原始 3000 個 emoji 通過；3001 失敗（以 code point 計，非 UTF-16 length）', () => {
    // 可見上限 300 會先擋，所以用「前面 padding + 少量 emoji」湊原始長度
    const make = (n: number) => EMOJI + ' '.repeat(n - 1);
    expect(tripListViolation([make(MAX_TRIP_LIST_ITEM_RAW_CHARS)])).toBeNull();
    expect(tripListViolation([make(MAX_TRIP_LIST_ITEM_RAW_CHARS + 1)])).toBe('itemRawTooLong');
  });

  it('includes 整體以 code point 計：20000 個 emoji 空白混合通過', () => {
    const value = includesOfLength(MAX_TRIP_INCLUDES_RAW_CHARS, EMOJI);
    expect(Array.from(value).length).toBe(MAX_TRIP_INCLUDES_RAW_CHARS);
    expect(value.length).toBeGreaterThan(MAX_TRIP_INCLUDES_RAW_CHARS); // UTF-16 length 大於 code point 數
    expect(tripIncludesViolation(value)).toBeNull();
    expect(tripIncludesViolation(value + ' ')).toBe('includesRawTooLarge');
  });
});

describe('violation 種類', () => {
  it('原始項數 > 200 → tooManyRawItems；可見項 > 20 且原始 ≤ 200 → tooManyItems', () => {
    expect(tripListViolation(Array(201).fill(''))).toBe('tooManyRawItems');
    expect(tripListViolation(Array(21).fill('a'))).toBe('tooManyItems');
  });
  it('includes：整體過大優先於拆行', () => {
    expect(tripIncludesViolation('\n'.repeat(MAX_TRIP_INCLUDES_RAW_CHARS + 1))).toBe('includesRawTooLarge');
    expect(tripIncludesViolation('\n'.repeat(MAX_TRIP_INCLUDES_RAW_CHARS))).toBe('tooManyRawItems');
    expect(withinTripIncludesLimits('a\nb')).toBe(true);
  });
});

describe('client tripTextFieldErrors 與 server 一致', () => {
  it('四個攻擊 payload 在 client 都有對應欄位錯誤，且 limit 為對應原始上限', () => {
    const e1 = tripTextFieldErrors({ exclusions: [' '.repeat(1_000_000)] });
    expect(e1).toEqual([{ field: 'exclusions', kind: 'itemRawTooLong', limit: MAX_TRIP_LIST_ITEM_RAW_CHARS }]);
    const e2 = tripTextFieldErrors({ notices: Array(100_000).fill('') });
    expect(e2).toEqual([{ field: 'notices', kind: 'tooManyRawItems', limit: MAX_TRIP_LIST_RAW_ITEMS }]);
    const e3 = tripTextFieldErrors({ inclusions: ['\n'.repeat(1_000_000)] });
    expect(e3).toEqual([{ field: 'inclusions', kind: 'includesRawTooLarge', limit: MAX_TRIP_INCLUDES_RAW_CHARS }]);
    const e4 = tripTextFieldErrors({ exclusions: ['x' + ' '.repeat(500_000)] });
    expect(e4).toEqual([{ field: 'exclusions', kind: 'itemRawTooLong', limit: MAX_TRIP_LIST_ITEM_RAW_CHARS }]);
  });

  it('client 與 server 對同一 payload 判斷一致（含邊界）', () => {
    const cases: string[][] = [
      Array(200).fill(''), Array(201).fill(''),
      ['x' + ' '.repeat(2999)], ['x' + ' '.repeat(3000)],
      ['  合規  ', ''],
    ];
    for (const items of cases) {
      const server = tripCreateSchema.safeParse({ title: 't', exclusions: items }).success;
      expect(tripTextFieldErrors({ exclusions: items }).length === 0).toBe(server);
    }
  });

  it('i18n 有每個新 kind 的文案（不會 fall through 成空字串）', async () => {
    const { tripsPage } = await import('@/i18n/zh-TW/pages/trips');
    for (const kind of ['tooManyRawItems', 'itemRawTooLong', 'includesRawTooLarge'] as const) {
      expect(tripsPage.limits.errors[kind](123)).toContain('123');
    }
  });
});
