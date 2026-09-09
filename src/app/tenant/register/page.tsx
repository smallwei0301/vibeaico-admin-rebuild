'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, MessageCircle, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { FormError, FormGroup, FormText, Input, Label } from '@/components/ui/Form';
import { AuthCardHeading } from '@/components/layout/AuthShell';
import { MODE_PRESETS, type BusinessType } from '@/config/modes';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/Toast';
import { SHOP_CODE_PATTERN } from '@/lib/shop-code';
import { common } from '@/i18n/zh-TW/common';
import { registerPage as t } from '@/i18n/zh-TW/pages/register';
import { ApiError } from '@/lib/api';
import { getOAuthStatus, registerTenant, sendVerificationCode } from '@/services';
import type { OAuthStatus } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* 第三方快速註冊（#26 slice 1，與 /tenant/login 同一套處理）                     */
/* -------------------------------------------------------------------------- */
/* 誠實復原（docs/DELIVERY-CHAIN.md §5）：authorize/callback 端點還不存在，這兩顆
 * 按鈕在任何狀態下都不得是 <a href> 也不得可點擊 —— 只用來如實顯示平台是否已經
 * 設定 OAuth 憑證，不假裝可以真的註冊。 */

/**
 * 根據載入中／是否已設定憑證，回傳要顯示的說明文字。與
 * src/app/tenant/login/page.tsx 的同名函式邏輯逐字相同——那邊的單元測試
 * （tests/unit/oauth-honest.26.test.ts）已經鎖住這個判斷分支。
 */
function oauthNoteFor(loading: boolean, configured: boolean): string {
  if (loading) return t.oauth.checking;
  return configured ? t.oauth.buildingFlow : t.oauth.notConfigured;
}

/**
 * 店家代碼的規則從 `@/lib/shop-code` 取，不在這裡另寫一份。
 *
 * ⚠️ 這裡曾經是第三份各自為政的 pattern（而且沒有長度上限）。前端擋不住的東西
 * 後端會擋，所以那不是安全問題——但使用者要多送一次表單才知道代碼太長，而且
 * 三份規則會各自漂移。現在四個地方（前端、註冊 API、設定 API、公開頁）同一個來源。
 */
/** 驗證碼 6 位數、電話 10 位數（原站 inline JS 逐字驗證） */
const VERIFICATION_CODE_LENGTH = 6;
const PHONE_LENGTH = 10;
const PASSWORD_MIN_LENGTH = 8;
/** 重新發送倒數秒數 */
const RESEND_SECONDS = 60;

type Field =
  | 'code' | 'name' | 'email' | 'verificationCode'
  | 'phone' | 'password' | 'confirmPassword';

const EMPTY_FORM: Record<Field | 'referralCode', string> = {
  code: '', name: '', email: '', verificationCode: '',
  phone: '', password: '', confirmPassword: '', referralCode: '',
};

