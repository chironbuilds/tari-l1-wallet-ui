import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Plus, Tag } from "lucide-react";
import { useStore } from "../store";
import { truncMiddle } from "../lib/format";
import { Logo } from "./ui";

/**
 * The account switcher on the wallet card, in the shape people already know from MetaMask: the
 * name is the button, and it drops down a list of everything you can be paid on.
 *
 * The important difference from MetaMask is worth being explicit about in the UI: these are not
 * separate accounts. Every sub-address shares this wallet's keys, so switching changes only which
 * address is presented for receiving — never the balance, the history, or what can be spent.
 */
export function AddressSwitcher({ onAddNew }: { onAddNew: () => void }) {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // A dropdown that only closes via its own items feels broken; close on an outside click and on
  // Escape, the two things every menu is expected to honour.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = store.subAddresses.find((s) => s.label === store.activeSubAddress) ?? null;
  const mainAddress = store.addressInfo?.base58 ?? "";

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg px-1 py-0.5 -mx-1 text-left transition-colors hover:bg-white/10"
      >
        <span
          className="grid size-6 shrink-0 place-items-center rounded-full"
          style={{ background: "rgba(255,255,255,.14)" }}
        >
          {active ? <Tag size={12} /> : <Logo size={13} />}
        </span>
        <span className="truncate text-sm font-bold">{active ? active.label : "Tari L1 Wallet"}</span>
        <ChevronDown
          size={13}
          className={open ? "shrink-0 rotate-180 opacity-80 transition-transform" : "shrink-0 opacity-80 transition-transform"}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full left-0 z-40 mt-1.5 w-[248px] overflow-hidden rounded-2xl border shadow-xl"
          style={{
            background: "var(--tari-bg-deep)",
            borderColor: "var(--tari-border)",
            boxShadow: "var(--tari-shadow)",
          }}
        >
          <div className="max-h-[240px] overflow-y-auto py-1">
            <Row
              icon={<Logo size={13} />}
              title="Tari L1 Wallet"
              subtitle={truncMiddle(mainAddress, 10, 8)}
              selected={store.activeSubAddress === null}
              onClick={() => {
                store.setActiveSubAddress(null);
                setOpen(false);
              }}
            />
            {store.subAddresses.map((sub) => (
              <Row
                key={sub.label}
                icon={<Tag size={12} />}
                title={sub.label}
                subtitle={truncMiddle(sub.base58, 10, 8)}
                selected={store.activeSubAddress === sub.label}
                onClick={() => {
                  store.setActiveSubAddress(sub.label);
                  setOpen(false);
                }}
              />
            ))}
          </div>

          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onAddNew();
            }}
            className="flex w-full items-center gap-2 border-t px-3 py-2.5 text-left text-xs font-bold text-[var(--tari-text)] transition-colors hover:bg-[color-mix(in_srgb,var(--tari-text)_8%,transparent)]"
            style={{ borderColor: "var(--tari-border)" }}
          >
            <Plus size={14} /> Add sub-address
          </button>

          <p className="border-t px-3 py-2 text-[10px] leading-relaxed text-zinc-500" style={{ borderColor: "var(--tari-border)" }}>
            All one wallet — switching changes only the address you hand out.
          </p>
        </div>
      )}
    </div>
  );
}

function Row({
  icon,
  title,
  subtitle,
  selected,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--tari-text)_8%,transparent)]"
    >
      <span
        className="grid size-7 shrink-0 place-items-center rounded-full border text-[var(--tari-text)]"
        style={{ borderColor: "var(--tari-border)", background: "var(--tari-bg-input)" }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-bold text-[var(--tari-text)]">{title}</span>
        <span className="block truncate font-mono text-[10px] text-zinc-500">{subtitle}</span>
      </span>
      {selected && <Check size={14} className="shrink-0 text-[var(--st-green)]" />}
    </button>
  );
}
