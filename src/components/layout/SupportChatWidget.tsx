'use client';
import * as React from 'react';
import { Bot, Send, X } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Form';
import { common } from '@/i18n/zh-TW/common';

/**
 * 右下角 AI 客服助理 — 原站每頁常駐。
 *
 * 誠實化（修復-7 / issue #15 第 ④ 項）：原本的 `send()` 只把輸入 push 進本地
 * 陣列，**零 API 呼叫、永遠不會有回覆**，畫面上也沒有任何「尚未建置」字樣——
 * 使用者以為訊息送給客服了。原站的四支端點（/api/support-chat/new-session、
 * status、history、message，見 docs/specs/reports.json 的 jsApiCalls）在本專案
 * 都還不存在，本輪不接後端，只移除欺騙：
 *   - 不再預設一句「我可以幫您查 LINE 狀態／推播額度…」的假招呼（那是能力宣稱）。
 *   - 面板內常駐說明尚未建置、訊息不會送出、也不會有回覆。
 *   - 輸入框與送出鍵停用，按不下去就不可能出現「已送出」。
 * 端點做出來時，把停用狀態拿掉並接上 services/support-chat 即可。
 */
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
