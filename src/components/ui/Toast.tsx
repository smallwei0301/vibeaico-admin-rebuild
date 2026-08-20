'use client';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type Tone = 'success' | 'danger' | 'warning' | 'info';
type ToastItem = { id: number; tone: Tone; message: string };

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
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setItems((s) => [...s, { id, tone, message }]);
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
