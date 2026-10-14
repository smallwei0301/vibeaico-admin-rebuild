'use client';
import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Mail } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { FormGroup, Input, Label } from '@/components/ui/Form';
import { AuthCardHeading } from '@/components/layout/AuthShell';
import { useToast } from '@/components/ui/Toast';
import { forgotPasswordPage as t } from '@/i18n/zh-TW/pages/forgot-password';
import { ApiError } from '@/lib/api';
import { isRateLimitError, RESEND_COOLDOWN_SECONDS } from '@/lib/auth-cooldown';
import { forgotPassword } from '@/services';

export default function ForgotPasswordPage() {
  const toast = useToast();

  const [email, setEmail] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [countdown, setCountdown] = React.useState(0);

  /** 倒數：計時器只在 effect 內跑，render 期不取時間 */
  React.useEffect(() => {
    if (countdown <= 0) return;
    const id = setTimeout(() => setCountdown((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (countdown > 0) return;
    if (!email.trim()) {
      toast.show(t.messages.emailRequired, 'warning');
      return;
    }
    setSubmitting(true);
    try {
      await forgotPassword(email.trim());
      setSent(true);
      setCountdown(RESEND_COOLDOWN_SECONDS);
      toast.show(t.messages.sent);
    } catch (err) {
      if (isRateLimitError(err)) setCountdown(RESEND_COOLDOWN_SECONDS);
      toast.show(
        `${t.messages.sendFailedPrefix}${err instanceof ApiError ? err.message : t.messages.unknownError}`,
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

        {sent ? (
          <Alert tone="success" className="mb-4">
            {t.messages.sent}
            {t.messages.checkSpam}
          </Alert>
        ) : null}

        <form onSubmit={submit} noValidate>
          <FormGroup>
            <Label htmlFor="email" required>{t.form.email}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder={t.form.emailPlaceholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormGroup>

          <Button
            type="submit"
            size="lg"
            block
            loading={submitting}
            loadingText={t.form.submitting}
            disabled={countdown > 0}
          >
            <Mail size={16} />
            {countdown > 0 ? `${countdown}${t.form.resendSuffix}` : t.form.submit}
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
