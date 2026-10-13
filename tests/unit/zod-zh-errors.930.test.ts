import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { zhErrorMap } from '@/server/zod-zh';
import { handle } from '@/server/http';
import { resyncAfterFailure, saveAllThenResync } from '@/lib/trip-plan-resync';

const msg = (schema: z.ZodTypeAny, v: unknown) => {
  const r = schema.safeParse(v, { errorMap: undefined });
  return r.success ? '' : r.error.issues[0].message;
};
const noCjk = (s: string) => !/Invalid|Required|Expected|String must|Number must/.test(s);

describe('#930 zod 預設訊息中文化（global map 已由 handle() 載入 http.ts 安裝）', () => {
  it('invalid_type / required', () => {
    expect(msg(z.string(), undefined)).toBe('此欄位為必填');
    expect(msg(z.string(), 5)).toBe('請輸入文字');
    expect(msg(z.number(), 'x')).toBe('請輸入數字');
    expect(msg(z.boolean(), 'x')).toBe('請選擇是或否');
    expect(msg(z.array(z.string()), 'x')).toBe('請提供清單格式');
  });
  it('too_small / too_big 依型別與 inclusive/exact', () => {
    expect(msg(z.string().min(3), 'a')).toBe('至少需要 3 個字');
    expect(msg(z.string().max(2), 'abc')).toBe('最多 2 個字');
    expect(msg(z.string().length(4), 'abc')).toBe('必須剛好 4 個字');
    expect(msg(z.number().min(1), 0)).toBe('不得小於 1');
    expect(msg(z.number().gt(1), 1)).toBe('必須大於 1');
    expect(msg(z.number().max(5), 9)).toBe('不得大於 5');
    expect(msg(z.number().lt(5), 5)).toBe('必須小於 5');
    expect(msg(z.array(z.string()).min(2), ['a'])).toBe('至少需要 2 筆');
    expect(msg(z.array(z.string()).max(1), ['a', 'b'])).toBe('最多 1 筆');
    expect(msg(z.array(z.string()).length(2), [])).toBe('必須剛好 2 筆');
    expect(msg(z.date().min(new Date('2030-01-01')), new Date('2020-01-01'))).toContain('日期不得早於');
    expect(msg(z.date().max(new Date('2020-01-01')), new Date('2030-01-01'))).toContain('日期不得晚於');
  });
  it('invalid_string 各 validation', () => {
    expect(msg(z.string().email(), 'x')).toBe('請輸入有效的 Email');
    expect(msg(z.string().url(), 'x')).toBe('請輸入有效的網址');
    expect(msg(z.string().uuid(), 'x')).toBe('識別碼格式錯誤');
    expect(msg(z.string().regex(/^a$/), 'b')).toBe('格式不符');
    expect(msg(z.string().datetime(), 'x')).toBe('請輸入有效的日期時間');
    expect(msg(z.string().startsWith('ab'), 'x')).toBe('必須以「ab」開頭');
  });
  it('enum / literal / multipleOf / date / keys / union / int', () => {
    expect(msg(z.enum(['a', 'b']), 'c')).toBe('請選擇有效的選項（a、b）');
    expect(msg(z.literal('x'), 'y')).toBe('數值必須為 "x"');
    expect(msg(z.number().multipleOf(5), 3)).toBe('必須是 5 的倍數');
    expect(msg(z.date(), new Date('x'))).toBe('請輸入有效日期');
    expect(msg(z.object({ a: z.string() }).strict(), { a: 'x', b: 1 })).toBe('包含不允許的欄位：b');
    expect(msg(z.union([z.string(), z.number()]), true)).toBe('輸入格式錯誤');
    expect(msg(z.number().int(), 1.5)).toBe('請輸入整數');
    expect(msg(z.number().finite(), Infinity)).toContain('數字');
    expect(msg(z.string().refine(() => false), 'x')).toBe('輸入格式錯誤');
  });
  it('所有訊息不含英文預設字樣', () => {
    for (const [s, v] of [[z.string(), undefined], [z.string().min(2), 'a'], [z.string().email(), 'x']] as const) {
      expect(noCjk(msg(s, v))).toBe(true);
    }
  });
  it('zhErrorMap 本身對未知 code 回 fallback', () => {
    expect(zhErrorMap({ code: 'zzz' } as never, { defaultError: 'Invalid input', data: 1 }).message).toBe('輸入格式錯誤');
  });
  it('schema 自訂 message 優先於 global map', () => {
    expect(msg(z.string().min(3, '店名太短'), 'a')).toBe('店名太短');
    expect(msg(z.string({ required_error: '請填店名' }), undefined)).toBe('請填店名');
    expect(msg(z.string().email({ message: '信箱怪怪的' }), 'x')).toBe('信箱怪怪的');
    expect(msg(z.string().refine(() => false, '自訂檢查失敗'), 'x')).toBe('自訂檢查失敗');
  });
  it('handle() 包假 route：zod 失敗回 400 中文，自訂訊息保留', async () => {
    const route = handle(async () => {
      z.object({ name: z.string(), age: z.number().min(18, '未滿 18 歲') }).parse({ age: 3 });
      return new Response('ok');
    });
    const r1 = await route(new Request('http://x/api/t', { method: 'GET' }), {});
    expect(r1.status).toBe(400);
    const b1 = await r1.json();
    expect(b1.code).toBe('REQ_001');
    expect(b1.message).toBe('此欄位為必填');

    const route2 = handle(async () => {
      z.object({ age: z.number().min(18, '未滿 18 歲') }).parse({ age: 3 });
      return new Response('ok');
    });
    const b2 = await (await route2(new Request('http://x/api/t'), {})).json();
    expect(b2.message).toBe('未滿 18 歲');
  });
});

