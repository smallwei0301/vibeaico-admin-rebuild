'use client';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FEATURE_LOCKED_MESSAGE } from '@/lib/feature-gate';

type Tone = 'success' | 'danger' | 'warning' | 'info';
type ToastItem = { id: number; tone: Tone; message: string };

/** 未訂閱提示的節流記錄鍵（值是 YYYY-MM-DD，同一天內只提示一次） */
const FEATURE_LOCKED_SEEN_KEY = 'vibeai.toast.featureLocked.date';

/** 同時最多顯示幾則（超過就不再堆疊，避免整片洗版） */
const MAX_VISIBLE = 3;

/**
 * 錯誤訊息的「根因」= 冒號後面那段。
 *
 * 頁面統一用 `${用途前綴}${error.message}` 組錯誤訊息（例如
 * 「載入統計資料失敗：此帳號未加入任何店家」）。一個頁面同時打好幾支 API，
 * 遇到 session／網路這種全域性失敗時每支都會失敗，於是同一個根因被不同前綴
 * 包成六七則 toast 洗版——但對使用者來說那全是同一件事。以根因去重，
 * 只留第一則。
 */
function errorCause(message: string): string {
  const parts = message.split(/[:：]/);
  return (parts.length > 1 ? parts[parts.length - 1] : message).trim();
}

/**
 * 未訂閱提示（FEAT_001）每天最多跳一次。
 *
 * 一個頁面常同時打好幾支受閘門保護的端點，未訂閱時每支都會 403、各自 toast，
 * 畫面會被同一句話連續洗版。這裡用「當天是否已提示過」節流；localStorage
 * 存取在無痕視窗／封鎖 site data 的瀏覽器會丟例外，包 try/catch 後一律放行
 * （寧可多提示一次，也不要因為存取失敗把提示整個吃掉）。
 */
function shouldThrottleFeatureLocked(message: string): boolean {
  if (!message.includes(FEATURE_LOCKED_MESSAGE)) return false;
  const today = new Date().toISOString().slice(0, 10);
  try {
    if (localStorage.getItem(FEATURE_LOCKED_SEEN_KEY) === today) return true;
    localStorage.setItem(FEATURE_LOCKED_SEEN_KEY, today);
  } catch {
    return false;
  }
  return false;
}

const ToastContext = React.createContext<{
  show: (message: string, tone?: Tone) => void;
} | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast 必須在 <ToastProvider> 內使用');
  return ctx;
}

const ICONS = { success: CheckCircle2, danger: XCircle, warning: AlertTriangle, info: Info };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const show = React.useCallback((message: string, tone: Tone = 'success') => {
    if (shouldThrottleFeatureLocked(message)) return;
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setItems((s) => {
      if (s.some((t) => t.message === message)) return s;            // 一模一樣的不重複
      if (tone === 'danger' || tone === 'warning') {
        // 同一個根因（冒號後那段）已經在畫面上就不再疊，且錯誤總數設上限
        const cause = errorCause(message);
        if (s.some((t) => (t.tone === 'danger' || t.tone === 'warning')
          && errorCause(t.message) === cause)) return s;
        if (s.length >= MAX_VISIBLE) return s;
      }
      return [...s, { id, tone, message }];
    });
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {mounted &&
        createPortal(
          <div className="fixed bottom-5 right-5 z-toast flex flex-col gap-2">
            {items.map((t) => {
              const Icon = ICONS[t.tone];
              return (
                <div
                  key={t.id}
                  role="status"
                  className={cn(
                    'flex min-w-[16rem] max-w-sm items-start gap-2 rounded-lg px-4 py-3 text-base shadow-lg animate-fade-in',
                    t.tone === 'success' && 'bg-[var(--badge-success-bg)] text-[var(--badge-success-fg)]',
                    t.tone === 'danger' && 'bg-[var(--badge-danger-bg)] text-[var(--badge-danger-fg)]',
                    t.tone === 'warning' && 'bg-[var(--badge-warning-bg)] text-[var(--badge-warning-fg)]',
                    t.tone === 'info' && 'bg-[var(--badge-info-bg)] text-[var(--badge-info-fg)]',
                  )}
                >
                  <Icon size={18} className="mt-0.5 flex-shrink-0" />
                  <span className="flex-1">{t.message}</span>
                  <button onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))}>
                    <X size={14} />
                  </button>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}
