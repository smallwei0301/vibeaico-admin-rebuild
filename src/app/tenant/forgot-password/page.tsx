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
import { forgotPassword } from '@/services';
import { createForgotPasswordFlow } from '@/lib/forgot-password-flow';

export default function ForgotPasswordPage() {
  const toast = useToast();

  const [email, setEmail] = React.useState('');
  const [{ submitting, sent }, setFeedback] = React.useState({ submitting: false, sent: false });
  const flow = React.useRef(createForgotPasswordFlow({
    onState: setFeedback,
    onSuccess: () => toast.show(t.messages.sent),
    onError: (err) => toast.show(
      `${t.messages.sendFailedPrefix}${err instanceof ApiError ? err.message : t.messages.unknownError}`,
      'danger',
    ),
  }));
  React.useEffect(() => () => flow.current.invalidate(), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.show(t.messages.emailRequired, 'warning');
      return;
    }
    await flow.current.submit(email.trim(), forgotPassword);
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
              onChange={(e) => {
                flow.current.reset();
                setEmail(e.target.value);
              }}
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