describe('#930 movePlan 失敗後重讀', () => {
  it('resyncAfterFailure：重讀成功即套用', async () => {
    let applied: number[] | null = null;
    expect(await resyncAfterFailure(async () => [1, 2], (l) => { applied = l; })).toBe(true);
    expect(applied).toEqual([1, 2]);
  });
  it('重讀失敗靜默保留原狀（不丟、不套用）', async () => {
    let applied = false;
    const ok = await resyncAfterFailure(async () => { throw new Error('x'); }, () => { applied = true; });
    expect(ok).toBe(false);
    expect(applied).toBe(false);
  });
  it('saveAllThenResync：一筆快速失敗、一筆較慢成功，重讀發生在全部 settled 之後', async () => {
    const events: string[] = [];
    const slow = () => new Promise<void>((res) => setTimeout(() => { events.push('slow-done'); res(); }, 30));
    const fast = async () => { events.push('fast-fail'); throw new Error('boom'); };
    let applied: number[] | null = null;
    const r = await saveAllThenResync([fast, slow], async () => { events.push('refetch'); return [7]; }, (l) => { applied = l; });
    expect(events).toEqual(['fast-fail', 'slow-done', 'refetch']);
    expect(r.ok).toBe(false);
    expect(r.ok === false && (r.error as Error).message).toBe('boom');
    expect(applied).toEqual([7]);
  });
  it('saveAllThenResync：全部成功不走失敗路徑，只重讀一次', async () => {
    let fetches = 0;
    let applied: number[] | null = null;
    const r = await saveAllThenResync([async () => 1, async () => 2], async () => { fetches += 1; return [1]; }, (l) => { applied = l; });
    expect(r).toEqual({ ok: true });
    expect(fetches).toBe(1);
    expect(applied).toEqual([1]);
  });
  it('saveAllThenResync：失敗後重讀也失敗不 throw，回傳原失敗原因', async () => {
    const r = await saveAllThenResync(
      [async () => { throw new Error('first'); }],
      async () => { throw new Error('refetch'); },
      () => { throw new Error('should not apply'); },
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && (r.error as Error).message).toBe('first');
  });
  it('page.tsx movePlan 非 mock 時以 saveAllThenResync 等全部寫入後重讀，不再用 Promise.all', () => {
    const src = readFileSync('src/app/tenant/trips/[id]/page.tsx', 'utf8');
    const start = src.indexOf('const movePlan');
    const body = src.slice(start, src.indexOf('/* ---', start));
    expect(body).not.toContain('Promise.all(');
    expect(body).toMatch(/await saveAllThenResync\(/);
    expect(body).toMatch(/\(\) => listTripPlans\(tripId\),\s*setPlans/);
    expect(body).toContain('t.messages.planOrderFailed');
  });
});
