/** #748：後台共用 helper——未變更欄位不送、前端用與伺服器相同的規則預檢。 */
import { describe, expect, it } from 'vitest';
import {
  countCodePoints, countVisibleItems, omitUnchangedTripTextFields, planTripCopy,
  textToTripLines, tripCopyDraftFromFields, tripCopyDraftToFields, tripTextFieldErrors,
} from '@/lib/trip-field-limits';
import { tripUpdateSchema } from '@/server/tour-domain';

const FIVE = ['description', 'safetyNotice', 'inclusions', 'exclusions', 'notices'] as const;
const items = (n: number, text = 'item') => Array.from({ length: n }, () => text);

const legacy = {
  description: 'd'.repeat(6000),
  safetyNotice: 's'.repeat(2500),
  inclusions: items(25),
  exclusions: items(30),
  notices: ['n'.repeat(400)],
};

describe('omitUnchangedTripTextFields', () => {
  it('歷史超量且未變更：只改標題時 payload 完全沒有五個欄位', () => {
    const out = omitUnchangedTripTextFields({ title: '新', ...legacy }, legacy);
    expect(out).toEqual({ title: '新' });
    for (const key of FIVE) expect(key in out).toBe(false);
  });

  it('不改動傳入的 form 物件', () => {
    const form = { title: '新', ...legacy };
    omitUnchangedTripTextFields(form, legacy);
    expect(Object.keys(form)).toContain('description');
  });

  it('明確清空（原值非空）必須送出：空字串與空陣列都保留', () => {
    const out = omitUnchangedTripTextFields(
      { description: '', safetyNotice: '', inclusions: [], exclusions: [], notices: [] }, legacy,
    );
    expect(out).toEqual({ description: '', safetyNotice: '', inclusions: [], exclusions: [], notices: [] });
  });

  it('原值本來就是空：清空狀態視為未變更而不送', () => {
    const empty = { description: '', safetyNotice: '', inclusions: [], exclusions: [], notices: [] };
    expect(omitUnchangedTripTextFields({ ...empty }, empty)).toEqual({});
  });

  it('改了一個字就保留該欄位，其餘未變更欄位仍省略', () => {
    const out = omitUnchangedTripTextFields({ ...legacy, description: `${legacy.description}x` }, legacy);
    expect(out).toEqual({ description: `${legacy.description}x` });
  });

  it('清單順序改變視為變更；項目數不同視為變更', () => {
    const original = { inclusions: ['a', 'b', 'c'] };
    expect(omitUnchangedTripTextFields({ inclusions: ['c', 'b', 'a'] }, original)).toEqual({ inclusions: ['c', 'b', 'a'] });
    expect(omitUnchangedTripTextFields({ inclusions: ['a', 'b'] }, original)).toEqual({ inclusions: ['a', 'b'] });
    expect(omitUnchangedTripTextFields({ inclusions: ['a', 'b', 'c'] }, original)).toEqual({});
  });

  it('只差空白也視為變更（比較前不 trim）', () => {
    const original = { description: 'abc', inclusions: ['a'] };
    expect(omitUnchangedTripTextFields({ description: 'abc ', inclusions: ['a '] }, original))
      .toEqual({ description: 'abc ', inclusions: ['a '] });
  });

  it('沒有原始資料時五個欄位若有值就保留', () => {
    expect(omitUnchangedTripTextFields({ description: 'x' }, null)).toEqual({ description: 'x' });
  });

  it('不碰其他欄位（包含 galleryUrls）', () => {
    const out = omitUnchangedTripTextFields({ title: 't', galleryUrls: ['u'], ...legacy }, legacy);
    expect(out).toEqual({ title: 't', galleryUrls: ['u'] });
  });
});

