import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const page = read('src/app/tenant/shifts/page.tsx');
const copy = read('src/i18n/zh-TW/pages/shifts.ts');

describe('shift template #28⑦: truthful persistence feedback', () => {
  it('waits for each existing API mutation before showing a success toast', () => {
    const submit = page.slice(page.indexOf('const submit'), page.indexOf('return (', page.indexOf('const submit')));
    const remove = page.slice(page.indexOf('const confirmDelete'), page.indexOf('return (', page.indexOf('const confirmDelete')));

    expect(submit).toContain('const submit = async');
    expect(submit.indexOf('await updateShiftTemplate(')).toBeLessThan(
      submit.indexOf('toast.show(t.templateModal.updated)'),
    );
    expect(submit.indexOf('await createShiftTemplate(')).toBeLessThan(
      submit.indexOf('toast.show(t.templateModal.created)'),
    );
    expect(remove.indexOf('await deleteShiftTemplate(')).toBeLessThan(
      remove.indexOf('toast.show(t.templateModal.deleted)'),
    );
    expect(page).toContain('loading={saving}');
    expect(page).toContain('loading={!!deleteTarget && deletingId === deleteTarget.id}');
    expect(submit).toContain("toast.show(e instanceof Error ? e.message : t.messages.saveFailed, 'danger')");
    expect(remove).toContain("toast.show(e instanceof Error ? e.message : t.messages.deleteFailed, 'danger')");
  });

  it('explains that scheduled shifts keep their own persisted times', () => {
    expect(copy).toContain("updated: '班別範本已更新（不影響已排定的班表）'");
    expect(copy).toContain("deleted: '班別範本已刪除（已排定的班表不受影響）'");
    expect(copy).toContain("deleteConfirm: '確定刪除此班別範本？\\n已排定的班表會保留原本時間，不受影響'");
    expect(copy).not.toContain('班表時間已同步');
    expect(copy).not.toContain('相關班表已清除');
  });
});
