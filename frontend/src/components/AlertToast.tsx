import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  X,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type ToastVariant = "success" | "error" | "warning" | "info";

export type ToastItem = {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  duration?: number; // ms — default 4000
};

type ToastContextValue = {
  toast: (opts: Omit<ToastItem, "id">) => string;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  warning: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
};

/* -------------------------------------------------------------------------- */
/* Context                                                                    */
/* -------------------------------------------------------------------------- */

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return ctx;
}

/* -------------------------------------------------------------------------- */
/* Variant styles                                                             */
/* -------------------------------------------------------------------------- */

const VARIANT_STYLES: Record<
  ToastVariant,
  {
    icon: typeof CheckCircle2;
    accent: string;
    glow: string;
    bar: string;
  }
> = {
  success: {
    icon: CheckCircle2,
    accent: "text-zp-safe",
    glow: "shadow-[0_0_20px_-4px_rgba(16,185,129,0.35)]",
    bar: "bg-zp-safe",
  },
  error: {
    icon: XCircle,
    accent: "text-zp-rose",
    glow: "shadow-[0_0_20px_-4px_rgba(244,63,94,0.35)]",
    bar: "bg-zp-rose",
  },
  warning: {
    icon: AlertTriangle,
    accent: "text-zp-amber",
    glow: "shadow-[0_0_20px_-4px_rgba(245,158,11,0.35)]",
    bar: "bg-zp-amber",
  },
  info: {
    icon: Info,
    accent: "text-zp-cyan",
    glow: "shadow-[0_0_20px_-4px_rgba(56,189,248,0.35)]",
    bar: "bg-zp-cyan",
  },
};

/* -------------------------------------------------------------------------- */
/* Single Toast                                                               */
/* -------------------------------------------------------------------------- */

function ToastCard({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const [exiting, setExiting] = useState(false);
  const [progress, setProgress] = useState(100);
  const duration = item.duration ?? 4000;
  const style = VARIANT_STYLES[item.variant];
  const Icon = style.icon;

  useEffect(() => {
    if (duration <= 0) return;

    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const left = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(left);
      if (left <= 0) {
        setExiting(true);
        setTimeout(() => onDismiss(item.id), 220);
      }
    };

    const id = window.setInterval(tick, 30);
    return () => window.clearInterval(id);
  }, [duration, item.id, onDismiss]);

  const handleClose = () => {
    setExiting(true);
    setTimeout(() => onDismiss(item.id), 220);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        "relative w-full max-w-sm overflow-hidden rounded-zp-lg",
        "zp-glass-strong border border-white/10",
        style.glow,
        "transition-all duration-200 ease-out",
        exiting
          ? "translate-x-4 opacity-0 scale-95"
          : "translate-x-0 opacity-100 scale-100",
      ].join(" ")}
    >
      {/* progress bar */}
      {duration > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/5">
          <div
            className={`h-full ${style.bar} transition-[width] duration-75 ease-linear`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      <div className="flex items-start gap-3 p-3.5 pe-2">
        <div
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 ${style.accent}`}
        >
          <Icon className="h-4.5 w-4.5" strokeWidth={2.2} />
        </div>

        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-sm font-semibold text-zp-text-primary leading-snug">
            {item.title}
          </p>
          {item.description ? (
            <p className="mt-0.5 text-xs text-zp-text-secondary leading-relaxed">
              {item.description}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={handleClose}
          aria-label="إغلاق"
          className="mt-0.5 rounded-md p-1 text-zp-text-secondary hover:bg-white/8 hover:text-zp-text-primary"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Viewport                                                                   */
/* -------------------------------------------------------------------------- */

function ToastViewport({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-9999 flex flex-col items-end gap-2 p-4 sm:p-6"
      style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}
    >
      {items.map((item) => (
        <div key={item.id} className="pointer-events-auto w-full max-w-sm">
          <ToastCard item={item} onDismiss={onDismiss} />
        </div>
      ))}
    </div>,
    document.body
  );
}

/* -------------------------------------------------------------------------- */
/* Provider                                                                   */
/* -------------------------------------------------------------------------- */

let toastIdCounter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setItems([]);
  }, []);

  const toast = useCallback((opts: Omit<ToastItem, "id">) => {
    const id = `zp-toast-${++toastIdCounter}-${Date.now()}`;
    setItems((prev) => {
      // max 5 toasts
      const next = [...prev, { ...opts, id }];
      return next.slice(-5);
    });
    return id;
  }, []);

  const success = useCallback(
    (title: string, description?: string) =>
      toast({ title, description, variant: "success" }),
    [toast]
  );

  const error = useCallback(
    (title: string, description?: string) =>
      toast({ title, description, variant: "error" }),
    [toast]
  );

  const warning = useCallback(
    (title: string, description?: string) =>
      toast({ title, description, variant: "warning" }),
    [toast]
  );

  const info = useCallback(
    (title: string, description?: string) =>
      toast({ title, description, variant: "info" }),
    [toast]
  );

  const value = useMemo(
    () => ({ toast, success, error, warning, info, dismiss, dismissAll }),
    [toast, success, error, warning, info, dismiss, dismissAll]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}