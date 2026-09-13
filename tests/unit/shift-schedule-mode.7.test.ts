import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listStaff, updateStaff } from '@/services/catalog';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const page = read('src/app/tenant/shifts/page.tsx');
const migration = read('supabase/migrations/0078_staff_schedule_mode.sql');

/** modal 5（切換排班模式）的原始碼片段，供逐項斷言用。 */
const modeModal = page.slice(
  page.indexOf('{/* ------------------------------------------------ modal 5'),
  page.indexOf('\n    </>', page.indexOf('{/* ------------------------------------------------ modal 5')),
);

describe('shifts #7: 排班模式切換真的存進 staff.schedule_mode，不再是純本地 state', () => {
  it('反向斷言：原本「連 await 都沒有、直接 setModes」的假成功已被移除', () => {
    expect(page).not.toContain('MOCK_STAFF_MODES');
    expect(page).not.toContain('setModes');
    expect(page).not.toContain("React.useState<Record<string, ScheduleMode>>");
  });

  it('onConfirm 是 async，先 await updateStaff() 帶 scheduleMode，成功才更新畫面與顯示提示', () => {
    expect(modeModal).toContain('onConfirm={async () => {');
    expect(modeModal).toContain('await updateStaff(targetStaff.id, { scheduleMode: next })');

    const tryBlock = modeModal.slice(modeModal.indexOf('try {'), modeModal.indexOf('} catch'));
    // 呼叫 API 必須在「更新本地 staff 列表」「顯示成功 toast」「關閉 modal」之前
    const callIdx = tryBlock.indexOf('await updateStaff(');
    expect(callIdx).toBeGreaterThanOrEqual(0);
    expect(callIdx).toBeLessThan(tryBlock.indexOf('setStaff('));
    expect(callIdx).toBeLessThan(tryBlock.indexOf('toast.show(t.modeSwitched'));
    expect(callIdx).toBeLessThan(tryBlock.indexOf('setModeTarget(null)'));
  });

  it('失敗時顯示後端真實訊息（e.message），不是自己編的成功文案，且不清空 modeTarget（可重試）', () => {
    expect(modeModal).toContain('} catch (e) {');
    const catchBlock = modeModal.slice(modeModal.indexOf('} catch (e) {'), modeModal.indexOf('} finally'));
    expect(catchBlock).toContain("toast.show(e instanceof Error ? e.message : t.messages.toggleFailed, 'danger')");
    expect(catchBlock).not.toContain('setModeTarget(null)');
    expect(catchBlock).not.toContain('toast.show(t.modeSwitched');
  });

  it('modes 來自 listStaff() 回傳的 scheduleMode，不再是頁面本地初值', () => {
    expect(page).toContain("const mode = s.scheduleMode ?? 'ROTATING';");
    expect(page).not.toContain("s_1: 'ROTATING'");
    expect(page).not.toContain("s_3: 'FIXED_REST'");
  });

  it('mock 分支真的存得住：切換後下一次 listStaff() 看得到新值', async () => {
    const before = await listStaff();
    expect(before.length).toBeGreaterThan(0);
    const staff = before[0];
    const current = staff.scheduleMode ?? 'ROTATING';
    const next = current === 'FIXED_REST' ? 'ROTATING' : 'FIXED_REST';

    await updateStaff(staff.id, { scheduleMode: next });

    const after = await listStaff();
    expect(after.find((s) => s.id === staff.id)?.scheduleMode).toBe(next);

    // 復原，避免污染同一 process 內其他測試共用的 mock store
    await updateStaff(staff.id, { scheduleMode: current });
    const restored = await listStaff();
    expect(restored.find((s) => s.id === staff.id)?.scheduleMode).toBe(current);
  });
});

describe('shifts #7: migration 0078（staff.schedule_mode）冪等，且不重建任何 view', () => {
  it('欄位與約束都以 idempotent 寫法新增', () => {
    expect(migration).toContain('add column if not exists schedule_mode text not null default');
    expect(migration).toContain('exception when duplicate_object then null;');
    expect(migration).toContain("check (schedule_mode = any (array['FIXED_REST'::text, 'ROTATING'::text]))");
  });

  it('不重建 bookings_view 或任何其他 view（查證：bookings_view 用明確欄位 st.name AS staff_name，不是 st.*）', () => {
    const lower = migration.toLowerCase();
    expect(lower).not.toContain('create or replace view');
    expect(lower).not.toContain('create view');
    expect(lower).not.toContain('drop view');
    // bookings_view 只允許出現在說明查證結果的註解裡，不可以有任何實際 DDL 動它
    const ddlLines = migration
      .split('\n')
      .filter((line) => !line.trim().startsWith('--') && line.trim().length > 0);
    expect(ddlLines.join('\n')).not.toContain('bookings_view');
  });
});
