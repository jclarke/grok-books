import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { cx } from "../lib/cx";

export type ToastTone = "success" | "error" | "info";

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Milliseconds; undo toasts default to 8s, others to 4.5s. */
  duration?: number;
  action?: { label: string; onClick: () => void | Promise<void> };
}

interface ToastItem extends ToastOptions {
  id: number;
}

interface ToastApi {
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast needs ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((item) => item.id !== id)), []);
  const toast = useCallback((options: ToastOptions) => {
    const id = nextId.current++;
    setItems((list) => [...list.slice(-3), { ...options, id }]);
    return id;
  }, []);
  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toaster" role="region" aria-label="Notifications">
        {items.map((item) => (
          <ToastView key={item.id} item={item} onClose={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const duration = item.duration ?? (item.action ? 8000 : 4500);
  useEffect(() => {
    if (busy) return undefined;
    const id = window.setTimeout(onClose, duration);
    return () => window.clearTimeout(id);
  }, [duration, onClose, busy]);
  const tone = item.tone ?? "info";
  return (
    <div className={cx("toast", `toast--${tone}`)} role={tone === "error" ? "alert" : "status"} aria-live={tone === "error" ? "assertive" : "polite"}>
      <span className="toast__icon">
        <Icon name={tone === "success" ? "check" : tone === "error" ? "alert" : "info"} size={16} />
      </span>
      <div className="toast__text">
        <p className="toast__title">{item.title}</p>
        {item.description ? <p className="toast__desc">{item.description}</p> : null}
      </div>
      {item.action ? (
        <button
          type="button"
          className="toast__action"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await item.action?.onClick();
            } finally {
              onClose();
            }
          }}
        >
          {item.action.label}
        </button>
      ) : null}
      <button type="button" className="toast__close" aria-label="Dismiss" onClick={onClose}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
