'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Eye, EyeOff, KeyRound } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { FormError, FormGroup, Input, Label } from '@/components/ui/Form';
import { AuthCardHeading } from '@/components/layout/AuthShell';
import { useToast } from '@/components/ui/Toast';
import { resetPasswordPage as t } from '@/i18n/zh-TW/pages/reset-password';
import { ApiError } from '@/lib/api';
import { resetPassword } from '@/services';

/** 原站以 ?token=… 帶入重設 token；缺 token 直接顯示「無效的重設連結」 */
const TOKEN_QUERY_KEY = 'token';
/** service 層 resetPassword() 需要 email + 6 位數驗證碼（03 分冊 §6.2）；
 *  重設連結一併帶 ?email=…，token 當驗證碼用 —— 版面/文案不變，只多讀一個查詢參數 */
const EMAIL_QUERY_KEY = 'email';
const PASSWORD_MIN_LENGTH = 8;

/** 重設成功後導回登入頁前的停留秒數，讓使用者看到成功提示 */
const REDIRECT_TO_LOGIN_DELAY_MS = 1500;

export default function ResetPasswordPage() {
  const toast = useToast();
  const router = useRouter();

  /**
   * token/email 在 effect 內從 location 讀取（而非 useSearchParams）：
   * 這頁只有客戶端會用到，避免整頁被推進 Suspense/動態渲染。
   */
  const [token, setToken] = React.useState<string | null>(null);
  const [email, setEmail] = React.useState<string | null>(null);
  const [tokenChecked, setTokenChecked] = React.useState(false);

  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState(false);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get(TOKEN_QUERY_KEY));
    setEmail(params.get(EMAIL_QUERY_KEY));
    setTokenChecked(true);
  }, []);

  const invalidLink = tokenChecked && !token;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!newPassword || !confirmPassword) {
      setError(t.messages.requiredFields);
      toast.show(t.messages.requiredFields, 'warning');
      return;
    }
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setError(t.form.newPasswordPlaceholder);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t.messages.passwordMismatch);
      toast.show(t.messages.passwordMismatch, 'warning');
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword({ email: email ?? '', code: token ?? '', newPassword });
      setDone(true);
      toast.show(t.messages.success);
      setTimeout(() => router.push('/tenant/login'), REDIRECT_TO_LOGIN_DELAY_MS);
    } catch (err) {
      toast.show(
        `${t.messages.failedPrefix}${err instanceof ApiError ? err.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardBody>
        <AuthCardHeading title={t.title} description={t.subheading} />

        {invalidLink ? (
          <Alert tone="danger" className="mb-4">{t.messages.invalidLink}</Alert>
        ) : null}
        {done ? (
          <Alert tone="success" className="mb-4">{t.messages.success}</Alert>
        ) : null}

        <form onSubmit={submit} noValidate>
          <FormGroup>
            <Label htmlFor="newPassword" required>{t.form.newPassword}</Label>
            <div className="input-group">
              <Input
                id="newPassword"
                name="newPassword"
                autoComplete="new-password"
                type={showPassword ? 'text' : 'password'}
                placeholder={t.form.newPasswordPlaceholder}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={invalidLink || done}
              />
              <Button
                type="button"
                variant="outline"
                aria-label={showPassword ? t.form.hidePassword : t.form.showPassword}
                title={showPassword ? t.form.hidePassword : t.form.showPassword}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </Button>
            </div>
          </FormGroup>

          <FormGroup>
            <Label htmlFor="confirmPassword" required>{t.form.confirmPassword}</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              placeholder={t.form.confirmPasswordPlaceholder}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={invalidLink || done}
            />
            {error ? <FormError>{error}</FormError> : null}
          </FormGroup>

          <Button
            type="submit"
            size="lg"
            block
            disabled={invalidLink || done}
            loading={submitting}
            loadingText={t.form.submitting}
          >
            <KeyRound size={16} />
            {t.form.submit}
          </Button>
        </form>

        <p className="mt-5 text-center">
          <Link href="/tenant/login" className="inline-flex items-center gap-1 text-base">
            <ArrowLeft size={14} />
            {t.backToLogin}
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}
