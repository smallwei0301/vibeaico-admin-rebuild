'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, ChevronRight, MessageSquareText, RefreshCw, Search, Send } from 'lucide-react';

import { GuideActionCard } from './GuideActionCard';
import { GuideEmptyState } from './GuideEmptyState';
import { GuideHeader } from './GuideHeader';
import { GuideSectionCard } from './GuideSectionCard';
import { GuideStatusPill } from './GuideStatusPill';
import { GUIDE_UI_CLASSES } from '@/config/guide-ui';
import {
  CONVERSATION_POLL_MS,
  MESSAGE_POLL_MS,
  listConversations,
  listMessages,
  markThreadRead,
  sendMessage,
  startPolling,
  type ChatConversation,
  type ChatMessage,
} from '@/services/chat';
import { guideMessages as t } from '@/i18n/zh-TW/pages/guide-messages';
import {
  filterGuideConversations,
  selectGuideWaitingConversations,
  type GuideMessageFilter,
} from '@/lib/guide-messages';
import { cn, formatTime } from '@/lib/utils';

const FILTERS: readonly GuideMessageFilter[] = ['ALL', 'WAITING'];

function messagePreview(conversation: ChatConversation): string {
  if (conversation.lastMessageType === 'IMAGE') return t.labels.image;
  return conversation.lastMessage || t.list.noPreview;
}

