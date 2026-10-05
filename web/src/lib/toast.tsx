import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, TriangleAlert, X, XCircle } from 'lucide-react';
import { useI18n } from '../i18n';

type Kind = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: number;
  kind: Kind;
  message: string;
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  show: (kind: Kind, message: string, options?: { action?: ToastItem['action']; duration?: number }) => void;
  success: (message: string) => void;
  error: (message: unknown) => void;
  info: (message: string, options?: { action?: ToastItem['action']; duration?: number }) => void;
  warning: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ICONS = { success: CheckCircle2, error: XCircle, info: Info, warning: TriangleAlert };

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return fallback;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const remove = useCallback((id: number) => setItems((list) => list.filter((i) => i.id !== id)), []);

  const show = useCallback<ToastApi['show']>(
    (kind, message, options) => {
      const id = ++counter.current;
      setItems((list) => [...list.slice(-4), { id, kind, message, action: options?.action }]);
      window.setTimeout(() => remove(id), options?.duration ?? (kind === 'error' ? 7000 : 4000));
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (m) => show('success', m),
      error: (e) => show('error', errorMessage(e, t('common.errorGeneric'))),
      info: (m, o) => show('info', m, o),
      warning: (m) => show('warning', m),
    }),
    [show, t],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((item) => {
          const Icon = ICONS[item.kind];
          return (
            <div key={item.id} className={`toast toast-${item.kind}`}>
              <Icon size={18} className="toast-icon" />
              <span className="toast-message">{item.message}</span>
              {item.action && (
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    item.action!.onClick();
                    remove(item.id);
                  }}
                >
                  {item.action.label}
                </button>
              )}
              <button className="toast-close" onClick={() => remove(item.id)} aria-label={t('common.close')}>
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('ToastProvider fehlt');
  return ctx;
}
