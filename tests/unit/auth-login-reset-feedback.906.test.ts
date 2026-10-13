import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isResetLinkUsable, isValidEmail, isValidResetCode } from '@/lib/auth-input';
import { loginPage } from '@/i18n/zh-TW/pages/login';
import { resetPasswordPage } from '@/i18n/zh-TW/pages/reset-password';

const loginSrc = readFileSync('src/app/tenant/login/page.tsx', 'utf8');
const resetSrc = readFileSync('src/app/tenant/reset-password/page.tsx', 'utf8');

describe('#906 email / token 檢查', () => {
  it('email 格式', () => {
    expect(isValidEmail('abc')).toBe(false);
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('a@b.c')).toBe(false);
    expect(isValidEmail('a@b..co')).toBe(false);
    expect(isValidEmail('Owner+tag@Sub.Example.COM')).toBe(true);
    expect(isValidEmail('owner-a@test.local')).toBe(true);
    expect(isValidEmail('  owner@example.com  ')).toBe(true);
  });
  it('token 必須 6 位數字', () => {
    for (const bad of ['12345', '1234567', 'abcdef', '12 456', '', null, undefined]) {
      expect(isValidResetCode(bad)).toBe(false);
    }
    expect(isValidResetCode('123456')).toBe(true);
  });
  it('重設連結需 email 與 token 皆合格', () => {
    expect(isResetLinkUsable('a@b.co', '123456')).toBe(true);
    expect(isResetLinkUsable(null, '123456')).toBe(false);
    expect(isResetLinkUsable('a@b.co', null)).toBe(false);
    expect(isResetLinkUsable('a@b.co', '12')).toBe(false);
  });
});

describe('#906 頁面行為', () => {
  it('登入成功不再用 saveSuccess，且送出前檢查 email', () => {
    expect(loginSrc).not.toContain('saveSuccess');
    expect(loginSrc).toContain('t.messages.loginSuccess');
    expect(loginSrc).toContain('isValidEmail');
  });
  it('重設密碼過短使用專屬文案，且不再拿 placeholder 當錯誤', () => {
    expect(resetSrc).toContain('t.messages.passwordTooShort');
    expect(resetSrc).not.toContain('setError(t.form.newPasswordPlaceholder)');
    expect(resetSrc).toContain('isResetLinkUsable');
  });
  it('新文案為中文，不含英文 zod 原文', () => {
    const copies = [
      loginPage.form.username,
      loginPage.messages.emailInvalid,
      loginPage.messages.loginSuccess,
      resetPasswordPage.messages.incompleteLink,
      resetPasswordPage.messages.passwordTooShort,
    ];
    for (const c of copies) {
      expect(c).toMatch(/[一-鿿]/);
      expect(c).not.toMatch(/Invalid|Too small|String must|expected/i);
    }
    expect(resetPasswordPage.messages.passwordTooShort).toContain('8');
  });

  it('缺 token（只有 email）也走連結不完整呈現，且登入識別欄位維持 username 自動填入', () => {
    expect(resetSrc).toContain('tokenChecked && !isResetLinkUsable(email, token)');
    expect(resetSrc).not.toContain('!!token &&');
    expect(resetSrc).toContain('t.requestNewLink');
    expect(loginSrc).toContain('autoComplete="username"');
    expect(loginSrc).toContain('id="username"');
  });
});
