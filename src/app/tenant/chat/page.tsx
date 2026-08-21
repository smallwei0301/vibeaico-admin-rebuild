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
import { byMode } from '@/mock';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { chatPage as t } from '@/i18n/zh-TW/pages/chat';
import { cn, formatTime } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/* 本頁專用假資料（不寫進 src/mock，避免與其他頁面衝突）                          */
/* -------------------------------------------------------------------------- */

type Conversation = {
  id: string;
  customerId: string;
  customerName: string;
  /** 清單預覽用；type = IMAGE 時顯示「圖片」 */
  lastMessageType: 'TEXT' | 'IMAGE';
  lastMessage: string;
  lastMessageAt: string;
  unread: number;
};

type ChatMessage = {
  id: string;
  from: 'CUSTOMER' | 'SHOP';
  type: 'TEXT' | 'IMAGE';
  text: string;
  imageUrl: string;
  at: string;
};

/** 以固定基準時間產生假資料，避免 render 期出現 Date.now() */
const BASE = new Date('2026-08-20T15:00:00+08:00').getTime();
const ago = (minutes: number) => new Date(BASE - minutes * 60_000).toISOString();

const CONV_LOCAL_SHOP: Conversation[] = [
  {
    id: 'chat_1', customerId: 'c_1', customerName: '王小明',
    lastMessageType: 'TEXT', lastMessage: '請問這週六下午還有位子嗎？',
    lastMessageAt: ago(3), unread: 2,
  },
  {
    id: 'chat_2', customerId: 'c_4', customerName: '陳雅婷',
    lastMessageType: 'IMAGE', lastMessage: '',
    lastMessageAt: ago(95), unread: 1,
  },
  {
    id: 'chat_3', customerId: 'c_2', customerName: '李美華',
    lastMessageType: 'TEXT', lastMessage: '好的，謝謝！',
    lastMessageAt: ago(60 * 26), unread: 0,
  },
];

const MSG_LOCAL_SHOP: Record<string, ChatMessage[]> = {
  chat_1: [
    { id: 'm_1', from: 'CUSTOMER', type: 'TEXT', text: '你好，我想預約剪髮', imageUrl: '', at: ago(20) },
    { id: 'm_2', from: 'SHOP', type: 'TEXT', text: '您好！請問希望哪一天呢？', imageUrl: '', at: ago(18) },
    { id: 'm_3', from: 'CUSTOMER', type: 'TEXT', text: '這週六可以嗎', imageUrl: '', at: ago(5) },
    { id: 'm_4', from: 'CUSTOMER', type: 'TEXT', text: '請問這週六下午還有位子嗎？', imageUrl: '', at: ago(3) },
  ],
  chat_2: [
    { id: 'm_5', from: 'CUSTOMER', type: 'TEXT', text: '想染成這個顏色', imageUrl: '', at: ago(100) },
    { id: 'm_6', from: 'CUSTOMER', type: 'IMAGE', text: '', imageUrl: '', at: ago(95) },
  ],
  chat_3: [
    { id: 'm_7', from: 'SHOP', type: 'TEXT', text: '您的預約已確認，週日 15:00 見！', imageUrl: '', at: ago(60 * 27) },
    { id: 'm_8', from: 'CUSTOMER', type: 'TEXT', text: '好的，謝謝！', imageUrl: '', at: ago(60 * 26) },
  ],
};

const CONV_GUIDE: Conversation[] = [
  {
    id: 'chat_1', customerId: 'c_1', customerName: '陳彥廷',
    lastMessageType: 'TEXT', lastMessage: '這週六賞鯨還有位子嗎？兩大一小',
    lastMessageAt: ago(4), unread: 2,
  },
  {
    id: 'chat_2', customerId: 'c_4', customerName: '黃思穎',
    lastMessageType: 'TEXT', lastMessage: '溯溪需要自備什麼嗎？',
    lastMessageAt: ago(88), unread: 1,
  },
  {
    id: 'chat_3', customerId: 'c_5', customerName: '張家豪',
    lastMessageType: 'TEXT', lastMessage: '好的，那就麻煩你了！',
    lastMessageAt: ago(60 * 20), unread: 0,
  },
];

const MSG_GUIDE: Record<string, ChatMessage[]> = {
  chat_1: [
    { id: 'm_1', from: 'CUSTOMER', type: 'TEXT', text: '你好，想問龜山島賞鯨', imageUrl: '', at: ago(25) },
    { id: 'm_2', from: 'SHOP', type: 'TEXT', text: '您好！標準團每天 09:00 出發，全程約 3 小時 🐬', imageUrl: '', at: ago(22) },
    { id: 'm_3', from: 'CUSTOMER', type: 'TEXT', text: '小孩 6 歲可以參加嗎', imageUrl: '', at: ago(8) },
    { id: 'm_4', from: 'CUSTOMER', type: 'TEXT', text: '這週六賞鯨還有位子嗎？兩大一小', imageUrl: '', at: ago(4) },
  ],
  chat_2: [
    { id: 'm_5', from: 'SHOP', type: 'TEXT', text: '您的溯溪行程已確認，8/24 08:00 花蓮火車站前集合 🏞', imageUrl: '', at: ago(120) },
    { id: 'm_6', from: 'CUSTOMER', type: 'TEXT', text: '溯溪需要自備什麼嗎？', imageUrl: '', at: ago(88) },
  ],
  chat_3: [
    { id: 'm_7', from: 'CUSTOMER', type: 'TEXT', text: '公司 12 人想包船，8/22 可以嗎', imageUrl: '', at: ago(60 * 24) },
    { id: 'm_8', from: 'SHOP', type: 'TEXT', text: '可以！包船專案 18,000 元，先收 5,000 定金即可保留船班', imageUrl: '', at: ago(60 * 22) },
    { id: 'm_9', from: 'CUSTOMER', type: 'TEXT', text: '好的，那就麻煩你了！', imageUrl: '', at: ago(60 * 20) },
  ],
};

