import { describe, expect, it } from 'vitest';
import { omitTripCover } from '@/lib/trip-cover';
import { omitUnchangedGallery } from '@/lib/trip-gallery';
import { omitUnchangedTripTextFields } from '@/lib/trip-field-limits';
import { readFileSync } from 'node:fs';

describe('#42 基本資料儲存不帶封面', () => {
  it('omitTripCover 移除 coverImageUrl、保留其他欄位', () => {
    const out = omitTripCover({ title: 'T', coverImageUrl: 'https://old/c.png', summary: 's' });
    expect('coverImageUrl' in out).toBe(false);
    expect(out).toEqual({ title: 'T', summary: 's' });
  });
  it('saveBasic 組出的 payload 不含 coverImageUrl（含舊值為空字串的情況）', () => {
    for (const cover of ['https://old/c.png', '']) {
      const form = { title: 'T', coverImageUrl: cover, galleryUrls: [], description: 'd', safetyNotice: '', inclusions: [], exclusions: [], notices: [] };
      const trip = { ...form, title: 'old' };
      const payload = omitUnchangedTripTextFields(omitUnchangedGallery(omitTripCover(form) as typeof form, trip as never), trip as never);
      expect('coverImageUrl' in payload).toBe(false);
      expect(JSON.stringify(payload)).not.toContain('coverImageUrl');
    }
  });
  it('頁面來源：儲存鈕與封面按鈕互斥、accept 收斂', () => {
    const src = readFileSync('src/app/tenant/trips/[id]/page.tsx', 'utf8');
    expect(src).toContain('omitTripCover(form)');
    expect(src).toContain('onClick={saveBasic} loading={busy} disabled={coverBusy}');
    expect(src).toContain('accept="image/jpeg,image/png,image/webp"');
  });
  it('頁面來源：封面「移除」先開確認，確認後才呼叫 removeTripCover', () => {
    const src = readFileSync('src/app/tenant/trips/[id]/page.tsx', 'utf8');
    expect(src).toContain('onClick={() => setConfirmRemoveCover(true)}');
    expect(src).not.toContain('onClick={() => void onRemoveCover()}\n                    >');
    expect(src).toContain('open={confirmRemoveCover}');
    expect(src).toContain('onConfirm={() => void onRemoveCover()}');
    expect(src).toContain('t.confirm.removeCoverTitle');
    expect(src.match(/removeTripCover\(tripId\)/g)).toHaveLength(1);
    expect(src).toMatch(/const onRemoveCover = async \(\) => \{\n    if \(coverBusy \|\| busy\) return;/);
  });
});
