'use client';
import * as React from 'react';
import { Bug } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FormGroup, Label, Input, Textarea, Select, FormText, FormError } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { common } from '@/i18n/zh-TW/common';
import { submitBugReport } from '@/services/bug-report';
import { uploadFile } from '@/services/upload';

/**
 * 全站共用的「回報問題」— 原站在側邊欄底部與每頁都掛著同一個 modal。
 *
 * 修改前（issue #28 第 ① 筆 / 14 分冊 §7）：四個欄位全是 uncontrolled
 * （`<Input id="bugSubject" />`，無 value/onChange），submit() 只 setTimeout 500ms
 * 就顯示「已收到您的回報，感謝協助！」。使用者回報的每一個問題都直接消失，
 * 而畫面向他道謝——`POST /api/bug-report` 一直存在，從來沒有被呼叫過。
 *
 * issue #28 修好了四個文字欄位，但截圖欄位當時**只做到誠實化**（停用＋在畫面上
 * 說明尚未建置），因為三塊都缺：`bug_reports` 沒有附件欄位、Storage 白名單沒有
 * 可用的 bucket、`/api/bug-report` 契約沒有附件。
 *
 * issue #30（14 分冊 §8.14，擁有者裁決「現在就補」）補齊：migration 0019 建了
 * **private** bucket `bug-report-attachments` 與 `bug_reports.attachment_path`，
 * `/api/upload` 收這個 bucket 並回簽名 URL ＋ path，端點驗完路徑歸屬與物件存在
 * 才寫入。所以這裡的檔案欄位解除停用、真的上傳，「尚未建置」那句一併刪掉——
 * 功能已經有了還留著那句，就是反方向的假的已知。
 */

/** 與 `/api/upload` 的 MAX_BYTES 一致；前端先擋一次，使用者不必等上傳完才知道太大。 */
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
/**
 * 與 `/api/upload` 對**非 LINE 去向 bucket** 的 WEB_TYPES 一致。
 * 回報截圖不會變成 LINE image message，所以 WebP 是可以收的（同畫質更小）——
 * 不要因為 chat-images / richmenu-assets 只收 JPEG/PNG 就跟著砍。
 * 先前這裡的 accept 還列著 image/gif，但端點從來就不收 GIF：使用者選得到、
 * 送出必被退，是一個小型的「畫面說可以、實際不行」，一併對齊。
 */
const ACCEPTED_SCREENSHOT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function BugReportButton() {
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const toast = useToast();
  const t = common.bugReport;

  const [category, setCategory] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [contactEmail, setContactEmail] = React.useState('');
  const [screenshot, setScreenshot] = React.useState<File | null>(null);
  const [error, setError] = React.useState('');
  /** file input 是 uncontrolled（React 不允許設它的 value），關閉時要手動清掉檔名 */
  const screenshotInput = React.useRef<HTMLInputElement>(null);

  const reset = () => {
    setCategory('');
    setSubject('');
    setDescription('');
    setContactEmail('');
    setScreenshot(null);
    setError('');
    if (screenshotInput.current) screenshotInput.current.value = '';
  };

  const close = () => {
    setOpen(false);
    reset();
  };

  const pickScreenshot = (file: File | null) => {
    if (!file) {
      setScreenshot(null);
      setError('');
      return;
    }
    if (!ACCEPTED_SCREENSHOT_TYPES.includes(file.type)) {
      setScreenshot(null);
      if (screenshotInput.current) screenshotInput.current.value = '';
      setError(t.screenshotBadType);
      return;
    }
    if (file.size > MAX_SCREENSHOT_BYTES) {
      setScreenshot(null);
      if (screenshotInput.current) screenshotInput.current.value = '';
      setError(t.screenshotTooLarge);
      return;
    }
    setScreenshot(file);
    setError('');
  };

  const reason = (e: unknown) => (e instanceof Error ? e.message : '');

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
      // 截圖先上傳，拿 bucket 內路徑（不是簽名 URL——那個會過期）。
      // 上傳失敗就**不送出**：否則會存下一筆「使用者以為附了圖」的回報，
      // 平台端永遠等不到那張圖，而畫面已經向他道過謝。
      let attachmentPath: string | undefined;
      if (screenshot) {
        try {
          const uploaded = await uploadFile(screenshot, 'bug-report-attachments');
          attachmentPath = uploaded.path;
        } catch (e) {
          toast.show(`${t.screenshotUploadFailed}${reason(e)}`, 'danger');
          return;
        }
      }
      await submitBugReport({
        category: category || undefined,
        subject: subject.trim(),
        content: description.trim(),
        contactEmail: contactEmail.trim() || undefined,
        // 回報當下所在頁面：平台端要重現問題，這是最省事的線索
        pageUrl: typeof window === 'undefined' ? undefined : window.location.href,
        attachmentPath,
      });
      close();
      toast.show(t.submitted);
    } catch (e) {
      toast.show(`${t.submitFailed}${reason(e)}`, 'danger');
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
          <Input
            id="bugShot"
            ref={screenshotInput}
            type="file"
            accept={ACCEPTED_SCREENSHOT_TYPES.join(',')}
            onChange={(e) => pickScreenshot(e.target.files?.[0] ?? null)}
          />
          <FormText>{t.screenshotHint}</FormText>
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
