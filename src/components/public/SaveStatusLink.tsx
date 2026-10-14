'use client';

import { useState } from 'react';
import { Link2 } from 'lucide-react';
import { copyStatusLink, type CopyResult } from '@/lib/save-status-link';
import { publicTourRequestPage as t } from '@/i18n/zh-TW/pages/public-tour-request';

/** #951：提示旅客保存此頁連結並提供複製按鈕；網址於點擊時才讀 window.location，不接收訂單或聯絡方式。 */
export function SaveStatusLink({ prominent }: { prominent: boolean }) {
  const [result, setResult] = useState<CopyResult | null>(null);

  async function onCopy() {
    setResult(await copyStatusLink(window.location.href, navigator.clipboard));
  }

  const body = (
    <>
      <p className={prominent ? 'text-sm font-medium' : 'text-sm text-secondary'}>{t.status.saveLink.hint}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-outline" onClick={onCopy}>
          <Link2 className="h-4 w-4" aria-hidden="true" />
          {t.status.saveLink.copy}
        </button>
        <span role="status" aria-live="polite" className={result === 'failed' ? 'text-sm text-danger' : 'text-sm text-success'}>
          {result === 'copied' ? t.status.saveLink.copied : result === 'failed' ? t.status.saveLink.copyFailed : ''}
        </span>
      </div>
    </>
  );

  return prominent ? (
    <section className="card border border-primary">
      <div className="card-body flex flex-col gap-2">{body}</div>
    </section>
  ) : (
    <section className="flex flex-col gap-2">{body}</section>
  );
}
