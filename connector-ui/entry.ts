// tari-connect.js -- a drop-in "Connect wallet" picker for Tari dApps.
//
//   <script>window.TARI_WALLETCONNECT = { projectId: "…", network: "mainnet" };</script>   (optional)
//   <script src="https://universe.tari.mw/tari-connector.js"></script>
//   <script src="https://universe.tari.mw/tari-connect.js"></script>
//
//   const { wallet, provider, accounts } = await TariConnect.open();
//   await provider.request({ method: "tari_getBalances" });
//
// or the ready-made button, which shows the connected address afterwards:
//
//   <tari-connect-button></tari-connect-button>
//   button.addEventListener("tari-connect", (e) => e.detail.provider …)
//
// It lists the Tari wallets a user can use from this page -- the Sapient browser extension (or a
// link to install it), Sapient for Android over WalletConnect (when the dApp opted in), and Tari
// Universe (used directly, no picker, when the page runs inside it) -- and returns the chosen
// wallet's provider. Every provider speaks the same window.tari API, so nothing downstream changes.
// UI lives in a Shadow DOM: a dApp's CSS can't break it and it can't leak styles into the dApp.

type Provider = {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  on?(event: string, fn: (data: unknown) => void): unknown;
  transport?: string | null;
  isTariWallet?: boolean;
};

type WalletId = "sapient-extension" | "sapient-mobile" | "tari-universe";

interface WalletOption {
  id: WalletId;
  name: string;
  detail: string;
  badge: string;
  provider: Provider | null;
  installUrl?: string;
}

export interface ConnectResult {
  wallet: WalletId;
  provider: Provider;
  accounts: string[];
}

const EXTENSION_STORE_URL = "https://chromewebstore.google.com/detail/tari-ootle-wallet/demkeckolenopkgnfbnpflkpbbdhpgkl";
const LAST_KEY = "tari-connect:last-wallet";

const SCRIPT_BASE = (() => {
  try {
    return new URL(".", (document.currentScript as HTMLScriptElement | null)?.src || location.href).href;
  } catch {
    return "https://universe.tari.mw/";
  }
})();

const isPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

function sapientIcon(badge: "ext" | "phone"): string {
  const corner =
    badge === "phone"
      ? '<rect x="84" y="78" width="34" height="44" rx="7" fill="#17111f" stroke="#fff" stroke-width="5"/><rect x="96" y="112" width="10" height="3" rx="1.5" fill="#fff"/>'
      : '<rect x="82" y="84" width="38" height="34" rx="7" fill="#17111f" stroke="#fff" stroke-width="5"/><path d="M90 96h22M90 106h14" stroke="#fff" stroke-width="5" stroke-linecap="round"/>';
  return `<svg viewBox="0 0 128 128" width="40" height="40" aria-hidden="true">
    <defs><linearGradient id="g${badge}" x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fc72ff"/><stop offset="1" stop-color="#a259ff"/></linearGradient></defs>
    <rect width="128" height="128" rx="28" fill="url(#g${badge})"/>
    <path d="M18 60 Q58 30 98 60 Q58 90 18 60 Z" fill="#180a20"/><circle cx="58" cy="60" r="14" fill="url(#g${badge})"/><circle cx="58" cy="60" r="5.5" fill="#180a20"/>
    ${corner}</svg>`;
}

const UNIVERSE_ICON = `<img src="${SCRIPT_BASE}tari-favicon.svg" width="40" height="40" alt="" style="border-radius:10px;background:#000">`;

/** The Tari wallets reachable from this page, in display order. */
export function discover(): WalletOption[] {
  const w = window as unknown as { tari?: Provider; tariUniverse?: Provider };
  const universe = w.tariUniverse ?? null; // tari-connector.js's own object, always present when loaded
  const injected = w.tari && w.tari !== universe ? w.tari : null; // an extension's provider
  const options: WalletOption[] = [];

  if (universe?.transport === "embedded") {
    options.push({ id: "tari-universe", name: "Tari Universe", detail: "The wallet this app is running in", badge: "Connected app", provider: universe });
    return options;
  }

  const extension: WalletOption = injected
    ? { id: "sapient-extension", name: "Sapient extension", detail: "Browser extension", badge: "Detected", provider: injected }
    : {
        id: "sapient-extension",
        name: "Sapient extension",
        detail: isPhone() ? "Desktop Chrome, Brave or Edge" : "Add to Chrome, Brave or Edge",
        badge: "Install",
        provider: null,
        installUrl: EXTENSION_STORE_URL,
      };
  const mobile: WalletOption | null =
    universe?.transport === "walletconnect"
      ? {
          id: "sapient-mobile",
          name: "Sapient for Android",
          detail: isPhone() ? "Opens the Sapient app" : "Scan a QR code with your phone",
          badge: "WalletConnect",
          provider: universe,
        }
      : null;

  // On a phone the app comes first; on desktop an installed extension does.
  if (isPhone()) {
    if (mobile) options.push(mobile);
    options.push(extension);
  } else {
    options.push(extension);
    if (mobile) options.push(mobile);
  }
  return options;
}

