import { describe, expect, it } from 'vitest';
import { acceptTourRequestSchema } from '@/server/tour-domain';
import { escapeLikePattern, ilikeAnyOf, quotePostgrestValue } from '@/server/postgrest-filter';

/** #921：關鍵字進 PostgREST .or() 的雙層跳脫（LIKE 層 → 引號層）。 */
describe('ilikeAnyOf', () => {
  const cols = ['name', 'phone'];
  const cases: [string, string, string][] = [
    ['一般字', 'abc', '"%abc%"'],
    ['逗號', '王小明,陳', '"%王小明,陳%"'],
    ['括號', '(VIP)', '"%(VIP)%"'],
    ['雙引號', 'a"b', '"%a\\"b%"'],
    ['反斜線（LIKE 層與引號層各一次，共四個）', 'a\\b', '"%a\\\\\\\\b%"'],
    ['百分號為字面', '50%', '"%50\\\\%%"'],
    ['底線為字面', 'a_b', '"%a\\\\_b%"'],
    ['空白', ' a b ', '"% a b %"'],
    ['中文', '祕島', '"%祕島%"'],
    ['混合', '(a,"b")\\50%_', '"%(a,\\"b\\")\\\\\\\\50\\\\%\\\\_%"'],
  ];
  it.each(cases)('%s', (_n, keyword, quoted) => {
    expect(ilikeAnyOf(cols, keyword)).toBe(`name.ilike.${quoted},phone.ilike.${quoted}`);
  });

  it('jsonb 路徑欄位仍放在 ilike 前，值為單一雙引號字串', () => {
    expect(ilikeAnyOf(['order_no', 'contact->>name'], 'x,y')).toBe(
      'order_no.ilike."%x,y%",contact->>name.ilike."%x,y%"',
    );
  });

  it('引號內的 , ( ) 不會在引號外出現（PostgREST 才不會切開）', () => {
    const out = ilikeAnyOf(cols, 'a,(b)');
    expect(out.replace(/"(?:\\.|[^"\\])*"/g, '""')).toBe('name.ilike."",phone.ilike.""');
  });

  it('跳脫函式個別行為', () => {
    expect(escapeLikePattern('\\%_')).toBe('\\\\\\%\\_');
    expect(quotePostgrestValue('a"\\')).toBe('"a\\"\\\\"');
  });
});

describe('acceptTourRequestSchema.holdHours 中文訊息 (#921)', () => {
  const msg = (v: unknown) => {
    const r = acceptTourRequestSchema.safeParse({ holdHours: v });
    return r.success ? null : r.error.issues[0].message;
  };
  it('0 與負數顯示中文', () => {
    expect(msg(0)).toBe('保留時數需大於 0');
    expect(msg(-1)).toBe('保留時數需大於 0');
  });
  it('非數字與無限大顯示中文', () => {
    expect(msg('abc')).toBe('保留時數需為數字');
    expect(msg(Infinity)).toBe('保留時數需為數字');
  });
  it('超過上限、合法值', () => {
    expect(msg(169)).toBe('保留時數過長，請確認輸入');
    expect(msg(1)).toBeNull();
    expect(msg(0.5)).toBeNull();
  });
});
