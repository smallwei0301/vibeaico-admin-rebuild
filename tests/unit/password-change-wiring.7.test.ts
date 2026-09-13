import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const page = read('src/app/tenant/settings/page.tsx');
const route = read('src/app/api/auth/change-password/route.ts');

describe('password change wiring #7', () => {
  it('imports changePassword from the shared services barrel', () => {
    expect(page).toContain("import { changePassword } from '@/services';");
  });

  it('no longer fakes the request with a timeout', () => {
    expect(page).not.toContain('setTimeout(r, 480)');
  });

  it('calls the real service with the typed fields, in the right order', () => {
    const fn = page.slice(
      page.indexOf('const submitPasswordChange'),
      page.indexOf('const requestPasswordChange'),
    );
    expect(fn).toContain('await changePassword({ currentPassword, newPassword })');

    const awaitIdx = fn.indexOf('await changePassword({ currentPassword, newPassword })');
    const closeModalIdx = fn.indexOf('setConfirmPasswordChange(false)');
    const clearCurrentIdx = fn.indexOf("setCurrentPassword('')");
    const clearNewIdx = fn.indexOf("setNewPassword('')");
    const successToastIdx = fn.indexOf('toast.show(t.security.changed)');

    expect(awaitIdx).toBeGreaterThan(-1);
    expect(closeModalIdx).toBeGreaterThan(awaitIdx);
    expect(clearCurrentIdx).toBeGreaterThan(awaitIdx);
    expect(clearNewIdx).toBeGreaterThan(awaitIdx);
    expect(successToastIdx).toBeGreaterThan(awaitIdx);

    // Failure path (the catch block) must not close the modal before success —
    // i.e. the only setConfirmPasswordChange(false) call in this function sits
    // after the await, inside the try block, not in the catch block.
    const catchIdx = fn.indexOf('} catch (e) {');
    const catchBlock = fn.slice(catchIdx);
    expect(catchBlock).not.toContain('setConfirmPasswordChange(false)');
    expect(catchBlock).toContain('toast.show(');
    expect(catchBlock).toContain('t.security.failedPrefix');
  });

  it('surfaces the backend wrong-current-password message verbatim (no invented copy)', () => {
    expect(route).toContain("fail(400, '目前密碼不正確', ERR.BAD_CREDENTIALS)");
  });
});
