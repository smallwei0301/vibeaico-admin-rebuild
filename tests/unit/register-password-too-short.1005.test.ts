import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { registerPage as t } from '@/i18n/zh-TW/pages/register';
import { PASSWORD_MIN_LENGTH } from '@/lib/auth-input';

const src = readFileSync('src/app/tenant/register/page.tsx', 'utf8');

describe('#1005 註冊頁密碼太短', () => {
  it('有獨立的 passwordTooShort 文案，且與最小長度一致、不同於 placeholder 與必填提示', () => {
    expect(t.messages.passwordTooShort).toContain(String(PASSWORD_MIN_LENGTH));
    expect(t.messages.passwordTooShort).not.toBe(t.form.passwordPlaceholder);
    expect(t.messages.passwordTooShort).not.toBe(t.messages.requiredFields);
  });

  it('password 錯誤使用 passwordTooShort，不再借用 placeholder', () => {
    expect(src).toContain('next.password = t.messages.passwordTooShort;');
    expect(src).not.toContain('next.password = t.form.passwordPlaceholder');
  });

  it('toast 鏈包含 next.password，順序在 phone 之後、confirmPassword 之前', () => {
    const m = src.match(/toast\.show\(next\.code[\s\S]*?'warning'\)/);
    expect(m).not.toBeNull();
    const chain = m![0];
    const i = (k: string) => chain.indexOf(`next.${k}`);
    expect(i('phone')).toBeGreaterThan(-1);
    expect(i('password')).toBeGreaterThan(i('phone'));
    expect(i('confirmPassword')).toBeGreaterThan(i('password'));
  });
});
