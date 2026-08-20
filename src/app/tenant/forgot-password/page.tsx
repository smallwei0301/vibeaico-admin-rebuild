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

/** 骨架模式：不打 /api/auth/forgot-password，只做前端驗證 + 成功提示 */
const MOCK_DELAY_MS = 500;

export default function ForgotPasswordPage() {
  const toast = useToast();

  const [email, setEmail] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.show(t.messages.emailRequired, 'warning');
      return;
    }
    setSubmitting(true);
    try {
      await new Promise((r) => setTimeout(r, MOCK_DELAY_MS));
      setSent(true);
      toast.show(t.messages.sent);
    } catch (err) {
      toast.show(
        `${t.messages.sendFailedPrefix}${err instanceof Error ? err.message : t.messages.unknownError}`,
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
          <Alert tone="success" className="mb-4">{t.messages.sent}</Alert>
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
          >
            <Mail size={16} />
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