function lastUsed(): WalletId | null {
  try {
    return localStorage.getItem(LAST_KEY) as WalletId | null;
  } catch {
    return null;
  }
}

function remember(id: WalletId): void {
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    /* private mode: just not remembered */
  }
}

async function connectWith(option: WalletOption): Promise<ConnectResult> {
  const provider = option.provider!;
  const accounts = (await provider.request({ method: "tari_requestAccounts" })) as string[];
  remember(option.id);
  current = { wallet: option.id, provider, accounts };
  return current;
}

let current: ConnectResult | null = null;

// ---------------- picker UI ----------------
const CSS = `
:host { all: initial; }
.backdrop { position: fixed; inset: 0; z-index: 2147483646; background: rgba(8, 4, 12, 0.6);
  display: flex; align-items: center; justify-content: center; padding: 16px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; animation: fade .15s ease-out; }
.card { width: 100%; max-width: 380px; background: var(--bg); color: var(--fg); border: 1px solid var(--line);
  border-radius: 22px; padding: 20px; box-shadow: 0 30px 80px rgba(0,0,0,.45); animation: rise .2s cubic-bezier(.2,.8,.2,1); }
:host([data-theme="dark"]) { --bg: #17111f; --fg: #f2f2f6; --muted: #9997a3; --line: #2c2338; --row: #1f1729; --rowh: #2a2036; }
:host([data-theme="light"]) { --bg: #ffffff; --fg: #17111f; --muted: #6b6676; --line: #e7e2ef; --row: #f7f4fb; --rowh: #efe8f8; }
header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
h2 { margin: 0; font-size: 18px; }
.x { all: unset; cursor: pointer; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; color: var(--muted); font-size: 20px; }
.x:hover { background: var(--row); }
.sub { margin: 0 0 14px; color: var(--muted); font-size: 13.5px; }
.list { display: flex; flex-direction: column; gap: 8px; }
.opt { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 12px; width: 100%;
  min-height: 64px; padding: 10px 12px; border-radius: 14px; background: var(--row); border: 1px solid var(--line); }
.opt:hover, .opt:focus-visible { background: var(--rowh); border-color: #a259ff; }
.opt[aria-busy="true"] { opacity: .7; cursor: progress; }
.meta { flex: 1; min-width: 0; }
.name { display: block; font-weight: 650; font-size: 15px; }
.detail { display: block; color: var(--muted); font-size: 12.5px; margin-top: 2px; }
.badge { font-size: 11.5px; font-weight: 700; padding: 4px 9px; border-radius: 999px; white-space: nowrap;
  background: rgba(162,89,255,.16); color: #b88aff; }
.badge.detected { background: rgba(48,164,108,.16); color: #34b37a; }
.badge.install { background: transparent; border: 1px solid var(--line); color: var(--muted); }
.last { display: inline-block; margin-left: 6px; font-size: 10.5px; font-weight: 700; color: #b88aff; vertical-align: 1px; }
.err { margin-top: 12px; padding: 10px 12px; border-radius: 12px; font-size: 13px; background: rgba(229,72,77,.12); color: #e5484d; }
.foot { margin-top: 14px; text-align: center; color: var(--muted); font-size: 12px; }
.foot a { color: inherit; }
@keyframes fade { from { opacity: 0 } }
@keyframes rise { from { opacity: 0; transform: translateY(12px) scale(.98) } }
@media (max-width: 480px) { .backdrop { align-items: flex-end; padding: 0; }
  .card { max-width: none; border-radius: 22px 22px 0 0; padding-bottom: calc(20px + env(safe-area-inset-bottom)); } }
@media (prefers-reduced-motion: reduce) { .backdrop, .card { animation: none; } }
`;

export interface OpenOptions {
  /** "dark" (default) or "light". */
  theme?: "dark" | "light";
  title?: string;
}

