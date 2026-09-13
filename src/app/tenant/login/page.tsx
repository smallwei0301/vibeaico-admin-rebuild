'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, LogIn, MessageCircle } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { FormGroup, Input, Label } from '@/components/ui/Form';
import { AuthCardHeading } from '@/components/layout/AuthShell';
import { useToast } from '@/components/ui/Toast';
import { common } from '@/i18n/zh-TW/common';
import { loginPage as t } from '@/i18n/zh-TW/pages/login';
import { ApiError } from '@/lib/api';
import { getOAuthStatus, login } from '@/services';
import type { OAuthStatus } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* 第三方登入（#26 slice 1）                                                    */
/* -------------------------------------------------------------------------- */
/* 誠實復原（docs/DELIVERY-CHAIN.md §5）：authorize/callback 端點還不存在，這兩顆
 * 按鈕在任何狀態下都不得是 <a href> 也不得可點擊 —— 只用來如實顯示平台是否已經
 * 設定 OAuth 憑證，不假裝可以真的登入。 */

/**
 * 根據載入中／是否已設定憑證，回傳要顯示的說明文字。抽成純函式方便單元測試
 * 直接餵兩種 configured 值驗證，不需要真的 render 元件或啟動瀏覽器環境。
 */
function oauthNoteFor(loading: boolean, configured: boolean): string {
  if (loading) return t.oauth.checking;
  return configured ? t.oauth.buildingFlow : t.oauth.notConfigured;
}

export default function LoginPage() {
  const toast = useToast();
  const router = useRouter();

  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  /** #oauthErrorBox：第三方導回失敗時才顯示 */
  const [oauthError, setOauthError] = React.useState('');
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      toast.show(t.messages.usernameRequired, 'warning');
      return;
    }
    if (!password) {
      toast.show(t.messages.passwordRequired, 'warning');
      return;
    }
    setSubmitting(true);
    setOauthError('');
    try {
      await login(username.trim(), password);
      toast.show(common.message.saveSuccess);
      // ?next= 在 submit 當下從 location 讀（同 reset-password 頁的手法），
      // 不用 useSearchParams()——那個 hook 在 Next 15 要求整頁包 Suspense
      // 邊界，否則空 env 靜態預渲染直接失敗（鐵則 10 回歸實測抓到）。
      const next = new URLSearchParams(window.location.search).get('next');
      router.push(next ?? '/tenant/dashboard');
    } catch (err) {
      toast.show(
        err instanceof ApiError ? err.message : t.messages.loginFailed,
        'danger',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardBody>
        <AuthCardHeading title={t.heading} description={t.subheading} />

        {oauthError ? (
          <Alert tone="danger" className="mb-4 text-xs">
            {t.oauth.failedPrefix}
            {oauthError}
          </Alert>
        ) : null}

        <form onSubmit={submit} noValidate>
          <FormGroup>
            <Label htmlFor="username" required>{t.form.username}</Label>
            <Input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              placeholder={t.form.usernamePlaceholder}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </FormGroup>

          <FormGroup>
            <div className="flex items-center justify-between">
              <Label htmlFor="password" required>{t.form.password}</Label>
              <Link href="/tenant/forgot-password" className="text-xs">
                {t.form.forgotPassword}
              </Link>
            </div>
            <div className="input-group">
              <Input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder={t.form.passwordPlaceholder}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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

          <Button
            type="submit"
            size="lg"
            block
            loading={submitting}
            loadingText={t.form.submitting}
          >
            <LogIn size={16} />
            {t.form.submit}
          </Button>
        </form>

        {/* -------------------------------------------------- 第三方登入 */}
        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-neutral-250" />
          <span className="text-xs text-secondary">{t.oauth.divider}</span>
          <span className="h-px flex-1 bg-neutral-250" />
        </div>

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

        <p className="mt-5 text-center text-base text-secondary">
          {t.register.prompt}
          <Link href="/tenant/register" className="font-semibold">
            {t.register.link}
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}
