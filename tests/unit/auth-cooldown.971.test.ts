import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { isRateLimitError, RESEND_COOLDOWN_SECONDS } from '@/lib/auth-cooldown';
import { forgotPasswordPage } from '@/i18n/zh-TW/pages/forgot-password';

const registerSrc = readFileSync('src/app/tenant/register/page.tsx', 'utf8');
const forgotSrc = readFileSync('src/app/tenant/forgot-password/page.tsx', 'utf8');

describe('#971 限流判斷', () => {
  it('429（send-code 60 秒節流，code=CONFLICT）與 REQ_004 屬限流', () => {
    expect(isRateLimitError(new ApiError('請稍候再重新發送驗證碼', 'CONFLICT', 429))).toBe(true);
    expect(isRateLimitError(new ApiError('x', 'REQ_004', 429))).toBe(true);
    expect(isRateLimitError(new ApiError('x', 'REQ_004'))).toBe(true);
  });
  it('其他失敗不屬限流', () => {
    expect(isRateLimitError(new ApiError('x', 'MAIL_UNAVAILABLE', 503))).toBe(false);
    expect(isRateLimitError(new ApiError('x', 'NETWORK_ERROR'))).toBe(false);
    expect(isRateLimitError(new ApiError('x', 'REQ_001', 400))).toBe(false);
    expect(isRateLimitError(new Error('x'))).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
  });
  it('冷卻秒數為 60', () => {
    expect(RESEND_COOLDOWN_SECONDS).toBe(60);
  });
});

describe('#971 註冊頁 sendCode', () => {
  const catchBlock = registerSrc.slice(registerSrc.indexOf('await sendVerificationCode'));
  it('成功與限流失敗皆啟動倒數，其他失敗不啟動', () => {
    expect(catchBlock).toContain('isRateLimitError(e)');
    expect(catchBlock).toMatch(/if \(isRateLimitError\(e\)\) setCountdown\(RESEND_SECONDS\)/);
    expect(catchBlock.match(/setCountdown\(RESEND_SECONDS\)/g)?.length).toBe(2);
  });
});

describe('#971 忘記密碼頁', () => {
  it('成功與限流失敗後進入冷卻，冷卻中 disabled 並顯示剩餘秒數', () => {
    expect(forgotSrc).toContain('setCountdown(RESEND_COOLDOWN_SECONDS)');
    expect(forgotSrc).toContain('isRateLimitError(err)');
    expect(forgotSrc).toContain('disabled={countdown > 0}');
    expect(forgotSrc).toContain('t.form.resendSuffix');
    expect(forgotSrc).toContain('if (countdown > 0) return;');
  });
  it('成功提示補上檢查垃圾信件匣', () => {
    expect(forgotSrc).toContain('t.messages.checkSpam');
    expect(forgotPasswordPage.messages.checkSpam).toContain('垃圾信件匣');
    expect(forgotPasswordPage.form.resendSuffix).toMatch(/秒/);
  });
});

describe('#971 頁面無中文字面量', () => {
  it.each([
    ['register', registerSrc],
    ['forgot-password', forgotSrc],
  ])('%s 頁面程式碼不含中文字串', (_n, src) => {
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n');
    expect(code).not.toMatch(/[一-鿿]/);
  });
});
