/**
 * #748 NB-5／NB-6：複製草稿 modal 的計數接線守門，以及 tripCopyDraftMeta 顯示語意。
 * repo 無 jsdom，NB-5 以原始碼結構斷言守門：modal 各欄位的計數必須來自
 * `tripCopyDraftMeta(...)` 的 `display`（inclusions 以伺服器看到的換行傳輸形式拆開），
 * 不得直接用草稿原文計數（否則 inclusions 內含 '\n' 時顯示項數與伺服器不一致）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  tripCopyDraftFromFields, tripCopyDraftMeta, type TripTextFields,
} from '@/lib/trip-field-limits';

const modal = readFileSync(resolve(process.cwd(), 'src/components/trips/TripCopyDraftModal.tsx'), 'utf8');

const FIELDS = ['description', 'inclusions', 'exclusions', 'notices', 'safetyNotice'] as const;

describe('NB-5：TripCopyDraftModal 計數接線', () => {
  it('以 tripCopyDraftMeta 取得 display', () => {
    expect(modal).toMatch(/tripCopyDraftMeta\s*\(\s*source\s*,\s*initial\s*,\s*draft\s*\)/);
    expect(modal).toMatch(/const\s*\{[^}]*\bdisplay\b[^}]*\}\s*=\s*tripCopyDraftMeta\(/);
  });

  it.each(FIELDS)('%s 的 TripTextFieldMeta value 來自 display 的同名欄位', (field) => {
    const re = new RegExp(`<TripTextFieldMeta\\s+field="${field}"\\s+value=\\{([^}]*)\\}`);
    const m = modal.match(re);
    expect(m, `找不到 ${field} 的 TripTextFieldMeta`).not.toBeNull();
    expect(m![1].trim()).toBe(`display.${field}`);
  });

  it('TripTextFieldMeta 的 value 一律是 display.*，沒有任何一處讀草稿原文', () => {
    const values = [...modal.matchAll(/<TripTextFieldMeta\b[^>]*?\bvalue=\{([^}]*)\}/g)].map((m) => m[1].trim());
    expect(values).toHaveLength(FIELDS.length);
    for (const v of values) expect(v).toMatch(/^display\./);
    expect(modal).not.toMatch(/<TripTextFieldMeta[^>]*value=\{[^}]*draft\./);
    expect(modal).not.toMatch(/textToTripLines\s*\(\s*draft\./);
  });
});

describe('NB-6：tripCopyDraftMeta 顯示語意', () => {
  const source: TripTextFields = {
    description: '介紹',
    safetyNotice: '提醒',
    inclusions: ['含早餐\n含午餐', '含接送'],
    exclusions: ['小費', '個人保險'],
    notices: ['請準時'],
  };
  const initial = tripCopyDraftFromFields(source);

  it('display.inclusions 等於 fields.inclusions.join("\\n").split(/\\r?\\n/)（未編輯：沿用來源值）', () => {
    const meta = tripCopyDraftMeta(source, initial, initial);
    expect(meta.fields.inclusions).toEqual(source.inclusions);
    expect(meta.display.inclusions).toEqual(meta.fields.inclusions.join('\n').split(/\r?\n/));
    // 來源某項內含 '\n'：顯示拆成多項（伺服器看到的形式）
    expect(meta.display.inclusions).toEqual(['含早餐', '含午餐', '含接送']);
  });

  it('編輯後 display.inclusions 仍等於換行傳輸形式', () => {
    const draft = { ...initial, inclusionsText: '甲\n\n乙  \n丙' };
    const meta = tripCopyDraftMeta(source, initial, draft);
    expect(meta.fields.inclusions).toEqual(['甲', '乙', '丙']);
    expect(meta.display.inclusions).toEqual(meta.fields.inclusions.join('\n').split(/\r?\n/));
  });

  it('exclusions／notices／文字欄位的顯示即 fields 值', () => {
    const draft = { ...initial, exclusionsText: ' A \nB', noticesText: '', description: '新介紹' };
    const meta = tripCopyDraftMeta(source, initial, draft);
    expect(meta.display.exclusions).toEqual(meta.fields.exclusions);
    expect(meta.display.notices).toEqual(meta.fields.notices);
    expect(meta.display.exclusions).toEqual(['A', 'B']);
    expect(meta.display.description).toBe('新介紹');
    expect(meta.display.safetyNotice).toBe('提醒');
  });
});
