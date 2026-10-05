/**
 * #748：行程寫入端 schema 與公開輸出使用同一組可見上限。
 * 契約：description ≤ 5000、notes ≤ 2000 code points；includes（換行傳輸）、exclusions、notices
 * 的每個清單忽略空白項、最多 20 個非空白項、每項 trim 後 ≤ 300 code points。
 * 通過的 payload 原樣保存（不 trim、不截斷）。
 */
import { describe, expect, it } from 'vitest';
import { tripCreateSchema, tripUpdateSchema } from '@/server/tour-domain';

const SCHEMAS = [
  { kind: 'create', schema: tripCreateSchema, base: { title: 't' } },
  { kind: 'update', schema: tripUpdateSchema, base: {} },
] as const;

const EMOJI = '😀'; // surrogate pair：length 2，但只算 1 個 code point
const CHARS = [['a', 'ASCII'], [EMOJI, 'emoji']] as const;

describe.each(SCHEMAS)('$kind schema：文字欄位上限', ({ schema, base }) => {
  const TEXT_LIMITS = [['description', 5000], ['notes', 2000]] as const;

  for (const [field, max] of TEXT_LIMITS) {
    for (const [char, label] of CHARS) {
      for (const count of [0, max, max + 1]) {
        it(`${field} ${label} × ${count} ${count <= max ? '通過且原樣保存' : '被拒並指向該欄位'}`, () => {
          const value = char.repeat(count);
          const result = schema.safeParse({ ...base, [field]: value });
          expect(result.success).toBe(count <= max);
          if (result.success) {
            expect(result.data[field]).toBe(value);
          } else {
            expect(result.error.issues[0].path).toEqual([field]);
            expect(result.error.issues[0].message).toContain(String(max));
          }
        });
      }
    }

    it(`${field} 明確清空（空字串）可通過`, () => {
      const result = schema.safeParse({ ...base, [field]: '' });
      expect(result.success).toBe(true);
    });
  }

  it('省略所有受限欄位可通過', () => {
    expect(schema.safeParse(base).success).toBe(true);
  });

  it('圖庫張數上限不變（8 張通過、9 張被拒）', () => {
    expect(schema.safeParse({ ...base, gallery: Array(8).fill('x') }).success).toBe(true);
    expect(schema.safeParse({ ...base, gallery: Array(9).fill('x') }).success).toBe(false);
  });
});

/** includes 以換行字串傳輸；exclusions／notices 是陣列。 */
const LIST_FIELDS = [
  { field: 'includes', encode: (items: string[]) => items.join('\n'), label: 'includes（LF）' },
  { field: 'includes', encode: (items: string[]) => items.join('\r\n'), label: 'includes（CRLF）' },
  { field: 'exclusions', encode: (items: string[]) => items, label: 'exclusions' },
  { field: 'notices', encode: (items: string[]) => items, label: 'notices' },
] as const;

describe.each(SCHEMAS)('$kind schema：清單欄位上限', ({ schema, base }) => {
  describe.each(LIST_FIELDS)('$label', ({ field, encode }) => {
    const parse = (items: string[]) => schema.safeParse({ ...base, [field]: encode(items) });

    it.each([0, 20, 21])('%i 個非空白項目：20 以內通過、21 被拒', (count) => {
      expect(parse(Array(count).fill('item')).success).toBe(count <= 20);
    });

    it.each(CHARS)('單項 300 字通過、301 字被拒（%s）', (char) => {
      expect(parse([char.repeat(300)]).success).toBe(true);
      const over = parse([char.repeat(301)]);
      expect(over.success).toBe(false);
      if (!over.success) expect(over.error.issues[0].path[0]).toBe(field);
    });

    it('前後空白不計入單項長度：兩側各補空白的 300 字通過、301 字被拒', () => {
      expect(parse([`  ${'a'.repeat(300)}  `]).success).toBe(true);
      expect(parse([`  ${'a'.repeat(301)}  `]).success).toBe(false);
    });

    it('空白項不計入項數：20 個非空白項加上空白與純空白項仍通過，第 21 個非空白項被拒', () => {
      const twenty = Array(20).fill('y');
      expect(parse([' ', '', '   ', ...twenty, '', '\t']).success).toBe(true);
      expect(parse([' ', ...twenty, '', 'z']).success).toBe(false);
    });

    it('通過時原樣保存（不 trim、不丟空白項）', () => {
      const input = encode([' ', '  x  ', '', ...Array(19).fill('y')]);
      const parsed = schema.parse({ ...base, [field]: input }) as Record<string, unknown>;
      expect(parsed[field]).toEqual(input);
    });

    it('明確清空可通過（空字串或空陣列）', () => {
      expect(parse([]).success).toBe(true);
    });
  });

  it('includes 的 LF 傳輸與 CRLF 傳輸判定一致', () => {
    const items = Array(21).fill('item');
    expect(schema.safeParse({ ...base, includes: items.join('\n') }).success).toBe(false);
    expect(schema.safeParse({ ...base, includes: items.join('\r\n') }).success).toBe(false);
  });

  it('includes 明確傳空字串可通過', () => {
    expect(schema.safeParse({ ...base, includes: '' }).success).toBe(true);
  });

  it('exclusions／notices 明確傳 [] 可通過', () => {
    expect(schema.safeParse({ ...base, exclusions: [], notices: [] }).success).toBe(true);
  });
});
