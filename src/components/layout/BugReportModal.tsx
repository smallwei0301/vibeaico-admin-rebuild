'use client';
import * as React from 'react';
import { Bug } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FormGroup, Label, Input, Textarea, Select, FormText } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { common } from '@/i18n/zh-TW/common';

/** 全站共用的「回報問題」— 原站在側邊欄底部與每頁都掛著同一個 modal */
export function BugReportButton() {
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const toast = useToast();
  const t = common.bugReport;

  const submit = async () => {
    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 500));
    setSubmitting(false);
    setOpen(false);
    toast.show('已收到您的回報，感謝協助！');
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
        onClose={() => setOpen(false)}
        title={t.title}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>{common.cancel}</Button>
            <Button loading={submitting} loadingText={common.submitting} onClick={submit}>
              {t.submit}
            </Button>
          </>
        }
      >
        <FormGroup>
          <Label required htmlFor="bugCategory">{t.category}</Label>
          <Select id="bugCategory" defaultValue="">
            <option value="" disabled>{t.categoryPlaceholder}</option>
            {Object.entries(t.categories).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
        </FormGroup>
        <FormGroup>
          <Label required htmlFor="bugSubject">{t.subject}</Label>
          <Input id="bugSubject" />
        </FormGroup>
        <FormGroup>
          <Label required htmlFor="bugDesc">{t.description}</Label>
          <Textarea id="bugDesc" rows={4} />
        </FormGroup>
        <FormGroup>
          <Label htmlFor="bugShot">{t.screenshot}</Label>
          <Input id="bugShot" type="file" accept="image/png,image/jpeg,image/gif,image/webp" />
          <FormText>{t.screenshotHint}</FormText>
        </FormGroup>
        <FormGroup>
          <Label htmlFor="bugEmail">{t.contactEmail}</Label>
          <Input id="bugEmail" type="email" />
        </FormGroup>
      </Modal>
    </>
  );
}
