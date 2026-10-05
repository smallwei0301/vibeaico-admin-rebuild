/** #748 複製草稿的決策／合併純函式；頁面與 Modal 只是薄接線，這裡擋住 reviewer mutation。 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  confirmTripCopyDraft, decideTripCopy, resolveTripCopyFields, tripCopyDraftFromFields,
} from '@/lib/trip-field-limits';

const items = (n: number) => Array.from({ length: n }, () => 'item');
const base = { title: '複本', slug: 's', tagline: 't' };
const oversized = {
  ...base, description: 'd'.repeat(6000), safetyNotice: 'ok',
  inclusions: ['a\nb', '  c  '], exclusions: ['a\nb', '  c  '], notices: [] as string[],
};

describe('decideTripCopy', () => {
  it('來源合規：direct，payload 與來源完全相同（同一個物件內容）', () => {
    const payload = { ...base, description: 'ok', safetyNotice: '', inclusions: ['x'], exclusions: [], notices: [] };
    const d = decideTripCopy(payload);
    expect(d.kind).toBe('direct');
    if (d.kind === 'direct') expect(d.payload).toEqual(payload);
  });

  it('來源超量：draft（絕不 direct），草稿為完整來源值', () => {
    const d = decideTripCopy(oversized);
    expect(d.kind).toBe('draft');
    if (d.kind === 'draft') {
      expect(d.draft.description).toBe(oversized.description);
      expect(d.errors.map((e) => e.field)).toEqual(['description']);
    }
  });
});

describe('confirmTripCopyDraft', () => {
  const draft0 = tripCopyDraftFromFields(oversized);

  it('未修正仍超量：不能確認，且指出該欄位', () => {
    const r = confirmTripCopyDraft(oversized, draft0, draft0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.field)).toEqual(['description']);
  });

  it('編輯後的欄位覆蓋來源（不是初始值）；非文字欄位來自來源', () => {
    const r = confirmTripCopyDraft(oversized, draft0, { ...draft0, description: '精簡後' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.description).toBe('精簡後');
      expect(r.payload.title).toBe('複本');
      expect(r.payload.slug).toBe('s');
    }
  });

  it('草稿內容改變就反映在結果：兩次不同編輯得到不同 payload', () => {
    const a = confirmTripCopyDraft(oversized, draft0, { ...draft0, description: 'A' });
    const b = confirmTripCopyDraft(oversized, draft0, { ...draft0, description: 'B' });
    expect(a.ok && b.ok && a.payload.description !== b.payload.description).toBe(true);
  });

  it('F2：未動過的清單原樣沿用來源（含內嵌換行與前後空白項）', () => {
    const r = confirmTripCopyDraft(oversized, draft0, { ...draft0, description: 'x' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.exclusions).toEqual(['a\nb', '  c  ']);
      expect(r.payload.inclusions).toEqual(['a\nb', '  c  ']);
      expect(r.payload.notices).toEqual([]);
      expect(r.payload.safetyNotice).toBe('ok');
    }
  });

  it('F2：被編輯的清單才正規化（trim、丟空白行、換行拆項）', () => {
    const r = confirmTripCopyDraft(oversized, draft0, {
      ...draft0, description: 'x', exclusionsText: ' a \n\n b ',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.exclusions).toEqual(['a', 'b']);
      expect(r.payload.inclusions).toEqual(['a\nb', '  c  ']);
    }
  });

  it('F2：未編輯但超量的欄位仍會擋住確認', () => {
    const src = { ...base, exclusions: items(25), description: 'ok' };
    const d0 = tripCopyDraftFromFields(src);
    expect(confirmTripCopyDraft(src, d0, { ...d0, description: 'edited' }).ok).toBe(false);
    expect(confirmTripCopyDraft(src, d0, { ...d0, exclusionsText: items(20).join('\n') }).ok).toBe(true);
  });

  it('resolveTripCopyFields：全部未編輯時五個欄位都等於來源', () => {
    const src = { description: 'd', safetyNotice: 's', inclusions: [' a'], exclusions: ['b\nc'], notices: ['n '] };
    expect(resolveTripCopyFields(src, tripCopyDraftFromFields(src), tripCopyDraftFromFields(src))).toEqual(src);
  });
});

describe('接線（原始碼）', () => {
  const modal = readFileSync(resolve(process.cwd(), 'src/components/trips/TripCopyDraftModal.tsx'), 'utf8');
  it('Modal 確認只經過 confirmTripCopyDraft，不直接拿 initial 轉欄位', () => {
    expect(modal).not.toContain('tripCopyDraftToFields(initial)');
    expect(modal).toContain('confirmTripCopyDraft(source, initial, draft)');
  });
});

describe('ToastProvider context value 必須穩定（B1 回歸）', () => {
  /*
   * 限制：repo 沒有 jsdom／testing-library，無法 render 後觀察 re-render 時 identity 是否改變。
   * 這裡只能斷言原始碼的 provider value 是 useMemo 而不是每次 render 新建的 `{{ show }}`；
   * 真正的行為（儲存被擋後 textarea 不被 reload 蓋掉）需在瀏覽器驗證。
   */
  const toast = readFileSync(resolve(process.cwd(), 'src/components/ui/Toast.tsx'), 'utf8');
  it('value 以 useMemo 記憶，不是行內物件', () => {
    expect(toast).toContain('React.useMemo(() => ({ show }), [show])');
    expect(toast).toContain('<ToastContext.Provider value={value}>');
    expect(toast).not.toContain('value={{ show }}');
  });
});
