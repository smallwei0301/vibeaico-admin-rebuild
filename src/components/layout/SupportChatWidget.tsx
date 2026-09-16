'use client';
import * as React from 'react';
import Link from 'next/link';
import { Bot, Send, X, UserRound, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Textarea, FormGroup, Label, FormError } from '@/components/ui/Form';
import { common } from '@/i18n/zh-TW/common';
import { askSupport, type SupportAnswer } from '@/services/support-chat';
import {
  listSupportChatThreads, getSupportChatThread, createSupportChatThread, addSupportChatMessage,
  type SupportChatThreadSummary, type SupportChatThreadDetail,
} from '@/services/support-chat-threads';

/**
 * 右下角小幫手 — 原站每頁常駐。
 *
 * 兩個獨立子系統共用同一個彈窗殼：
 *   1. 自助查詢（`askSupport()` → `/api/support-chat/ask`）——本檔一直都有的行為。
 *   2. 客服對話串（`createSupportChatThread()` 等 → `/api/support-chat/threads/*`）
 *      ——issue #25 B 段新增的「轉人工」，持久化留言＋通知平台＋店家自己的歷史。
 *
 * 兩者刻意不共用規則：這裡只負責顯示與呼叫 service，不判斷意圖、不組通知文案、
 * 不猜狀態——通知是否成功送出的誠實文案來自後端 `notifyStatus`
 * （`common.supportChatEscalation.notifyStatus`），不是這個元件自己編的話。
 */
type View = 'ASK' | 'ESCALATE_NEW' | 'ESCALATE_LIST' | 'ESCALATE_DETAIL';

