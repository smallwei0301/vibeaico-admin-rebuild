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
import { login } from '@/services';

/* -------------------------------------------------------------------------- */
/* 本頁常數（不寫進 src/mock：登入沒有領域資料，只有平台 OAuth 端點）            */
/* -------------------------------------------------------------------------- */

/** 平台級 OAuth 端點；channel 憑證在 src/config/env.ts，與店家自己的 LINE 帳號無關 */
const OAUTH = {
  line: t.oauth.lineHref,
  google: t.oauth.googleHref,
} as const;

export default function LoginPage() {
  const toast = useToast();
  const router = useRouter();

  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  /** #oauthErrorBox：第三方導回失敗時才顯示 */
  const [oauthError, setOauthError] = React.useState('');

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
          <a className="btn btn-line btn-lg btn-block" href={OAUTH.line}>
            <MessageCircle size={16} />
            {t.oauth.line}
          </a>
          <a className="btn btn-outline btn-lg btn-block" href={OAUTH.google}>
            {t.oauth.google}
          </a>
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
