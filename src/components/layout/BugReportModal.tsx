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
 * 修改前（issue #28 第 ① 筆 / 14 分冊 §7）：四個欄位全是 uncontrolled
 * （`<Input id="bugSubject" />`，無 value/onChange），submit() 只 setTimeout 500ms
 * 就顯示「已收到您的回報，感謝協助！」。使用者回報的每一個問題都直接消失，
 * 而畫面向他道謝——`POST /api/bug-report` 一直存在，從來沒有被呼叫過。
 *
 * 現在：四個欄位 controlled，送出經 src/services/bug-report.ts 打真實端點，
 * 成功才顯示成功、失敗顯示 danger。
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
        // 回報當下所在頁面：平台端要重現問題，這是最省事的線索
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
          {/* 截圖上傳尚未建置：端點與資料表都沒有附件落點，停用並明說，
              不讓使用者選了檔案卻在送出後收到道謝（同一類假成功）。 */}
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
