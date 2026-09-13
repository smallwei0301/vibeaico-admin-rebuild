'use client';
import * as React from 'react';
import Link from 'next/link';
import { Bot, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Form';
import { common } from '@/i18n/zh-TW/common';
import { askSupport, type SupportAnswer } from '@/services/support-chat';

/**
 * 右下角小幫手 — 原站每頁常駐。
 *
 * 修好前的 `send()` 只有兩行：把訊息 append 到本地 state、清空輸入框。沒有端點、
 * 沒有回覆、永遠不會有。店家在**任何一頁**打字問問題，得到的是無聲。
 *
 * 現在它走 `src/services/support-chat.ts` → `POST /api/support-chat/ask`，回覆內容
 * 全部來自真表（`tenant_settings` / `push_quota_usage` / `feature_subscriptions`）。
 * 元件自己不判斷任何意圖、不組任何文案——那些都在伺服器端，這裡只負責顯示，
 * 免得同一組規則出現前後端兩份而慢慢分岔。
 */
export function SupportChatWidget() {
  const t = common.supportChat;
  const [open, setOpen] = React.useState(false);
  type ChatMsg = { role: 'assistant' | 'user'; text: string; answer?: SupportAnswer };
  const [messages, setMessages] = React.useState<ChatMsg[]>([
    { role: 'assistant', text: t.greeting },
  ]);
  const [draft, setDraft] = React.useState('');
  const [pending, setPending] = React.useState(false);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || pending) return;
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setDraft('');
    setPending(true);
    try {
      const answer = await askSupport(q);
      setMessages((m) => [...m, { role: 'assistant', text: answer.answer, answer }]);
    } catch {
      // 失敗就說失敗。原本的行為是「什麼都不說」，那是這個元件最初的病。
      setMessages((m) => [...m, { role: 'assistant', text: t.failed }]);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-lg hover:bg-primary-hover"
          aria-label={t.title}
        >
          <Bot size={22} />
        </button>
      )}

      {open && (
        <div className="fixed bottom-5 right-5 z-40 flex h-[28rem] w-[min(22rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
            <div className="flex items-center gap-2 font-bold">
              <Bot size={18} className="text-primary" />
              {t.title}
            </div>
            <button onClick={() => setOpen(false)} aria-label={common.close}>
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === 'assistant'
                    ? 'max-w-[85%] space-y-2 rounded-lg bg-neutral-100 px-3 py-2 text-sm'
                    : 'ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-white'
                }
              >
                <div>{m.text}</div>
                {m.answer?.facts.length ? (
                  <dl className="space-y-1 border-t border-neutral-200 pt-2 text-xs">
                    {m.answer.facts.map((f) => (
                      <div key={f.label} className="flex justify-between gap-3">
                        <dt className="text-neutral-500">{f.label}</dt>
                        <dd className={f.warning ? 'font-bold text-danger' : 'text-neutral-800'}>
                          {f.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {m.answer?.links.length ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {m.answer.links.map((l) => (
                      <Link
                        key={l.href}
                        href={l.href}
                        onClick={() => setOpen(false)}
                        className="rounded-md bg-white px-2 py-1 text-xs text-primary underline"
                      >
                        {l.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {pending && (
              <div className="max-w-[85%] rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-500">
                {t.sending}
              </div>
            )}
            {messages.length === 1 && (
              <div className="space-y-2 pt-1">
                <div className="text-xs text-neutral-500">{t.suggestionsTitle}</div>
                <div className="flex flex-wrap gap-2">
                  {t.suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void ask(s)}
                      className="rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 border-t border-neutral-200 p-3">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void ask(draft)}
              placeholder={t.placeholder}
              disabled={pending}
            />
            <Button size="icon" onClick={() => void ask(draft)} disabled={pending} aria-label={t.send}>
              <Send size={16} />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