/** Shows the picker (or connects straight away inside Tari Universe) and resolves with the wallet. */
export function open(options: OpenOptions = {}): Promise<ConnectResult> {
  const wallets = discover();
  if (wallets.length === 1 && wallets[0]!.id === "tari-universe") return connectWith(wallets[0]!);

  return new Promise<ConnectResult>((resolve, reject) => {
    const host = document.createElement("div");
    host.setAttribute("data-tari-connect", "");
    host.setAttribute("data-theme", options.theme === "light" ? "light" : "dark");
    const root = host.attachShadow({ mode: "open" });
    const last = lastUsed();
    const rows = wallets
      .map(
        (w) => `<button class="opt" data-id="${w.id}" type="button">
          ${w.id === "tari-universe" ? UNIVERSE_ICON : sapientIcon(w.id === "sapient-mobile" ? "phone" : "ext")}
          <span class="meta"><span class="name">${w.name}${w.id === last && w.provider ? '<span class="last">LAST USED</span>' : ""}</span><span class="detail">${w.detail}</span></span>
          <span class="badge ${w.badge === "Detected" ? "detected" : w.badge === "Install" ? "install" : ""}">${w.badge}</span>
        </button>`
      )
      .join("");
    root.innerHTML = `<style>${CSS}</style>
      <div class="backdrop"><div class="card" role="dialog" aria-modal="true" aria-label="Connect a wallet">
        <header><h2>${options.title ?? "Connect a wallet"}</h2><button class="x" type="button" aria-label="Close">×</button></header>
        <p class="sub">Choose how to connect to this app. Your keys stay in your wallet.</p>
        <div class="list">${rows}</div>
        <div class="err" hidden></div>
        <div class="foot">Download Sapient at <a href="https://sapient.tari.mw" target="_blank" rel="noopener">sapient.tari.mw</a></div>
      </div></div>`;
    document.body.append(host);
    const err = root.querySelector<HTMLElement>(".err")!;
    const close = () => {
      host.remove();
      document.removeEventListener("keydown", onKey);
    };
    const cancel = () => {
      close();
      const e = new Error("The user closed the wallet picker.") as Error & { code?: number };
      e.code = 4001;
      reject(e);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    document.addEventListener("keydown", onKey);
    root.querySelector(".x")!.addEventListener("click", cancel);
    root.querySelector(".backdrop")!.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) cancel();
    });
    (root.querySelector(".opt") as HTMLElement | null)?.focus();

    root.querySelectorAll<HTMLButtonElement>(".opt").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const option = wallets.find((w) => w.id === btn.dataset.id)!;
        if (!option.provider) {
          if (option.installUrl) window.open(option.installUrl, "_blank", "noopener");
          return;
        }
        err.hidden = true;
        btn.setAttribute("aria-busy", "true");
        // The wallet now shows its own prompt (extension popup, or the WalletConnect pairing dialog):
        // step out of its way rather than stacking two dialogs.
        host.style.display = "none";
        try {
          const result = await connectWith(option);
          close();
          resolve(result);
        } catch (e) {
          host.style.display = "";
          btn.removeAttribute("aria-busy");
          const code = (e as { code?: number }).code;
          err.textContent = code === 4001 ? "Connection cancelled. Pick a wallet to try again." : (e as Error).message || "Couldn't connect.";
          err.hidden = false;
        }
      });
    });
  });
}

/** The connection made by open() / the button, if any. */
export function connection(): ConnectResult | null {
  return current;
}

/** Ends the connection with the wallet (where the wallet supports it) and forgets it here. */
export async function disconnect(): Promise<void> {
  const c = current;
  current = null;
  if (c) await c.provider.request({ method: "tari_disconnect" }).catch(() => {});
}

// ---------------- <tari-connect-button> ----------------
const BUTTON_CSS = `
:host { display: inline-block; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
button { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 8px;
  min-height: 42px; padding: 0 18px; border-radius: 999px; font-weight: 650; font-size: 14.5px;
  background: linear-gradient(135deg, #fc72ff, #a259ff); color: #120b18; box-shadow: 0 6px 18px rgba(162,89,255,.35); }
button.connected { background: #1f1729; color: #f2f2f6; border: 1px solid #2c2338; box-shadow: none; }
button:focus-visible { outline: 2px solid #a259ff; outline-offset: 2px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #34b37a; }
`;

class TariConnectButton extends HTMLElement {
  private btn!: HTMLButtonElement;

  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${BUTTON_CSS}</style><button type="button" part="button"></button>`;
    this.btn = root.querySelector("button")!;
    this.render();
    this.btn.addEventListener("click", () => void this.onClick());
  }

  private render() {
    const label = this.getAttribute("label") || "Connect wallet";
    if (current) {
      const a = current.accounts[0] ?? "";
      const short = a.length > 18 ? `${a.slice(0, 10)}…${a.slice(-6)}` : a;
      this.btn.className = "connected";
      this.btn.innerHTML = `<span class="dot"></span>${short}`;
      this.btn.title = "Connected. Click to disconnect.";
    } else {
      this.btn.className = "";
      this.btn.textContent = label;
      this.btn.title = "";
    }
  }

  private async onClick() {
    if (current) {
      await disconnect();
      this.render();
      this.dispatchEvent(new CustomEvent("tari-disconnect", { bubbles: true, composed: true }));
      return;
    }
    try {
      const result = await open({ theme: (this.getAttribute("theme") as "dark" | "light") || "dark" });
      this.render();
      result.provider.on?.("disconnect", () => {
        current = null;
        this.render();
      });
      this.dispatchEvent(new CustomEvent("tari-connect", { detail: result, bubbles: true, composed: true }));
    } catch {
      /* closed or cancelled: stay as is */
    }
  }
}

if (!customElements.get("tari-connect-button")) customElements.define("tari-connect-button", TariConnectButton);

(window as unknown as { TariConnect: unknown }).TariConnect = { open, discover, connection, disconnect };
