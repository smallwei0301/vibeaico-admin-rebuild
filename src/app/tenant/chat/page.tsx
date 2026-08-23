'use client';
import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Image as ImageIcon, MessageSquareText, Search, Send } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { CountBadge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, Textarea } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api';
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
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { chatPage as t } from '@/i18n/zh-TW/pages/chat';
import { cn, formatTime } from '@/lib/utils';

/**
 * 顧客訊息 — 資料一律走 src/services/chat.ts（04 分冊 §B-5.1）。
 * 假資料已搬進 service 的 mock 分支；輪詢規約（5 秒 after 增量、15 秒 since
 * 列表、hidden 暫停）都收在 service 的 startPolling / list* 裡，本頁只掛/卸。
 */

/** 相對時間標籤；只在載入／送出等事件中計算，不在 render 期呼叫 */
function relativeTime(iso: string, now: number): string {
  const diffMinutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (diffMinutes < 1) return t.labels.justNow;
  if (diffMinutes < 60) return t.labels.minutesAgo(diffMinutes);
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return t.labels.hoursAgo(hours);
  return t.labels.daysAgo(Math.floor(hours / 24));
}

type ConversationRow = ChatConversation & { timeLabel: string };

const toRow = (c: ChatConversation, now: number): ConversationRow => ({
  ...c,
  timeLabel: c.lastMessageAt ? relativeTime(c.lastMessageAt, now) : '',
});

/** 最後訊息時間新→舊；沒訊息的排最後 */
function byLastMessageDesc(a: ConversationRow, b: ConversationRow): number {
  if (a.lastMessageAt && b.lastMessageAt) return a.lastMessageAt < b.lastMessageAt ? 1 : -1;
  if (a.lastMessageAt) return -1;
  if (b.lastMessageAt) return 1;
  return 0;
}

/** 本地（未上傳）訊息 id 前綴：圖片僅前端預覽用，不能當 after 錨點 */
const LOCAL_ID_PREFIX = 'm_local_';