export default function RegisterPage() {
  const toast = useToast();
  const router = useRouter();

  const [form, setForm] = React.useState(EMPTY_FORM);
  /** 業態模式：決定開店後的後台配置（見 src/config/modes.ts） */
  const [businessType, setBusinessType] = React.useState<BusinessType>('LOCAL_SHOP');
  const [errors, setErrors] = React.useState<Partial<Record<Field, string>>>({});
  const [showPassword, setShowPassword] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [countdown, setCountdown] = React.useState(0);
  const [codeSent, setCodeSent] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  /** null = 載入中；載入完成後為 GET /api/auth/oauth/status 的真實回應 */
  const [oauthStatus, setOauthStatus] = React.useState<OAuthStatus | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    getOAuthStatus()
      .then((status) => {
        if (!cancelled) setOauthStatus(status);
      })
      .catch(() => {
        // 查詢失敗時維持「尚未設定」的保守顯示，不得默默當作已設定
        if (!cancelled) setOauthStatus({ google: { configured: false }, line: { configured: false } });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const oauthLoading = oauthStatus === null;
  const lineNote = oauthNoteFor(oauthLoading, oauthStatus?.line.configured ?? false);
  const googleNote = oauthNoteFor(oauthLoading, oauthStatus?.google.configured ?? false);

  const set = (key: Field | 'referralCode') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((s) => ({ ...s, [key]: undefined }));
  };

  /** 倒數：計時器只在 effect 內跑，render 期不取時間 */
  React.useEffect(() => {
    if (countdown <= 0) return;
    const id = setTimeout(() => setCountdown((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown]);

  const sendCode = async () => {
    if (!form.email.trim()) {
      toast.show(t.messages.emailFirst, 'warning');
      setErrors((s) => ({ ...s, email: t.messages.emailFirst }));
      return;
    }
    setSending(true);
    try {
      await sendVerificationCode(form.email.trim(), 'REGISTER');
      setCodeSent(true);
      setCountdown(RESEND_SECONDS);
      toast.show(`${t.messages.codeSentToPrefix}${form.email.trim()}`);
    } catch (e) {
      toast.show(
        `${t.messages.sendCodeFailedPrefix}${e instanceof ApiError ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setSending(false);
    }
  };

  const validate = () => {
    const next: Partial<Record<Field, string>> = {};
    const required: Field[] = [
      'code', 'name', 'email', 'verificationCode', 'phone', 'password', 'confirmPassword',
    ];
    if (required.some((k) => !form[k].trim())) {
      required.forEach((k) => {
        if (!form[k].trim()) next[k] = common.validation.required;
      });
      setErrors(next);
      toast.show(t.messages.requiredFields, 'warning');
      return false;
    }
    if (!SHOP_CODE_PATTERN.test(form.code.trim())) next.code = t.messages.codeFormat;
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) next.email = common.validation.email;
    if (form.verificationCode.trim().length !== VERIFICATION_CODE_LENGTH) {
      next.verificationCode = t.messages.code6;
    }
    if (form.phone.replace(/\D/g, '').length !== PHONE_LENGTH) next.phone = t.messages.phone10;
    if (form.password.length < PASSWORD_MIN_LENGTH) {
      next.password = t.form.passwordPlaceholder;
    }
    if (form.password !== form.confirmPassword) {
      next.confirmPassword = t.messages.passwordMismatch;
    }
    setErrors(next);
    if (Object.keys(next).length > 0) {
      toast.show(next.code ?? next.email ?? next.verificationCode
        ?? next.phone ?? next.confirmPassword ?? t.messages.requiredFields, 'warning');
      return false;
    }
    return true;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      await registerTenant({
        email: form.email.trim(),
        code: form.verificationCode.trim(),
        password: form.password,
        tenantName: form.name.trim(),
        shopCode: form.code.trim(),
      });
      toast.show(t.messages.registerSuccess);
      router.push('/tenant/login');
    } catch (err) {
      toast.show(
        `${t.messages.registerFailedPrefix}${err instanceof ApiError ? err.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const sendCodeLabel = sending
    ? t.form.sendingCode
    : countdown > 0
      ? `${countdown}${t.form.countdownSuffix}`
      : codeSent
        ? t.form.resendCode
        : t.form.sendCode;

  return (
    <Card>
      <CardBody>
        <AuthCardHeading title={t.title} description={t.shareDescription} />

        {/* -------------------------------------------------- 第三方快速註冊 */}
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="line"
            size="lg"
            block
            disabled
            data-testid="oauth-line-disabled"
            title={lineNote}
          >
            <MessageCircle size={16} />
            {t.oauth.line}
          </Button>
          <p className="text-center text-xs text-secondary">{lineNote}</p>
          <Button
            type="button"
            variant="outline"
            size="lg"
            block
            disabled
            data-testid="oauth-google-disabled"
            title={googleNote}
          >
            {t.oauth.google}
          </Button>
          <p className="text-center text-xs text-secondary">{googleNote}</p>
        </div>

        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-neutral-250" />
          <span className="text-xs text-secondary">{t.oauth.divider}</span>
          <span className="h-px flex-1 bg-neutral-250" />
        </div>

        <form onSubmit={submit} noValidate>
          {/* ------------------------------------------ 業態模式三選一 */}
          <FormGroup>
            <Label required>{t.businessType.label}</Label>
            <div className="grid gap-2 sm:grid-cols-3">
              {t.businessType.options.map((opt) => {
                const Icon = MODE_PRESETS[opt.key as BusinessType].icon;
                const selected = businessType === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setBusinessType(opt.key as BusinessType)}
                    className={cn(
                      'flex flex-col items-start gap-1 rounded-lg border-2 p-3 text-left transition-colors',
                      selected
                        ? 'border-primary bg-[var(--badge-primary-bg)]'
                        : 'border-neutral-250 hover:border-neutral-400',
                    )}
                  >
                    <Icon size={20} className={selected ? 'text-primary' : 'text-secondary'} />
                    <span className="text-sm font-bold text-dark">{opt.name}</span>
                    <span className="text-2xs text-secondary">{opt.summary}</span>
                    <span className="text-2xs text-muted">{opt.detail}</span>
                  </button>
                );
              })}
            </div>
            <FormText>{t.businessType.help}</FormText>
          </FormGroup>

          <FormGroup>
            <Label htmlFor="code" required>{t.form.code}</Label>
            <Input
              id="code" name="code" type="text"
              placeholder={t.form.codePlaceholder}
              value={form.code} onChange={set('code')}
            />
            <FormText>{t.form.codeHelp}</FormText>
            {errors.code ? <FormError>{errors.code}</FormError> : null}
          </FormGroup>

          <FormGroup>
            <Label htmlFor="name" required>{t.form.name}</Label>
            <Input
              id="name" name="name" type="text"
              placeholder={t.form.namePlaceholder}
              value={form.name} onChange={set('name')}
            />
            {errors.name ? <FormError>{errors.name}</FormError> : null}
          </FormGroup>

          <FormGroup>
            <Label htmlFor="email" required>{t.form.email}</Label>
            <div className="input-group">
              <Input
                id="email" name="email" type="email" autoComplete="email"
                placeholder={t.form.emailPlaceholder}
                value={form.email} onChange={set('email')}
              />
              <Button
                type="button" variant="outline"
                disabled={sending || countdown > 0}
                onClick={() => void sendCode()}
              >
                {sendCodeLabel}
              </Button>
            </div>
            {errors.email ? <FormError>{errors.email}</FormError> : null}
          </FormGroup>

          <FormGroup>
            <Label htmlFor="verificationCode" required>{t.form.verificationCode}</Label>
            <Input
              id="verificationCode" name="verificationCode" type="text"
              inputMode="numeric" maxLength={VERIFICATION_CODE_LENGTH}
              placeholder={t.form.verificationCodePlaceholder}
              value={form.verificationCode} onChange={set('verificationCode')}
            />
            {codeSent && !errors.verificationCode ? (
              <FormText>{t.messages.codeSent}</FormText>
            ) : null}
            {errors.verificationCode ? <FormError>{errors.verificationCode}</FormError> : null}
          </FormGroup>

          <FormGroup>
            <Label htmlFor="phone" required>{t.form.phone}</Label>
            <Input
              id="phone" name="phone" type="tel" inputMode="tel"
              placeholder={t.form.phonePlaceholder}
              value={form.phone} onChange={set('phone')}
            />
            {errors.phone ? <FormError>{errors.phone}</FormError> : null}
          </FormGroup>

          <FormGroup>
            <Label htmlFor="password" required>{t.form.password}</Label>
            <div className="input-group">
              <Input
                id="password" name="password" autoComplete="new-password"
                type={showPassword ? 'text' : 'password'}
                placeholder={t.form.passwordPlaceholder}
                value={form.password} onChange={set('password')}
              />
              <Button
                type="button" variant="outline"
                aria-label={showPassword ? t.form.hidePassword : t.form.showPassword}
                title={showPassword ? t.form.hidePassword : t.form.showPassword}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </Button>
            </div>
            {errors.password ? <FormError>{errors.password}</FormError> : null}
          </FormGroup>

          <FormGroup>
            <Label htmlFor="confirmPassword" required>{t.form.confirmPassword}</Label>
            <Input
              id="confirmPassword" name="confirmPassword" type="password"
              autoComplete="new-password"
              placeholder={t.form.confirmPasswordPlaceholder}
              value={form.confirmPassword} onChange={set('confirmPassword')}
            />
            {errors.confirmPassword ? <FormError>{errors.confirmPassword}</FormError> : null}
          </FormGroup>

          <FormGroup>
            <Label htmlFor="referralCode">
              {t.form.referralCode}
              <span className="font-normal text-secondary">{t.form.referralCodeOptional}</span>
            </Label>
            <Input
              id="referralCode" name="referralCode" type="text"
              placeholder={t.form.referralCodePlaceholder}
              value={form.referralCode} onChange={set('referralCode')}
            />
          </FormGroup>

          {/* 原站以 hidden input 帶入業務推薦碼（?agent=…），骨架階段不需渲染 */}

          <Button
            type="submit" size="lg" block
            loading={submitting} loadingText={t.form.submitting}
          >
            <UserPlus size={16} />
            {t.form.submit}
          </Button>

          <p className="mt-3 text-center text-xs text-secondary">{common.requiredHint}</p>
        </form>

        <p className="mt-4 text-center text-base text-secondary">
          {t.login.prompt}
          <Link href="/tenant/login" className="font-semibold">{t.login.link}</Link>
        </p>
      </CardBody>
    </Card>
  );
}