export function SupportChatWidget() {
  const t = common.supportChat;
  const e = common.supportChatEscalation;
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState<View>('ASK');

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

  // ---- 客服對話串（轉人工） ----------------------------------------------
  const [escSubject, setEscSubject] = React.useState('');
  const [escBody, setEscBody] = React.useState('');
  const [escError, setEscError] = React.useState('');
  const [escSubmitting, setEscSubmitting] = React.useState(false);

  const [threads, setThreads] = React.useState<SupportChatThreadSummary[] | null>(null);
  const [threadsError, setThreadsError] = React.useState('');
  const [activeThread, setActiveThread] = React.useState<SupportChatThreadDetail | null>(null);
  const [threadError, setThreadError] = React.useState('');
  const [followUp, setFollowUp] = React.useState('');
  const [followUpSubmitting, setFollowUpSubmitting] = React.useState(false);
  const [followUpError, setFollowUpError] = React.useState('');

  const openHistory = async () => {
    setView('ESCALATE_LIST');
    setThreadsError('');
    try {
      setThreads(await listSupportChatThreads());
    } catch {
      setThreadsError(e.loadFailed);
    }
  };

  const openThread = async (id: string) => {
    setView('ESCALATE_DETAIL');
    setThreadError('');
    setActiveThread(null);
    try {
      setActiveThread(await getSupportChatThread(id));
    } catch {
      setThreadError(e.loadFailed);
    }
  };

  const submitEscalation = async () => {
    if (!escSubject.trim()) {
      setEscError(e.subjectRequired);
      return;
    }
    if (!escBody.trim()) {
      setEscError(e.messageRequired);
      return;
    }
    setEscError('');
    setEscSubmitting(true);
    try {
      const thread = await createSupportChatThread({
        subject: escSubject.trim(),
        body: escBody.trim(),
      });
      setEscSubject('');
      setEscBody('');
      setActiveThread(thread);
      setView('ESCALATE_DETAIL');
    } catch {
      setEscError(e.submitFailed);
    } finally {
      setEscSubmitting(false);
    }
  };

  const submitFollowUp = async () => {
    if (!activeThread || !followUp.trim()) return;
    setFollowUpError('');
    setFollowUpSubmitting(true);
    try {
      const message = await addSupportChatMessage(activeThread.id, { body: followUp.trim() });
      setActiveThread((cur) => (cur ? { ...cur, messages: [...cur.messages, message] } : cur));
      setFollowUp('');
    } catch {
      setFollowUpError(e.followUpFailed);
    } finally {
      setFollowUpSubmitting(false);
    }
  };

  const close = () => {
    setOpen(false);
    setView('ASK');
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
        <div className="fixed bottom-5 right-5 z-40 flex h-[32rem] w-[min(24rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
            <div className="flex items-center gap-2 font-bold">
              {view !== 'ASK' && (
                <button
                  type="button"
                  onClick={() => setView(view === 'ESCALATE_DETAIL' ? 'ESCALATE_LIST' : 'ASK')}
                  aria-label={e.backToList}
                  className="text-neutral-500 hover:text-dark"
                >
                  <ArrowLeft size={16} />
                </button>
              )}
              <Bot size={18} className="text-primary" />
              {view === 'ASK' ? t.title : e.panelTitle}
            </div>
            <div className="flex items-center gap-2">
              {view === 'ASK' && (
                <button
                  type="button"
                  onClick={() => setView('ESCALATE_NEW')}
                  className="flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
                >
                  <UserRound size={13} />
                  {e.escalateButton}
                </button>
              )}
              <button onClick={close} aria-label={common.close}>
                <X size={16} />
              </button>
            </div>
          </div>

          {view === 'ASK' && (
            <>
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
                    {m.role === 'assistant' && m.answer?.intent === 'UNSUPPORTED' && (
                      <button
                        type="button"
                        onClick={() => setView('ESCALATE_NEW')}
                        className="mt-1 flex items-center gap-1 rounded-md bg-white px-2 py-1 text-xs font-bold text-primary underline"
                      >
                        <UserRound size={12} />
                        {e.escalateButton}
                      </button>
                    )}
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
                  onChange={(ev) => setDraft(ev.target.value)}
                  onKeyDown={(ev) => ev.key === 'Enter' && void ask(draft)}
                  placeholder={t.placeholder}
                  disabled={pending}
                />
                <Button size="icon" onClick={() => void ask(draft)} disabled={pending} aria-label={t.send}>
                  <Send size={16} />
                </Button>
              </div>
            </>
          )}

          {view === 'ESCALATE_NEW' && (
            <div className="flex flex-1 flex-col overflow-y-auto p-4">
              <FormGroup>
                <Label required htmlFor="escSubject">{e.subject}</Label>
                <Input
                  id="escSubject"
                  value={escSubject}
                  placeholder={e.subjectPlaceholder}
                  onChange={(ev) => setEscSubject(ev.target.value)}
                />
              </FormGroup>
              <FormGroup className="flex-1">
                <Label required htmlFor="escBody">{e.message}</Label>
                <Textarea
                  id="escBody"
                  rows={6}
                  value={escBody}
                  placeholder={e.messagePlaceholder}
                  onChange={(ev) => setEscBody(ev.target.value)}
                />
              </FormGroup>
              {escError ? <FormError>{escError}</FormError> : null}
              <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => void openHistory()}
                  className="text-xs text-neutral-500 underline hover:text-dark"
                >
                  {e.historyTab}
                </button>
                <Button loading={escSubmitting} loadingText={e.submitting} onClick={() => void submitEscalation()}>
                  {e.submit}
                </Button>
              </div>
            </div>
          )}

          {view === 'ESCALATE_LIST' && (
            <div className="flex-1 overflow-y-auto p-4">
              {threadsError ? <FormError>{threadsError}</FormError> : null}
              {threads === null && !threadsError ? (
                <div className="text-sm text-neutral-500">{e.loading}</div>
              ) : null}
              {threads?.length === 0 ? (
                <div className="text-sm text-neutral-500">{e.empty}</div>
              ) : null}
              <div className="space-y-2">
                {threads?.map((th) => (
                  <button
                    key={th.id}
                    type="button"
                    onClick={() => void openThread(th.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-left text-sm hover:bg-neutral-50"
                  >
                    <span className="truncate">{th.subject}</span>
                    {th.unread && (
                      <span className="rounded-full bg-danger px-2 py-0.5 text-xs text-white">
                        {e.unreadBadge}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {view === 'ESCALATE_DETAIL' && (
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {threadError ? <FormError>{threadError}</FormError> : null}
                {!activeThread && !threadError ? (
                  <div className="text-sm text-neutral-500">{e.loading}</div>
                ) : null}
                {activeThread && (
                  <div className="rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
                    {e.notifyStatus[activeThread.notifyStatus]}
                  </div>
                )}
                {activeThread?.messages.map((m) => (
                  <div
                    key={m.id}
                    className={
                      m.senderRole === 'TENANT'
                        ? 'ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-white'
                        : 'max-w-[85%] rounded-lg bg-neutral-100 px-3 py-2 text-sm'
                    }
                  >
                    <div className="mb-0.5 text-xs opacity-70">{e.sentBy[m.senderRole]}</div>
                    <div>{m.body}</div>
                  </div>
                ))}
              </div>
              {activeThread && (
                <div className="flex items-center gap-2 border-t border-neutral-200 p-3">
                  <Input
                    value={followUp}
                    onChange={(ev) => setFollowUp(ev.target.value)}
                    onKeyDown={(ev) => ev.key === 'Enter' && void submitFollowUp()}
                    placeholder={e.followUpPlaceholder}
                    disabled={followUpSubmitting}
                  />
                  <Button
                    size="icon"
                    onClick={() => void submitFollowUp()}
                    disabled={followUpSubmitting}
                    aria-label={t.send}
                  >
                    <Send size={16} />
                  </Button>
                </div>
              )}
              {followUpError ? <div className="px-3 pb-2"><FormError>{followUpError}</FormError></div> : null}
            </div>
          )}
        </div>
      )}
    </>
  );
}
