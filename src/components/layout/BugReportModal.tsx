'use client';
import * as React from 'react';
import { Bug } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FormGroup, Label, Input, Textarea, Select, FormText, FormError } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { common } from '@/i18n/zh-TW/common';
import { submitBugReport } from '@/services/bug-report';

/**
 * 全站共用的「回報問題」— 原站在側邊欄底部與每頁都掛著同一個 modal。
 *
 * The form is intentionally controlled so every value can be sent through the
 * service layer. The screenshot field remains disabled until an attachment
 * storage contract exists; the UI must not imply that an ignored file was saved.
 */
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
    if (!subject.trim()) {
      setError(t.subjectRequired);
      return;
    }
    if (!description.trim()) {
      setError(t.descriptionRequired);
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await submitBugReport({
        category: category || undefined,
        subject: subject.trim(),
        content: description.trim(),
        contactEmail: contactEmail.trim() || undefined,
        pageUrl: typeof window === 'undefined' ? undefined : window.location.href,
      });
      close();
      toast.show(t.submitted);
    } catch (e) {
      toast.show(`${t.submitFailed}${e instanceof Error ? e.message : ''}`, 'danger');
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
        onClose={close}
        title={t.title}
        footer={
          <>
            <Button variant="secondary" onClick={close}>{common.cancel}</Button>
            <Button loading={submitting} loadingText={common.submitting} onClick={submit}>
              {t.submit}
            </Button>
          </>
        }
      >
        <FormGroup>
          <Label required htmlFor="bugCategory">{t.category}</Label>
          <Select
            id="bugCategory"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
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
            placeholder={t.subjectPlaceholder}
            onChange={(e) => setSubject(e.target.value)}
          />
        </FormGroup>
        <FormGroup>
          <Label required htmlFor="bugDesc">{t.description}</Label>
          <Textarea
            id="bugDesc"
            rows={4}
            value={description}
            placeholder={t.descriptionPlaceholder}
            onChange={(e) => setDescription(e.target.value)}
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
            onChange={(e) => setContactEmail(e.target.value)}
          />
          <FormText>{t.contactEmailHint}</FormText>
        </FormGroup>
        {error ? <FormError>{error}</FormError> : null}
      </Modal>
    </>
  );
}
