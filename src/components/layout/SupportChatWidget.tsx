'use client';
import * as React from 'react';
import { Bot, Send, X } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Form';
import { common } from '@/i18n/zh-TW/common';

/** 右下角 AI 客服助理 — 原站每頁常駐 */
export function SupportChatWidget() {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-lg hover:bg-primary-hover"
          aria-label={common.supportChat.title}
        >
          <Bot size={22} />
        </button>
      )}

      {open && (
        <div className="fixed bottom-5 right-5 z-40 flex h-[28rem] w-[min(22rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
            <div className="flex items-center gap-2 font-bold">
              <Bot size={18} className="text-primary" />
              {common.supportChat.title}
            </div>
            <button onClick={() => setOpen(false)} aria-label={common.close}>
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <Alert tone="warning" title={common.supportChat.notBuiltTitle}>
              {common.supportChat.notBuiltBody}
            </Alert>
          </div>
          <div className="flex items-center gap-2 border-t border-neutral-200 p-3">
            <Input
              value=""
              readOnly
              disabled
              placeholder={common.supportChat.disabledPlaceholder}
            />
            <Button size="icon" disabled aria-label={common.supportChat.send}>
              <Send size={16} />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