const CONV_CLINIC: Conversation[] = [
  {
    id: 'chat_1', customerId: 'c_2', customerName: '周佩琪',
    lastMessageType: 'TEXT', lastMessage: '今天下午還有初診的號嗎？',
    lastMessageAt: ago(6), unread: 2,
  },
  {
    id: 'chat_2', customerId: 'c_1', customerName: '劉建國',
    lastMessageType: 'TEXT', lastMessage: '收到，謝謝提醒',
    lastMessageAt: ago(60 * 5), unread: 0,
  },
  {
    id: 'chat_3', customerId: 'c_4', customerName: '蔡淑芬',
    lastMessageType: 'TEXT', lastMessage: '健檢報告可以線上看嗎？',
    lastMessageAt: ago(60 * 30), unread: 1,
  },
];

const MSG_CLINIC: Record<string, ChatMessage[]> = {
  chat_1: [
    { id: 'm_1', from: 'CUSTOMER', type: 'TEXT', text: '你好，喉嚨痛三天了', imageUrl: '', at: ago(15) },
    { id: 'm_2', from: 'SHOP', type: 'TEXT', text: '您好，建議先掛一般門診由醫師評估，線上可預約看診號碼。', imageUrl: '', at: ago(12) },
    { id: 'm_3', from: 'CUSTOMER', type: 'TEXT', text: '今天下午還有初診的號嗎？', imageUrl: '', at: ago(6) },
  ],
  chat_2: [
    { id: 'm_4', from: 'SHOP', type: 'TEXT', text: '提醒您：慢性處方箋將於下週到期，記得回診由醫師評估用藥。', imageUrl: '', at: ago(60 * 6) },
    { id: 'm_5', from: 'CUSTOMER', type: 'TEXT', text: '收到，謝謝提醒', imageUrl: '', at: ago(60 * 5) },
  ],
  chat_3: [
    { id: 'm_6', from: 'CUSTOMER', type: 'TEXT', text: '健檢報告可以線上看嗎？', imageUrl: '', at: ago(60 * 30) },
  ],
};

/* -------------------------------------------------------------------------- */

/** 相對時間標籤；只在載入／送出等事件中計算，不在 render 期呼叫 */
function relativeTime(iso: string, now: number): string {
  const diffMinutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (diffMinutes < 1) return t.labels.justNow;
  if (diffMinutes < 60) return t.labels.minutesAgo(diffMinutes);
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return t.labels.hoursAgo(hours);
  return t.labels.daysAgo(Math.floor(hours / 24));
}

type ConversationRow = Conversation & { timeLabel: string };

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

  /* ------------------------------------------------------------ 對話清單 */
  React.useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    const timer = setTimeout(() => {
      if (cancelled) return;
      const now = Date.now();
      setConversations(
        byMode({ LOCAL_SHOP: CONV_LOCAL_SHOP, GUIDE: CONV_GUIDE, CLINIC: CONV_CLINIC }).map((c) => ({ ...c, timeLabel: relativeTime(c.lastMessageAt, now) })),
      );
      setListLoading(false);
    }, 320);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  /* ------------------------------------------------------------ 訊息串 */
  const openConversation = (c: ConversationRow) => {
    if (!c.customerId) {
      toast.show(t.messages.notBound, 'warning');
      return;
    }
    setActiveId(c.id);
    setMobileThread(true);
    setThreadLoading(true);
    setDraft('');
    /* 讀取後清掉未讀數（原站 /api/chat/messages/{id}/read）*/
    setConversations((list) => list.map((x) => (x.id === c.id ? { ...x, unread: 0 } : x)));
    setTimeout(() => {
      setMessages(byMode({ LOCAL_SHOP: MSG_LOCAL_SHOP, GUIDE: MSG_GUIDE, CLINIC: MSG_CLINIC })[c.id] ?? []);
      setThreadLoading(false);
    }, 260);
  };

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  const filtered = keyword.trim()
    ? conversations.filter((c) => c.customerName.includes(keyword.trim()))
    : conversations;

  const appendOwnMessage = (message: Omit<ChatMessage, 'id'>) => {
    const id = `m_local_${nextId.current++}`;
    setMessages((list) => [...list, { ...message, id }]);
  };

  const sendText = async () => {
    const text = draft.trim();
    if (!text || !activeId) return;
    setSending(true);
    try {
      await new Promise((r) => setTimeout(r, 260));
      appendOwnMessage({
        from: 'SHOP', type: 'TEXT', text, imageUrl: '', at: new Date().toISOString(),
      });
      setDraft('');
      setConversations((list) => list.map((c) => (c.id === activeId
        ? { ...c, lastMessageType: 'TEXT', lastMessage: text, timeLabel: t.labels.justNow }
        : c)));
    } catch {
      toast.show(t.messages.sendFailed, 'danger');
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
        imageUrl: URL.createObjectURL(file), at: new Date().toISOString(),
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