export default function ChatPage() {
  const toast = useToast();

  const [conversations, setConversations] = React.useState<ConversationRow[]>([]);
  const [listLoading, setListLoading] = React.useState(true);
  const [keyword, setKeyword] = React.useState('');

  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [threadLoading, setThreadLoading] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [sending, setSending] = React.useState(false);

  /** 手機版單欄：list ⇄ thread */
  const [mobileThread, setMobileThread] = React.useState(false);

  const fileRef = React.useRef<HTMLInputElement>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const nextId = React.useRef(1);

  /** 輪詢 callback 讀取用（effect 只掛一次，不重建計時器） */
  const activeIdRef = React.useRef<string | null>(null);
  /** 開啟中對話最後一筆「伺服器」訊息 id（after=<此值> 拉增量） */
  const lastMessageIdRef = React.useRef<string | null>(null);
  /** 快速切換對話時丟棄過期的載入結果 */
  const openSeq = React.useRef(0);

  /* ------------------------------------------ 對話清單：載入 + 15 秒輪詢 */
  React.useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    const lastFetchAt = { current: new Date().toISOString() };

    void (async () => {
      try {
        const list = await listConversations();
        if (cancelled) return;
        const now = Date.now();
        setConversations(list.map((c) => toRow(c, now)));
      } catch {
        if (!cancelled) toast.show(t.list.loadFailed, 'danger');
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();

    /* §B-5.1：每 15 秒帶 since=<上次拉取時間> 更新未讀數與最後訊息；
       document.hidden 暫停、回前景立刻拉一次（都在 startPolling 內）。
       mock 模式下 startPolling 是 no-op，假資料不會被增量結果清掉。 */
    const stop = startPolling(async () => {
      const since = lastFetchAt.current;
      const fetchedAt = new Date().toISOString();
      const updated = await listConversations({ since });
      lastFetchAt.current = fetchedAt;
      if (updated.length === 0) return;
      const now = Date.now();
      setConversations((list) => {
        const merged = new Map(list.map((c) => [c.id, c] as const));
        for (const c of updated) {
          merged.set(c.id, {
            ...toRow(c, now),
            /* 開啟中的對話視為已讀（訊息輪詢會同步 markRead） */
            unread: c.id === activeIdRef.current ? 0 : c.unread,
          });
        }
        return [...merged.values()].sort(byLastMessageDesc);
      });
    }, CONVERSATION_POLL_MS);

    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------------------ 訊息串 */
  const openConversation = (c: ConversationRow) => {
    if (!c.id) {
      toast.show(t.messages.notBound, 'warning');
      return;
    }
    const seq = ++openSeq.current;
    setActiveId(c.id);
    activeIdRef.current = c.id;
    lastMessageIdRef.current = null;
    setMobileThread(true);
    setThreadLoading(true);
    setDraft('');
    /* 讀取後清掉未讀數（伺服器端由 markThreadRead 逐筆 read） */
    setConversations((list) => list.map((x) => (x.id === c.id ? { ...x, unread: 0 } : x)));
    void (async () => {
      try {
        const msgs = await listMessages({ lineUserId: c.id });
        if (seq !== openSeq.current) return;
        setMessages(msgs);
        void markThreadRead(msgs);
      } catch {
        if (seq !== openSeq.current) return;
        setMessages([]);
        toast.show(t.thread.loadFailed, 'danger');
      } finally {
        if (seq === openSeq.current) setThreadLoading(false);
      }
    })();
  };

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
    /* 記住最後一筆伺服器訊息，當下一輪 after 增量輪詢的錨點 */
    const lastServer = [...messages].reverse().find((m) => !m.id.startsWith(LOCAL_ID_PREFIX));
    lastMessageIdRef.current = lastServer?.id ?? null;
  }, [messages]);

  /* §B-5.1：開啟中的對話每 5 秒帶 after=<最後一筆 id> 拉增量（mock 為 no-op） */
  React.useEffect(() => {
    if (!activeId) return;
    const stop = startPolling(async () => {
      const lastId = lastMessageIdRef.current;
      const fresh = lastId
        ? await listMessages({ lineUserId: activeId, after: lastId })
        : await listMessages({ lineUserId: activeId });
      if (fresh.length === 0) return;
      setMessages((list) => {
        const seen = new Set(list.map((m) => m.id));
        const added = fresh.filter((m) => !seen.has(m.id));
        return added.length ? [...list, ...added] : list;
      });
      void markThreadRead(fresh);
    }, MESSAGE_POLL_MS);
    return stop;
  }, [activeId]);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  const filtered = keyword.trim()
    ? conversations.filter((c) => c.customerName.includes(keyword.trim()))
    : conversations;

  const appendOwnMessage = (message: Omit<ChatMessage, 'id'>) => {
    const id = `${LOCAL_ID_PREFIX}${nextId.current++}`;
    setMessages((list) => [...list, { ...message, id }]);
  };

  const sendText = async () => {
    const text = draft.trim();
    if (!text || !activeId) return;
    setSending(true);
    try {
      const sent = await sendMessage({ lineUserId: activeId, text });
      setMessages((list) => [...list, sent]);
      setDraft('');
      setConversations((list) => list.map((c) => (c.id === activeId
        ? { ...c, lastMessageType: 'TEXT', lastMessage: text, timeLabel: t.labels.justNow }
        : c)));
    } catch (error) {
      /* 409 REQ_003（本月推播額度已用完）把後端 message 原樣顯示 */
      const message = error instanceof ApiError && error.code === 'REQ_003' && error.message
        ? error.message
        : t.messages.sendFailed;
      toast.show(message, 'danger');
    } finally {
      setSending(false);
    }
  };

  const sendImage = (file: File | undefined) => {
    if (!file || !activeId) return;
    if (file.size > t.imageMaxBytes) {
      toast.show(t.messages.imageTooLarge, 'warning');
      return;
    }
    try {
      appendOwnMessage({
        from: 'SHOP', type: 'IMAGE', text: '',
        imageUrl: URL.createObjectURL(file), at: new Date().toISOString(), readAt: null,
      });
      setConversations((list) => list.map((c) => (c.id === activeId
        ? { ...c, lastMessageType: 'IMAGE', lastMessage: '', timeLabel: t.labels.justNow }
        : c)));
    } catch {
      toast.show(t.messages.imageSendFailed, 'danger');
    }
  };

  return (
    <>
      <PageHeader eyebrow={nav.navCustomer} title={t.title} />

      <Card className="overflow-hidden">
        <div className="grid h-[calc(100vh-16rem)] min-h-[28rem] lg:grid-cols-[20rem_1fr]">
          {/* ------------------------------------------------ 左：對話清單 */}
          <aside
            className={cn(
              'flex min-h-0 flex-col border-neutral-250 lg:border-r',
              mobileThread ? 'hidden lg:flex' : 'flex',
            )}
          >
            <div className="border-b border-neutral-250 p-3">
              <div className="input-group">
                <Input
                  className="form-control-sm"
                  placeholder={t.list.searchPlaceholder}
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
                <Button variant="outline" size="sm" aria-label={common.search}>
                  <Search size={13} />
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {listLoading ? (
                <div className="py-10 text-center text-muted">{t.list.loading}</div>
              ) : filtered.length === 0 ? (
                <EmptyState
                  icon={MessageSquareText}
                  title={t.list.emptyTitle}
                  description={t.list.emptyDescription}
                />
              ) : (
                filtered.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => openConversation(c)}
                    data-active={c.id === activeId}
                    className="flex w-full items-start gap-3 border-b border-neutral-250 px-3 py-3 text-left transition-colors hover:bg-neutral-100 data-[active=true]:bg-neutral-150"
                  >
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-pill bg-neutral-200 text-xs font-semibold text-neutral-600">
                      {(c.customerName || t.labels.customerFallback).slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-base font-semibold text-dark">
                          {c.customerName || t.labels.customerFallback}
                        </span>
                        <span className="flex-shrink-0 text-2xs text-secondary">{c.timeLabel}</span>
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-secondary">
                          {c.lastMessageType === 'IMAGE' ? t.labels.image : c.lastMessage}
                        </span>
                        <CountBadge count={c.unread} />
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </aside>

          {/* ------------------------------------------------ 右：訊息串 */}
          <section
            className={cn(
              'min-h-0 flex-col',
              mobileThread ? 'flex' : 'hidden lg:flex',
            )}
          >
            {!active ? (
              <div className="flex flex-1 items-center justify-center">
                <EmptyState icon={MessageSquareText} title={t.thread.selectHint} />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 border-b border-neutral-250 px-4 py-3">
                  <Button
                    variant="outline" size="sm" className="lg:hidden"
                    aria-label={t.thread.back} onClick={() => setMobileThread(false)}
                  >
                    <ArrowLeft size={13} />
                  </Button>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-semibold text-dark">
                      {active.customerName || t.labels.customerFallback}
                    </div>
                  </div>
                  <Link href={`/tenant/customers?keyword=${encodeURIComponent(active.customerName)}`}>
                    <Button variant="outline" size="sm">{t.thread.viewProfile}</Button>
                  </Link>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-50 px-4 py-4">
                  {threadLoading ? (
                    <div className="py-10 text-center text-muted">{t.thread.loading}</div>
                  ) : messages.length === 0 ? (
                    <div className="py-10 text-center text-muted">{t.thread.noMessages}</div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {messages.map((m) => (
                        <div
                          key={m.id}
                          className={cn(
                            'flex flex-col gap-0.5',
                            m.from === 'SHOP' ? 'items-end' : 'items-start',
                          )}
                        >
                          <div
                            className={cn(
                              'max-w-[75%] rounded-lg px-3 py-2 text-base',
                              m.from === 'SHOP'
                                ? 'bg-primary text-neutral-0'
                                : 'bg-neutral-0 text-dark shadow-sm',
                            )}
                          >
                            {m.type === 'IMAGE' ? (
                              m.imageUrl ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img
                                  src={m.imageUrl}
                                  alt={t.labels.image}
                                  className="max-h-48 rounded-sm"
                                />
                              ) : (
                                <span className="flex items-center gap-1">
                                  <ImageIcon size={14} />{t.labels.image}
                                </span>
                              )
                            ) : (
                              <span className="whitespace-pre-line break-words">{m.text}</span>
                            )}
                          </div>
                          <span className="text-2xs text-secondary">{formatTime(m.at)}</span>
                        </div>
                      ))}
                      <div ref={bottomRef} />
                    </div>
                  )}
                </div>

                <div className="border-t border-neutral-250 p-3">
                  <div className="flex items-end gap-2">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => { sendImage(e.target.files?.[0]); e.target.value = ''; }}
                    />
                    <Button
                      variant="outline" aria-label={t.composer.sendImage}
                      onClick={() => fileRef.current?.click()}
                    >
                      <ImageIcon size={15} />
                    </Button>
                    <Textarea
                      rows={1}
                      className="min-h-[2.4rem] resize-none"
                      placeholder={t.composer.placeholder}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void sendText();
                        }
                      }}
                    />
                    <Button
                      aria-label={t.composer.send}
                      loading={sending}
                      disabled={!draft.trim()}
                      onClick={() => void sendText()}
                    >
                      <Send size={15} />
                    </Button>
                  </div>
                  <p className="form-text">{t.composer.hint}</p>
                </div>
              </>
            )}
          </section>
        </div>
      </Card>
    </>
  );
}