describe('tripTextFieldErrors', () => {
  it('沒有任何欄位或空物件：無錯誤；只檢查有出現的欄位', () => {
    expect(tripTextFieldErrors({})).toEqual([]);
    expect(tripTextFieldErrors({ description: 'x'.repeat(6000) }).map((e) => e.field)).toEqual(['description']);
  });

  it('description 以 code point 計：5000 通過、5001 失敗，emoji 算 1', () => {
    expect(tripTextFieldErrors({ description: '😀'.repeat(5000) })).toEqual([]);
    expect(tripTextFieldErrors({ description: '😀'.repeat(5001) }))
      .toEqual([{ field: 'description', kind: 'tooLong', limit: 5000 }]);
    expect(tripTextFieldErrors({ description: 'a'.repeat(5001) })).toHaveLength(1);
  });

  it('safetyNotice：2000 通過、2001 失敗（emoji 同樣算 1）', () => {
    expect(tripTextFieldErrors({ safetyNotice: '😀'.repeat(2000) })).toEqual([]);
    expect(tripTextFieldErrors({ safetyNotice: '😀'.repeat(2001) }))
      .toEqual([{ field: 'safetyNotice', kind: 'tooLong', limit: 2000 }]);
  });

  it.each(['exclusions', 'notices'] as const)('%s：20 項通過、21 項 tooManyItems', (field) => {
    expect(tripTextFieldErrors({ [field]: items(20) })).toEqual([]);
    expect(tripTextFieldErrors({ [field]: items(21) })).toEqual([{ field, kind: 'tooManyItems', limit: 20 }]);
  });

  it.each(['exclusions', 'notices', 'inclusions'] as const)('%s：單項 300 通過、301 itemTooLong', (field) => {
    expect(tripTextFieldErrors({ [field]: ['a'.repeat(300)] })).toEqual([]);
    expect(tripTextFieldErrors({ [field]: ['😀'.repeat(300)] })).toEqual([]);
    expect(tripTextFieldErrors({ [field]: ['a'.repeat(301)] })).toEqual([{ field, kind: 'itemTooLong', limit: 300 }]);
  });

  it('前後空白不計入單項長度；空白項不計入項數', () => {
    expect(tripTextFieldErrors({ notices: [`  ${'a'.repeat(300)}  `] })).toEqual([]);
    expect(tripTextFieldErrors({ notices: [`  ${'a'.repeat(301)}  `] })).toHaveLength(1);
    expect(tripTextFieldErrors({ notices: [...items(20), '', '   ', '\t'] })).toEqual([]);
    expect(tripTextFieldErrors({ notices: [...items(21), ''] })).toHaveLength(1);
  });

  it('同時項數過多與單項過長：項數優先回報', () => {
    expect(tripTextFieldErrors({ exclusions: [...items(20), 'a'.repeat(301)] }))
      .toEqual([{ field: 'exclusions', kind: 'tooManyItems', limit: 20 }]);
  });

  it('inclusions 以 join("\\n") 後的傳輸形式判定：內含換行的單項會被拆開計數', () => {
    expect(tripTextFieldErrors({ inclusions: [items(21).join('\n')] }))
      .toEqual([{ field: 'inclusions', kind: 'tooManyItems', limit: 20 }]);
    expect(tripTextFieldErrors({ inclusions: [items(21).join('\r\n')] })).toHaveLength(1);
    expect(tripTextFieldErrors({ inclusions: [items(20).join('\n')] })).toEqual([]);
  });

  it('明確清空（空字串、空陣列）不是錯誤', () => {
    expect(tripTextFieldErrors({ description: '', safetyNotice: '', inclusions: [], exclusions: [], notices: [] })).toEqual([]);
  });

  it('多個欄位同時違規：每個欄位各回報一次', () => {
    expect(tripTextFieldErrors(legacy).map((e) => e.field).sort())
      .toEqual(['description', 'exclusions', 'inclusions', 'notices', 'safetyNotice']);
  });

  it('與伺服器 tripUpdateSchema 判定一致（以 UI 形狀轉成傳輸形狀）', () => {
    const cases = [legacy, { description: 'x'.repeat(5000) }, { inclusions: items(20) }, { inclusions: items(21) },
      { notices: [`  ${'a'.repeat(300)}  `] }, { exclusions: ['a'.repeat(301)] }, { safetyNotice: '😀'.repeat(2001) }];
    for (const ui of cases) {
      const body = {
        description: (ui as { description?: string }).description,
        notes: (ui as { safetyNotice?: string }).safetyNotice,
        includes: (ui as { inclusions?: string[] }).inclusions?.join('\n'),
        exclusions: (ui as { exclusions?: string[] }).exclusions,
        notices: (ui as { notices?: string[] }).notices,
      };
      expect(tripTextFieldErrors(ui).length === 0, JSON.stringify(Object.keys(ui))).toBe(tripUpdateSchema.safeParse(body).success);
    }
  });
});

describe('計數 helper', () => {
  it('countCodePoints：emoji 算 1、空字串 0', () => {
    expect(countCodePoints('')).toBe(0);
    expect(countCodePoints('a😀b')).toBe(3);
  });

  it('countVisibleItems：只算 trim 後非空白的項目', () => {
    expect(countVisibleItems(['a', ' ', '', ' b '])).toBe(2);
  });

  it('textToTripLines：LF／CRLF 皆可，trim 並丟掉空白行', () => {
    expect(textToTripLines(' a \r\n\r\n b\n  \nc')).toEqual(['a', 'b', 'c']);
  });
});

describe('複製草稿 helper', () => {
  it('來源全部合規：直接複製', () => {
    expect(planTripCopy({ description: 'ok', inclusions: items(3) })).toEqual({ kind: 'direct' });
  });

  it('來源有超量欄位：開草稿，且草稿帶完整來源值（不截斷）', () => {
    const plan = planTripCopy(legacy);
    expect(plan.kind).toBe('draft');
    if (plan.kind !== 'draft') return;
    expect(plan.draft.description).toBe(legacy.description);
    expect(plan.draft.safetyNotice).toBe(legacy.safetyNotice);
    expect(plan.draft.inclusionsText.split('\n')).toHaveLength(25);
    expect(plan.draft.exclusionsText.split('\n')).toHaveLength(30);
    expect(plan.draft.noticesText).toBe(legacy.notices[0]);
    expect(plan.errors).toHaveLength(5);
  });

  it('草稿 ↔ 欄位來回轉換，且修正後驗證通過', () => {
    const draft = tripCopyDraftFromFields(legacy);
    expect(tripCopyDraftToFields(draft)).toEqual(legacy);
    const fixed = tripCopyDraftToFields({
      ...draft, description: 'd', safetyNotice: 's', inclusionsText: 'a\n\n b ', exclusionsText: '', noticesText: 'n',
    });
    expect(fixed).toEqual({ description: 'd', safetyNotice: 's', inclusions: ['a', 'b'], exclusions: [], notices: ['n'] });
    expect(tripTextFieldErrors(fixed)).toEqual([]);
  });
});
