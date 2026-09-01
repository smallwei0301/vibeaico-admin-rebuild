'use client';
import * as React from 'react';
import { Bug } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FormError, FormGroup, Label, Input, Textarea, Select, FormText } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { common } from '@/i18n/zh-TW/common';
import { submitBugReport } from '@/services/bug-report';

const MAX_SUBJECT_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 4500;
const MAX_CONTACT_EMAIL_LENGTH = 200;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 全站共用的「回報問題」— 原站在側邊欄底部與每頁都掛著同一個 modal */
export function BugReportButton() {
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const toast = useToast();
  const t = common.bugReport;

  const [category, setCategory] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [contactEmail, setContactEmail] = React.useState('');
  const [error, setError] = React.useState('');

  const reset = () => {
    setCategory('');
    setSubject('');
    setDescription('');
    setContactEmail('');
    setError('');
  };

  const close = () => {
    setOpen(false);
    reset();
  };

  const submit = async () => {
    const trimmedSubject = subject.trim();
    const trimmedDescription = description.trim();
    const trimmedContactEmail = contactEmail.trim();

    if (!trimmedSubject) {
      setError(t.subjectRequired);
      return;
    }
    if (!trimmedDescription) {
      setError(t.descriptionRequired);
      return;
    }
    if (trimmedContactEmail && !EMAIL_PATTERN.test(trimmedContactEmail)) {
      setError(t.contactEmailInvalid);
      return;
    }

    setError('');
    setSubmitting(true);
    try {
      await submitBugReport({
        category: category || undefined,
        subject: trimmedSubject,
        content: trimmedDescription,
        contactEmail: trimmedContactEmail || undefined,
        pageUrl: typeof window === 'undefined' ? undefined : window.location.href,
      });
      close();
      toast.show(t.submitted);
    } catch (e) {
      const detail = e instanceof Error ? e.message.trim() : '';
      const message = detail ? t.submitFailed + detail : t.submitFailed;
      setError(message);
      toast.show(message, 'danger');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 left-5 z-40 hidden h-10 w-10 items-center justify-center rounded-full bg-white text-neutral-600 shadow-lg hover:text-dark lg:flex"
        aria-label={t.title}
        title={t.title}
      >
        <Bug size={18} />
      </button>

      <Modal
        open={open}
        onClose={submitting ? () => undefined : close}
        title={t.title}
        footer={
          <>
            <Button type="button" variant="secondary" disabled={submitting} onClick={close}>{common.cancel}</Button>
            <Button type="button" loading={submitting} loadingText={common.submitting} onClick={submit}>
              {t.submit}
            </Button>
          </>
        }
      >
        <FormGroup>
          <Label htmlFor="bugCategory">{t.category}</Label>
          <Select
            id="bugCategory"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={submitting}
          >
            <option value="" disabled>{t.categoryPlaceholder}</option>
            {Object.entries(t.categories).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
        </FormGroup>
        <FormGroup>
          <Label required htmlFor="bugSubject">{t.subject}</Label>
          <Input
            id="bugSubject"
            value={subject}
            maxLength={MAX_SUBJECT_LENGTH}
            placeholder={t.subjectPlaceholder}
            onChange={(e) => setSubject(e.target.value)}
            disabled={submitting}
          />
        </FormGroup>
        <FormGroup>
          <Label required htmlFor="bugDesc">{t.description}</Label>
          <Textarea
            id="bugDesc"
            rows={4}
            value={description}
            maxLength={MAX_DESCRIPTION_LENGTH}
            placeholder={t.descriptionPlaceholder}
            onChange={(e) => setDescription(e.target.value)}
            disabled={submitting}
          />
        </FormGroup>
        <FormGroup>
          <Label htmlFor="bugShot">{t.screenshot}</Label>
          <Input id="bugShot" type="file" accept="image/png,image/jpeg,image/gif,image/webp" disabled />
          <FormText>{t.screenshotNotBuilt}</FormText>
        </FormGroup>
        <FormGroup>
          <Label htmlFor="bugEmail">{t.contactEmail}</Label>
          <Input
            id="bugEmail"
            type="email"
            value={contactEmail}
            maxLength={MAX_CONTACT_EMAIL_LENGTH}
            onChange={(e) => setContactEmail(e.target.value)}
            disabled={submitting}
          />
          <FormText>{t.contactEmailHint}</FormText>
        </FormGroup>
        {error ? <FormError role="alert">{error}</FormError> : null}
      </Modal>
    </>
  );
}