export function GuideMessagesView() {
  const [conversations, setConversations] = React.useState<ChatConversation[]>([]);
  const [listLoading, setListLoading] = React.useState(true);
  const [listError, setListError] = React.useState(false);
  const [filter, setFilter] = React.useState<GuideMessageFilter>('ALL');
  const [keyword, setKeyword] = React.useState('');
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [threadLoading, setThreadLoading] = React.useState(false);
  const [threadError, setThreadError] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [sendError, setSendError] = React.useState(false);

  const activeIdRef = React.useRef<string | null>(null);
  const lastFetchAt = React.useRef<string | null>(null);
  const lastMessageId = React.useRef<string | null>(null);
  const openSequence = React.useRef(0);

  const load = React.useCallback(async () => {
    setListLoading(true);
    setListError(false);
    try {
      const rows = await listConversations();
      setConversations(rows.slice().sort((a, b) => filterGuideConversations([a, b])[0] === a ? -1 : 1));
      lastFetchAt.current = new Date().toISOString();
    } catch {
      setListError(true);
    } finally {
      setListLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    const stop = startPolling(async () => {
      const since = lastFetchAt.current;
      const fetchedAt = new Date().toISOString();
      try {
        const updated = await listConversations(since ? { since } : {});
        lastFetchAt.current = fetchedAt;
        if (updated.length === 0) return;
        setConversations((current) => {
          const merged = new Map(current.map((conversation) => [conversation.id, conversation] as const));
          for (const conversation of updated) {
            merged.set(conversation.id, {
              ...conversation,
              unread: conversation.id === activeIdRef.current ? 0 : conversation.unread,
            });
          }
          return [...merged.values()].sort((a, b) => filterGuideConversations([a, b])[0] === a ? -1 : 1);
        });
      } catch {
        // Keep the last known inbox on a transient poll failure.
      }
    }, CONVERSATION_POLL_MS);
    return stop;
  }, [load]);

  const waiting = selectGuideWaitingConversations(conversations);
  const visible = filterGuideConversations(conversations, filter, keyword);
  const active = conversations.find((conversation) => conversation.id === activeId) ?? null;

  const openConversation = (conversation: ChatConversation) => {
    const sequence = ++openSequence.current;
    activeIdRef.current = conversation.id;
    setActiveId(conversation.id);
    setMessages([]);
    setThreadLoading(true);
    setThreadError(false);
    setSendError(false);
    setDraft('');
    setConversations((current) => current.map((row) => (
      row.id === conversation.id ? { ...row, unread: 0 } : row
    )));
    void (async () => {
      try {
        const rows = await listMessages({ lineUserId: conversation.id });
        if (sequence !== openSequence.current) return;
        setMessages(rows);
        void markThreadRead(rows);
      } catch {
        if (sequence !== openSequence.current) return;
        setThreadError(true);
      } finally {
        if (sequence === openSequence.current) setThreadLoading(false);
      }
    })();
  };

  const backToList = () => {
    openSequence.current += 1;
    activeIdRef.current = null;
    setActiveId(null);
    setMessages([]);
    setDraft('');
    setThreadError(false);
    setSendError(false);
  };

  React.useEffect(() => {
    lastMessageId.current = messages.length ? messages[messages.length - 1].id : null;
  }, [messages]);

  React.useEffect(() => {
    if (!activeId) return;
    const stop = startPolling(async () => {
      const after = lastMessageId.current;
      try {
        const fresh = await listMessages(after
          ? { lineUserId: activeId, after }
          : { lineUserId: activeId });
        if (fresh.length === 0) return;
        setMessages((current) => {
          const seen = new Set(current.map((message) => message.id));
          const added = fresh.filter((message) => !seen.has(message.id));
          return added.length ? [...current, ...added] : current;
        });
        void markThreadRead(fresh);
      } catch {
        // Keep the last known thread on a transient poll failure.
      }
    }, MESSAGE_POLL_MS);
    return stop;
  }, [activeId]);

  const sendText = async () => {
    const text = draft.trim();
    if (!text || !activeId) return;
    setSending(true);
    setSendError(false);
    try {
      const sent = await sendMessage({ lineUserId: activeId, text });
      setMessages((current) => [...current, sent]);
      setConversations((current) => current.map((row) => (
        row.id === activeId
          ? {
              ...row,
              lastMessageType: 'TEXT',
              lastMessage: text,
              lastMessageAt: sent.at,
              unread: 0,
            }
          : row
      )));
      setDraft('');
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  };

  const retryAction = (
    <button
      type="button"
      className={cn(GUIDE_UI_CLASSES.secondaryButton, GUIDE_UI_CLASSES.touchTarget, GUIDE_UI_CLASSES.focusRing)}
      onClick={() => { void load(); }}
    >
      <RefreshCw size={17} aria-hidden />
      {t.retry}
    </button>
  );

  return (
    <div className={cn(GUIDE_UI_CLASSES.page, GUIDE_UI_CLASSES.sectionGap)}>
      {active ? (
        <>
          <GuideHeader
            title={active.customerName || t.labels.customerFallback}
            subtitle={t.thread.title}
            leading={(
              <button
                type="button"
                className={cn(GUIDE_UI_CLASSES.outlinedIconButton, GUIDE_UI_CLASSES.touchTarget, GUIDE_UI_CLASSES.focusRing)}
                aria-label={t.thread.back}
                onClick={backToList}
              >
                <ArrowLeft size={20} aria-hidden />
              </button>
            )}
            action={(
              <Link
                href={'/tenant/customers?keyword=' + encodeURIComponent(active.customerName)}
                className={cn(GUIDE_UI_CLASSES.secondaryButton, GUIDE_UI_CLASSES.touchTarget, GUIDE_UI_CLASSES.focusRing, 'whitespace-nowrap')}
              >
                {t.thread.viewProfile}
              </Link>
            )}
          />

          <GuideSectionCard title={t.thread.messageLabel} description={t.thread.description}>
            {threadLoading ? (
              <GuideEmptyState title={t.thread.loading} description={t.thread.loadingDescription} />
            ) : threadError ? (
              <GuideEmptyState
                title={t.thread.loadFailedTitle}
                description={t.thread.loadFailedDescription}
                action={retryAction}
              />
            ) : messages.length === 0 ? (
              <GuideEmptyState title={t.thread.noMessages} description={t.thread.noMessagesDescription} />
            ) : (
              <div className="max-h-[55vh] space-y-3 overflow-y-auto" role="log" aria-label={t.thread.messageLabel} aria-live="polite">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn('flex flex-col gap-1', message.from === 'SHOP' ? 'items-end' : 'items-start')}
                  >
                    <div
                      className={cn(
                        'max-w-[90%] rounded-[18px] px-4 py-3 text-[16px] leading-normal',
                        message.from === 'SHOP'
                          ? 'bg-[#173F35] text-white'
                          : 'bg-[#FAF8F3] text-[#1D2A26]',
                      )}
                    >
                      {message.type === 'IMAGE' ? (
                        message.imageUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={message.imageUrl} alt={t.labels.image} className="max-h-64 max-w-full rounded-xl object-contain" />
                        ) : (
                          <span>{t.labels.image}</span>
                        )
                      ) : (
                        <span className="whitespace-pre-line break-words">{message.text}</span>
                      )}
                    </div>
                    <time className={GUIDE_UI_CLASSES.secondary} dateTime={message.at}>
                      {formatTime(message.at)}
                    </time>
                  </div>
                ))}
              </div>
            )}
          </GuideSectionCard>

          <form
            className={cn(GUIDE_UI_CLASSES.card, GUIDE_UI_CLASSES.cardPadding)}
            onSubmit={(event) => {
              event.preventDefault();
              void sendText();
            }}
          >
            <label htmlFor="guide-message-draft" className="sr-only">{t.composer.label}</label>
            <div className="flex items-end gap-2">
              <textarea
                id="guide-message-draft"
                rows={2}
                className={cn('min-h-[48px] min-w-0 flex-1 resize-y rounded-xl border border-[#DCE5E0] bg-white px-3 py-2 text-[16px] leading-normal', GUIDE_UI_CLASSES.focusRing)}
                placeholder={t.composer.placeholder}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendText();
                  }
                }}
              />
              <button
                type="submit"
                className={cn(GUIDE_UI_CLASSES.primaryButton, GUIDE_UI_CLASSES.touchTarget, GUIDE_UI_CLASSES.focusRing, 'shrink-0 justify-center')}
                aria-label={sending ? t.composer.sending : t.composer.send}
                disabled={!draft.trim() || sending}
              >
                <Send size={17} aria-hidden />
                <span className="sr-only sm:not-sr-only">{sending ? t.composer.sending : t.composer.send}</span>
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
              <p className={GUIDE_UI_CLASSES.secondary}>{t.composer.hint}</p>
              {sendError ? <p className="text-[14px] leading-normal text-[#B42318]" role="alert">{t.composer.sendFailed}</p> : null}
            </div>
          </form>
        </>
      ) : (
        <>
          <GuideHeader title={t.title} subtitle={t.subtitle} />

          <GuideSectionCard title={t.waiting.title} description={t.waiting.description}>
            {listLoading ? (
              <GuideEmptyState title={t.loading} description={t.loadingDescription} />
            ) : listError ? (
              <GuideEmptyState title={t.error.title} description={t.error.description} action={retryAction} />
            ) : waiting.length === 0 ? (
              <GuideEmptyState title={t.waiting.emptyTitle} description={t.waiting.emptyDescription} icon={<MessageSquareText size={22} />} />
            ) : (
              <div className="space-y-2">
                {waiting.map((conversation) => (
                  <GuideActionCard
                    key={conversation.id}
                    title={conversation.customerName || t.labels.customerFallback}
                    description={messagePreview(conversation)}
                    meta={<GuideStatusPill tone="attention">{t.status.waiting(conversation.unread)}</GuideStatusPill>}
                    trailing={<ChevronRight size={20} aria-hidden />}
                    aria-label={t.list.openConversation + '：' + (conversation.customerName || t.labels.customerFallback)}
                    onClick={() => openConversation(conversation)}
                  />
                ))}
              </div>
            )}
          </GuideSectionCard>

          <GuideSectionCard title={t.search.title}>
            <label htmlFor="guide-message-search" className="sr-only">{t.search.label}</label>
            <div className="relative">
              <Search size={20} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#63726C]" />
              <input
                id="guide-message-search"
                type="search"
                className={cn(GUIDE_UI_CLASSES.searchInput, GUIDE_UI_CLASSES.focusRing, 'border border-[#DCE5E0] bg-white')}
                placeholder={t.search.placeholder}
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
              />
              {keyword ? (
                <button
                  type="button"
                  className={cn(GUIDE_UI_CLASSES.touchTarget, GUIDE_UI_CLASSES.focusRing, 'absolute right-1 top-1/2 -translate-y-1/2 rounded-xl text-[22px] leading-none text-[#63726C]')}
                  aria-label={t.search.clear}
                  onClick={() => setKeyword('')}
                >
                  ×
                </button>
              ) : null}
            </div>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label={t.filters.label}>
              {FILTERS.map((value) => {
                const selected = filter === value;
                const count = value === 'ALL' ? conversations.length : waiting.length;
                return (
                  <button
                    key={value}
                    type="button"
                    className={cn(
                      GUIDE_UI_CLASSES.touchTarget,
                      GUIDE_UI_CLASSES.filterPill,
                      GUIDE_UI_CLASSES.focusRing,
                      selected ? GUIDE_UI_CLASSES.filterPillActive : GUIDE_UI_CLASSES.filterPillInactive,
                    )}
                    aria-pressed={selected}
                    onClick={() => setFilter(value)}
                  >
                    {value === 'ALL' ? t.filters.all : t.filters.waiting}
                    <span className="ml-1 text-[14px]">({count})</span>
                  </button>
                );
              })}
            </div>
          </GuideSectionCard>

          <GuideSectionCard title={t.list.title} description={t.list.count(visible.length)}>
            {listLoading ? (
              <GuideEmptyState title={t.loading} description={t.loadingDescription} />
            ) : listError ? (
              <GuideEmptyState title={t.error.title} description={t.error.description} action={retryAction} />
            ) : visible.length === 0 ? (
              <GuideEmptyState
                title={keyword.trim() || filter === 'WAITING' ? t.list.filteredTitle : t.list.emptyTitle}
                description={keyword.trim() || filter === 'WAITING' ? t.list.filteredDescription : t.list.emptyDescription}
                icon={<MessageSquareText size={22} />}
              />
            ) : (
              <div className="space-y-2">
                {visible.map((conversation) => (
                  <GuideActionCard
                    key={conversation.id}
                    title={conversation.customerName || t.labels.customerFallback}
                    description={messagePreview(conversation)}
                    meta={conversation.unread > 0
                      ? <GuideStatusPill tone="attention">{t.status.waiting(conversation.unread)}</GuideStatusPill>
                      : <GuideStatusPill tone="neutral">{t.status.read}</GuideStatusPill>}
                    trailing={<ChevronRight size={20} aria-hidden />}
                    aria-label={t.list.openConversation + '：' + (conversation.customerName || t.labels.customerFallback)}
                    onClick={() => openConversation(conversation)}
                  />
                ))}
              </div>
            )}
          </GuideSectionCard>
        </>
      )}
    </div>
  );
}
