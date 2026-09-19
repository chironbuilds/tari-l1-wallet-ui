import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { Check, Copy, Loader2, X } from "lucide-react";
import { copyText } from "../lib/format";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "outline" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  size?: "md" | "lg" | "sm";
}

const buttonBase =
  "relative inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 disabled:opacity-40 disabled:pointer-events-none select-none";

const buttonSizes = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-[15px]",
};

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "btn-primary shadow-lg shadow-black/20",
  outline:
    "border border-[var(--tari-border)] bg-[var(--tari-bg-input)] text-[var(--tari-text)] hover:bg-[color-mix(in_srgb,var(--tari-text)_8%,transparent)]",
  ghost:
    "text-[var(--tari-text-dim)] hover:text-[var(--tari-text)] hover:bg-[color-mix(in_srgb,var(--tari-text)_6%,transparent)]",
  danger:
    "border border-red-500/30 bg-red-500/10 text-red-500 hover:bg-red-500/20 dark:text-[var(--st-red)]",
};

export function Button({
  variant = "primary",
  size = "md",
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(
        buttonBase,
        buttonSizes[size],
        buttonVariants[variant],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  );
}

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("un-card", className)}>{children}</div>;
}

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  mono?: boolean;
}

export function TextInput({ className, error, mono, ...rest }: TextInputProps) {
  return (
    <input
      className={cn(
        "w-full h-11 rounded-xl border bg-[var(--tari-bg-input)] px-4 text-sm text-[var(--tari-text)] placeholder-zinc-400 dark:placeholder-zinc-600 transition-colors focus:outline-none focus-visible:ring-2",
        mono && "font-mono text-[13px]",
        error
          ? "border-red-500/50 focus-visible:ring-red-500/40"
          : "border-[var(--tari-border)] hover:border-white/20 focus:border-violet-500/60 focus-visible:ring-violet-500/40",
        className,
      )}
      {...rest}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      {children}
      {hint && <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">{hint}</p>}
    </label>
  );
}

type Tone = "violet" | "green" | "red" | "amber" | "slate" | "cyan";

const toneClasses: Record<Tone, string> = {
  violet: "bg-[#9330ff]/15 text-[var(--st-violet)] border-[#9330ff]/35",
  green: "bg-[#06C983]/12 text-[var(--st-green)] border-[#06C983]/30",
  red: "bg-red-500/12 text-[var(--st-red)] border-red-500/25",
  amber: "bg-[#E2712D]/12 text-[var(--st-amber)] border-[#E2712D]/30",
  slate: "bg-white/[0.05] text-zinc-400 border-[var(--tari-border)]",
  cyan: "bg-cyan-400/10 text-[var(--st-cyan)] border-cyan-400/25",
};

export function Badge({
  tone = "slate",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: ReactNode }>;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-[var(--tari-border)] bg-[var(--tari-bg-input)] p-1",
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all",
            value === o.value
              ? "btn-primary shadow"
              : "text-[var(--tari-text-dim)] hover:text-[var(--tari-text)]",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A labeled two-state sliding toggle, for a strictly binary choice (unlike `Segmented`, which
 * suits 3+ options). A hidden checkbox drives it so it's keyboard/screen-reader accessible for
 * free — the visible track/thumb are `peer-checked` siblings, no extra state needed. */
export function Switch({
  checked,
  onChange,
  offLabel,
  onLabel,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  /** Shown to the left/right of the track respectively — e.g. "Transparent" / "Private". */
  offLabel: ReactNode;
  onLabel: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2.5 select-none", className)}>
      <span className={cn("text-xs font-semibold transition-colors", !checked ? "text-[var(--tari-text)]" : "text-[var(--tari-text-dim)]")}>
        {offLabel}
      </span>
      <span className="relative inline-block h-6 w-11 shrink-0">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span
          className={cn(
            "absolute inset-0 rounded-full border border-[var(--tari-border)] bg-[var(--tari-bg-input)] transition-colors",
            "peer-checked:border-transparent peer-checked:bg-gradient-to-r peer-checked:from-violet-600 peer-checked:to-fuchsia-600",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-violet-500/50",
          )}
        />
        <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
      </span>
      <span className={cn("text-xs font-semibold transition-colors", checked ? "text-[var(--tari-text)]" : "text-[var(--tari-text-dim)]")}>
        {onLabel}
      </span>
    </label>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose?: () => void;
  title?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open || !onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-pop"
        onClick={onClose}
      />
      <div
        className={cn(
          "un-card popup-shadow relative z-10 w-full animate-fade-up p-6 text-[var(--tari-text)]",
          wide ? "max-w-2xl" : "max-w-md",
        )}
      >
        {(title || onClose) && (
          <div className="mb-4 flex items-start justify-between gap-4">
            <h3 className="text-lg font-bold text-[var(--tari-text)]">{title}</h3>
            {onClose && (
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-white/5 hover:text-[var(--tari-text)]"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function CopyButton({
  text,
  label,
  className,
  onCopied,
}: {
  text: string;
  label?: string;
  className?: string;
  onCopied?: () => void;
}) {
  const [ok, setOk] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className={className}
      onClick={async () => {
        const success = await copyText(text);
        if (success) {
          setOk(true);
          onCopied?.();
          setTimeout(() => setOk(false), 1400);
        }
      }}
    >
      {ok ? <Check size={14} className="text-[var(--st-green)]" /> : <Copy size={14} />}
      {label ?? (ok ? "Copied" : "Copy")}
    </Button>
  );
}

export function EmptyState({
  icon,
  title,
  sub,
}: {
  icon: ReactNode;
  title: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      <div
        className="mb-1 grid size-12 place-items-center rounded-2xl border text-[var(--tari-text-dim)]"
        style={{ borderColor: "var(--tari-border)", background: "var(--tari-bg-input)" }}
      >
        {icon}
      </div>
      <p className="font-semibold text-[var(--tari-text)]">{title}</p>
      {sub && <p className="max-w-xs text-sm text-[var(--tari-text-dim)]">{sub}</p>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("animate-spin", className)} size={18} />;
}

export function Logo({ size = 64 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size * (39 / 38)}
      viewBox="0 0 38 39"
      fill="none"
      aria-hidden
      style={{ color: "currentColor" }}
    >
      <path
        d="M0.660156 10.1668V20.7488L15.9595 38.0391L37.6602 20.8095V10.1557L16.0376 0.0390625L0.660156 10.1668ZM14.1225 30.3412L4.36688 19.3049V13.3084L14.1225 15.8486V30.3412ZM17.8365 31.787V16.8217L32.0219 20.5115L17.8365 31.787ZM33.9571 12.5561V17.1436L7.37041 10.2219L16.3356 4.32485L33.9571 12.5561Z"
        fill="currentColor"
      />
    </svg>
  );
}
