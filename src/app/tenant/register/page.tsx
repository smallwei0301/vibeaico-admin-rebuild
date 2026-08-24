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
import { common } from '@/i18n/zh-TW/common';
import { registerPage as t } from '@/i18n/zh-TW/pages/register';
import { ApiError } from '@/lib/api';
import { login, registerTenant, sendVerificationCode } from '@/services';

/* -------------------------------------------------------------------------- */
/* 本頁常數                                                                    */
/* -------------------------------------------------------------------------- */

const OAUTH = { line: t.oauth.lineHref, google: t.oauth.googleHref } as const;

/** 原站規則：店家代碼僅限小寫英文、數字、連字號（同 tenant-settings 的 shopCode） */
const SHOP_CODE_PATTERN = /^[a-z0-9-]+$/;
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
      const email = form.email.trim();
      await registerTenant({
        email,
        code: form.verificationCode.trim(),
        password: form.password,
        tenantName: form.name.trim(),
        shopCode: form.code.trim(),
        businessType,
      });
      toast.show(t.messages.registerSuccess);
      // 註冊完直接建立 session 進後台——剛剛才輸入過的帳密不該再要求輸入一次。
      // 自動登入失敗（例如 cookie 被擋）不是註冊失敗，退回登入頁讓使用者手動登入即可。
      try {
        await login(email, form.password);
        router.push('/tenant/dashboard');
      } catch {
        router.push('/tenant/login');
      }
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
          <a className="btn btn-line btn-lg btn-block" href={OAUTH.line}>
            <MessageCircle size={16} />
            {t.oauth.line}
          </a>
          <a className="btn btn-outline btn-lg btn-block" href={OAUTH.google}>
            {t.oauth.google}
          </a>
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
