import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "./ui";

type ToastTone = "success" | "error" | "info";

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
}

const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

// Alpha-blended so the same value reads on both themes; at /30 the tint vanished against the
// light theme's white panel.
const toneStyles: Record<ToastTone, string> = {
  success: "border-emerald-500/50",
  error: "border-red-500/50",
  info: "border-violet-500/50",
};

const toneIcons: Record<ToastTone, ReactNode> = {
  success: <CheckCircle2 size={18} className="shrink-0 text-emerald-500" />,
  error: <AlertTriangle size={18} className="shrink-0 text-red-500" />,
  info: <Info size={18} className="shrink-0 text-violet-500" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev.slice(-4), { ...t, id }]);
      setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[100] flex w-[min(92vw,380px)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            // The background is set here rather than by reusing `.un-card`: that rule is
            // unlayered CSS, so it outranks every Tailwind utility whatever the class order, and
            // its `border: 1px solid var(--tari-border)` would swallow the per-tone border colour
            // below. The class this originally asked for — `card` — does not exist at all, which
            // left the toast fully transparent; invisible on the light theme, where a white title
            // sat on a white page.
            style={{ boxShadow: "var(--tari-shadow)" }}
            className={cn(
              "pointer-events-auto flex animate-slide-in items-start gap-3 rounded-[20px] border p-3.5",
              "bg-[var(--tari-bg-panel)] backdrop-blur-[18px]",
              toneStyles[t.tone],
            )}
          >
            <div className="mt-0.5">{toneIcons[t.tone]}</div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--tari-text)]">{t.title}</p>
              {t.message && (
                <p className="mt-0.5 text-xs leading-relaxed break-words text-[var(--tari-text-dim)]">
                  {t.message}
                </p>
              )}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="rounded-md p-1 text-[var(--tari-text-dim)] transition-colors hover:text-[var(--tari-text)]"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
