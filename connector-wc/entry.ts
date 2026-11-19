// tari-connector-wc.js -- the opt-in WalletConnect transport for tari-connector.js.
//
// Loaded by tari-connector.js only when a dApp sets `window.TARI_WALLETCONNECT = {}` (projectId optional)
// and runs outside a Tari wallet (no extension, not embedded in Universe). It pairs with Sapient for
// Android over WalletConnect v2 and carries the very same `tari_*` requests, so the dApp's code is
// unchanged. The pairing UI (QR on desktop, "Open Sapient" on a phone) lives in a Shadow DOM so a
// dApp's CSS can't break it and it can't leak styles into the dApp.
//
// Protocol: namespace "tari", chains "tari:<network>", the window.tari method set -- the same
// constants as @chironbuilder/ootle-sdk/walletconnect and Sapient's src/lib/wcNamespace.ts.
import { UniversalProvider } from "@walletconnect/universal-provider";
import qrcode from "qrcode-generator";

const NAMESPACE = "tari";
const METHODS = [
  "tari_requestAccounts",
  "tari_getAccounts",
  "tari_getNetwork",
  "tari_switchNetwork",
  "tari_getWalletAddress",
  "tari_getBalances",
  "tari_getSubstate",
  "tari_getCapabilities",
  "tari_getTransactionResult",
  "tari_signAndSubmitTransaction",
  "tari_withdrawStealthAndExecute",
  "tari_htlcFund",
  "tari_createTransactionRequest",
  "tari_getTransactionRequest",
  "tari_submitTransactionRequest",
  "tari_requestViewAccess",
  "tari_getViewAccess",
  "tari_revokeViewAccess",
  "tari_getPrivateBalances",
  "tari_getShieldedOutputs",
  "tari_scanForPrivatePayments",
  "tari_scanForResourceUtxos",
  "tari_scanForOwnedUtxos",
  "tari_claimPrivatePayment",
  "tari_signOwnershipChallenge",
  "tari_signWalletOwnershipChallenge",
  "tari_disconnect",
];
const EVENTS = ["accountsChanged", "networkChanged"];
const NETWORKS = ["mainnet", "esmeralda", "igor"];

// Shared Reown project id used when a dApp doesn't bring its own. Fine for trying things out; in production a
// dApp should pass its own projectId so it gets its own relay quota and Reown Verify can mark its domain verified.
const DEFAULT_PROJECT_ID = "8bb31c50def7dc5a660461ff56b86588";

interface Config {
  projectId?: string;
  network?: string;
  metadata?: { name: string; description: string; url: string; icons: string[] };
  relayUrl?: string;
}

type Listener = (data: unknown) => void;

function defaultMetadata() {
  const icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href ?? `${location.origin}/favicon.ico`;
  return { name: document.title || location.host, description: "", url: location.origin, icons: [icon] };
}

const isPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

function sapientDeepLink(uri: string): string {
  return `sapient://wc?uri=${encodeURIComponent(uri)}`;
}

// ---------------- pairing modal ----------------
const MODAL_CSS = `
:host { all: initial; }
.backdrop { position: fixed; inset: 0; z-index: 2147483647; background: rgba(8, 4, 12, 0.66);
  display: flex; align-items: center; justify-content: center; padding: 16px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.card { width: 100%; max-width: 360px; background: #17111f; color: #f2f2f6; border: 1px solid #2c2338;
  border-radius: 22px; padding: 22px; box-shadow: 0 30px 80px rgba(0,0,0,.55); text-align: center; }
.logo { width: 52px; height: 52px; border-radius: 14px; margin: 0 auto 10px;
  background: linear-gradient(135deg, #fc72ff, #a259ff); display: flex; align-items: center; justify-content: center; }
h2 { margin: 0 0 6px; font-size: 19px; }
p { margin: 0 0 16px; color: #9997a3; font-size: 14px; line-height: 1.45; }
.qr { background: #fff; border-radius: 16px; padding: 12px; width: 236px; height: 236px; margin: 0 auto 16px; }
.qr svg { width: 100%; height: 100%; display: block; }
/* Until the relay hands back a pairing link: a scanning shimmer over a QR-ish placeholder. */
.qr.loading { position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center;
  background: #f4eff8; }
.qr.loading::before { content: ""; position: absolute; inset: 18px; border-radius: 10px; opacity: .5;
  background: repeating-linear-gradient(90deg, #ddd2e6 0 14px, transparent 14px 22px),
              repeating-linear-gradient(0deg, #ddd2e6 0 14px, transparent 14px 22px);
  -webkit-mask: linear-gradient(#000 0 0); }
.qr.loading::after { content: ""; position: absolute; left: 0; right: 0; height: 40%; top: -40%;
  background: linear-gradient(180deg, transparent, rgba(162, 89, 255, .28), transparent);
  animation: tc-sweep 1.4s ease-in-out infinite; }
.spinner { position: relative; z-index: 1; width: 44px; height: 44px; border-radius: 50%;
  border: 4px solid rgba(162, 89, 255, .22); border-top-color: #a259ff; animation: tc-spin .8s linear infinite; }
.pending { display: flex; justify-content: center; padding: 6px 0 14px; }
.btn.loading { opacity: .6; pointer-events: none; }
.btn .mini { display: inline-block; vertical-align: -3px; width: 16px; height: 16px; margin-right: 8px; border-radius: 50%;
  border: 2px solid rgba(18, 11, 24, .3); border-top-color: #120b18; animation: tc-spin .8s linear infinite; }
.dots::after { content: ""; animation: tc-dots 1.2s steps(4, end) infinite; }
@keyframes tc-spin { to { transform: rotate(360deg); } }
@keyframes tc-sweep { to { top: 100%; } }
@keyframes tc-dots { 0% { content: ""; } 25% { content: "."; } 50% { content: ".."; } 75% { content: "..."; } }
@media (prefers-reduced-motion: reduce) {
  .qr.loading::after, .dots::after { animation: none; }
  .spinner, .btn .mini { animation-duration: 2.4s; }
}
button, a.btn { display: block; box-sizing: border-box; width: 100%; min-height: 46px; margin: 8px 0 0; border-radius: 12px;
  border: 1px solid #2c2338; background: #211a2b; color: #f2f2f6; font-family: inherit; font-weight: 600; font-size: 15px; cursor: pointer;
  text-decoration: none; line-height: 46px; padding: 0 12px; }
a.btn.primary, button.primary { background: linear-gradient(135deg, #fc72ff, #a259ff); border: 0; color: #120b18; }
.status { margin-top: 10px; font-size: 13px; color: #9997a3; min-height: 18px; }
`;

const EYE_SVG =
  '<svg viewBox="0 0 128 128" width="34" height="34"><path d="M22 64 Q64 32 106 64 Q64 96 22 64 Z" fill="#180a20"/><circle cx="64" cy="64" r="15" fill="#fc72ff"/><circle cx="64" cy="64" r="6" fill="#180a20"/></svg>';

interface Modal {
  setUri(uri: string): void;
  close(): void;
  cancelled: Promise<never>;
}

function openModal(): Modal {
  const host = document.createElement("div");
  host.setAttribute("data-tari-walletconnect", "");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${MODAL_CSS}</style>
    <div class="backdrop" part="backdrop">
      <div class="card" role="dialog" aria-label="Connect with Sapient">
        <div class="logo">${EYE_SVG}</div>
        <h2>Connect with Sapient</h2>
        <p>${isPhone() ? "Open the Sapient app to connect this site to your wallet." : "Scan this code with Sapient on your phone: Scan tab, then point the camera."}</p>
        ${isPhone() ? "" : '<div class="qr loading" id="qr" aria-busy="true" aria-label="Generating QR code"><div class="spinner"></div></div>'}
        ${isPhone() ? '<a class="btn primary loading" id="open" href="#" aria-disabled="true"><span class="mini"></span>Preparing…</a>' : ""}
        <button type="button" id="copy">Copy link</button>
        <button type="button" id="cancel">Cancel</button>
        <div class="status" id="status"><span class="dots">Preparing a secure connection</span></div>
      </div>
    </div>`;
  document.body.append(host);
  let uri = "";
  let rejectCancel: (e: Error) => void = () => {};
  const cancelled = new Promise<never>((_, reject) => (rejectCancel = reject));
  cancelled.catch(() => {});
  const close = () => host.remove();
  root.getElementById("cancel")!.addEventListener("click", () => {
    close();
    const e = new Error("Connection request rejected.") as Error & { code?: number };
    e.code = 4001;
    rejectCancel(e);
  });
  root.getElementById("copy")!.addEventListener("click", async () => {
    if (!uri) return;
    try {
      await navigator.clipboard.writeText(uri);
      root.getElementById("status")!.textContent = "Link copied. Paste it in Sapient: Scan tab, then Or paste the link.";
    } catch {
      root.getElementById("status")!.textContent = "Couldn't copy. Use the QR code instead.";
    }
  });
  return {
    setUri(value: string) {
      uri = value;
      host.setAttribute("data-uri", value);
      const qrEl = root.getElementById("qr");
      if (qrEl) {
        const q = qrcode(0, "M");
        q.addData(value);
        q.make();
        qrEl.classList.remove("loading");
        qrEl.removeAttribute("aria-busy");
        qrEl.setAttribute("aria-label", "WalletConnect QR code");
        qrEl.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
      }
      const open = root.getElementById("open") as HTMLAnchorElement | null;
      if (open) {
        open.href = sapientDeepLink(value);
        open.classList.remove("loading");
        open.removeAttribute("aria-disabled");
        open.textContent = "Open Sapient";
      }
      root.getElementById("status")!.textContent = "Waiting for you to approve in Sapient…";
    },
    close,
    cancelled,
  };
}

// ---------------- "check your phone" sheet ----------------
// Shown while a request on an existing session waits for Sapient. Without it the page looks dead: the
// picker has stepped aside and the approval is on another device -- or nowhere, if the app is closed or
// the phone dropped the session. After a while it offers to pair again.
const SLOW_MS = 700; // fast read-only calls answer before this and never flash the sheet
const STALE_MS = 15000;

interface Waiting {
  close(): void;
  /** Rejects with 4001 on Cancel; resolves when the user asks to pair again. */
  outcome: Promise<"repair">;
}

function openWaiting(method: string): Waiting {
  const host = document.createElement("div");
  host.setAttribute("data-tari-walletconnect-waiting", "");
  const root = host.attachShadow({ mode: "open" });
  const what = method === "tari_requestAccounts" ? "the connection" : "the request";
  root.innerHTML = `<style>${MODAL_CSS}</style>
    <div class="backdrop">
      <div class="card" role="dialog" aria-label="Check Sapient">
        <div class="logo">${EYE_SVG}</div>
        <h2>Check Sapient</h2>
        <p>Approve ${what} in Sapient on your phone.</p>
        <div class="pending"><div class="spinner"></div></div>
        ${isPhone() ? '<a class="btn primary" id="open" href="sapient://wc">Open Sapient</a>' : ""}
        <button type="button" id="repair" hidden>Pair again</button>
        <button type="button" id="cancel">Cancel</button>
        <div class="status" id="status"><span class="dots">Waiting for Sapient</span></div>
      </div>
    </div>`;
  document.body.append(host);
  let settle: { resolve: (v: "repair") => void; reject: (e: Error) => void } = { resolve: () => {}, reject: () => {} };
  const outcome = new Promise<"repair">((resolve, reject) => (settle = { resolve, reject }));
  outcome.catch(() => {});
  const stale = setTimeout(() => {
    root.getElementById("status")!.textContent = "Not hearing back. Is Sapient open? If you removed this site in Sapient, pair again.";
    root.getElementById("repair")!.hidden = false;
  }, STALE_MS);
  const close = () => {
    clearTimeout(stale);
    host.remove();
  };
  root.getElementById("cancel")!.addEventListener("click", () => {
    close();
    const e = new Error("Request cancelled.") as Error & { code?: number };
    e.code = 4001;
    settle.reject(e);
  });
  root.getElementById("repair")!.addEventListener("click", () => {
    close();
    settle.resolve("repair");
  });
  return { close, outcome };
}

// ---------------- transport ----------------
function create(config: Config) {
  config = config && typeof config === "object" ? config : {};
  const projectId = typeof config.projectId === "string" && config.projectId ? config.projectId : DEFAULT_PROJECT_ID;
  const network = NETWORKS.includes(config.network ?? "") ? config.network! : "mainnet";
  let chain = `${NAMESPACE}:${network}`;
  let provider: Awaited<ReturnType<typeof UniversalProvider.init>> | null = null;
  let connecting: Promise<void> | null = null;
  let modal: Modal | null = null;
  const listeners = new Map<string, Set<Listener>>();
  const emit = (event: string, data: unknown) => {
    for (const fn of listeners.get(event) ?? []) {
      try {
        fn(data);
      } catch {
        /* a dApp listener that throws must not break the bridge */
      }
    }
  };

  async function init() {
    if (provider) return provider;
    provider = await UniversalProvider.init({
      projectId,
      metadata: config.metadata ?? defaultMetadata(),
      relayUrl: config.relayUrl,
    });
    provider.on("display_uri", (uri: string) => modal?.setUri(uri));
    provider.on("session_event", (e: { params: { event: { name: string; data: unknown } } }) => {
      const { name, data } = e.params.event;
      if (name === "networkChanged" && typeof data === "string" && NETWORKS.includes(data)) chain = `${NAMESPACE}:${data}`;
      if (name === "accountsChanged") forgetAddress();
      if (EVENTS.includes(name)) emit(name, data);
    });
    provider.on("session_delete", () => {
      forgetAddress();
      emit("disconnect", null);
    });
    return provider;
  }

  // Read-only answers the session already holds. A phone wallet is usually in the background when the page
  // reloads, and it may not answer until it is opened again; a page reconnecting quietly shouldn't wait on that.
  const ADDRESS_KEY = "tari.wc.walletAddress";
  function sessionAccounts(p: InstanceType<typeof UniversalProvider>): string[] {
    const all: string[] = p.session?.namespaces?.[NAMESPACE]?.accounts ?? [];
    const here = all.filter((a) => a.startsWith(`${chain}:`));
    return (here.length ? here : all).map((a) => a.split(":").slice(2).join(":"));
  }
  function sessionChain(p: InstanceType<typeof UniversalProvider>): string | null {
    const chains: string[] = p.session?.namespaces?.[NAMESPACE]?.chains ?? [];
    return chains.includes(chain) ? chain : chains[0] ?? null;
  }
  function cachedAddress(topic: string): string | null {
    try {
      const v = JSON.parse(localStorage.getItem(ADDRESS_KEY) ?? "null") as { topic: string; account: string; address: string } | null;
      return v && v.topic === topic && v.account === (provider ? sessionAccounts(provider)[0] : "") ? v.address : null;
    } catch {
      return null;
    }
  }
  function rememberAddress(topic: string, address: string): void {
    try {
      localStorage.setItem(ADDRESS_KEY, JSON.stringify({ topic, account: provider ? sessionAccounts(provider)[0] : "", address }));
    } catch {
      /* asked again next time */
    }
  }
  function forgetAddress(): void {
    try {
      localStorage.removeItem(ADDRESS_KEY);
    } catch {
      /* nothing kept */
    }
  }

  async function connect() {
    const p = await init();
    if (p.session) return;
    if (connecting) return connecting;
    modal = openModal();
    const m = modal;
    connecting = Promise.race([
      p.connect({
        // Optional, as WalletConnect recommends; Sapient refuses a session for a network it isn't on.
        optionalNamespaces: { [NAMESPACE]: { chains: [chain], methods: METHODS, events: EVENTS } },
      }),
      m.cancelled,
    ])
      .then(() => undefined)
      .finally(() => {
        m.close();
        modal = null;
        connecting = null;
      });
    return connecting;
  }

  // Sends one request; if it's slow, shows the "Check Sapient" sheet. "Pair again" drops the session
  // (the phone may have forgotten it) and re-sends over a fresh pairing.
  async function requestWithFeedback(method: string, params: unknown): Promise<unknown> {
    const sent = provider!.request({ method, params: (params ?? {}) as object }, chain);
    let waiting: Waiting | null = null;
    const timer = setTimeout(() => (waiting = openWaiting(method)), SLOW_MS);
    try {
      const shown = new Promise<"repair">((resolve, reject) => {
        const poll = setInterval(() => {
          if (!waiting) return;
          clearInterval(poll);
          waiting.outcome.then(resolve, reject);
        }, 100);
        sent.finally(() => clearInterval(poll)).catch(() => {});
      });
      const first = await Promise.race([sent.then((r) => ({ r })), shown]);
      if (first !== "repair") return first.r;
    } finally {
      clearTimeout(timer);
      (waiting as Waiting | null)?.close();
    }
    try {
      await provider!.disconnect();
    } catch {
      /* the relay may not reach the phone */
    }
    // If the relay call failed, still forget the session locally so connect() shows a fresh QR.
    const stale = provider!.session;
    if (stale) {
      await provider!.client.session.delete(stale.topic, { code: 6000, message: "User asked to pair again" }).catch(() => {});
      provider!.session = undefined;
    }
    emit("disconnect", null);
    await connect();
    return requestWithFeedback(method, params);
  }

  return {
    get connected() {
      return Boolean(provider?.session);
    },
    async request(method: string, params: unknown) {
      if (method === "tari_disconnect") {
        forgetAddress();
        if (provider?.session) await provider.disconnect();
        emit("disconnect", null);
        return null;
      }
      // Never prompts, as documented: with no session (none restored from storage either), report
      // "not connected" instead of opening the pairing dialog. A page checks these on load to reconnect
      // quietly; a QR code popping up there would be a surprise.
      if (method === "tari_getAccounts" || method === "tari_getNetwork") {
        const p = await init();
        if (!p.session) return method === "tari_getAccounts" ? [] : chain.slice(NAMESPACE.length + 1);
        // Answered from the session (kept current by the wallet's session updates), not a round trip.
        if (method === "tari_getAccounts") {
          const accounts = sessionAccounts(p);
          if (accounts.length) return accounts;
        } else {
          const c = sessionChain(p);
          if (c) return c.slice(NAMESPACE.length + 1);
        }
      }
      if (method === "tari_getWalletAddress" && provider?.session) {
        const hit = cachedAddress(provider.session.topic);
        if (hit) return hit;
      }
      await connect();
      const result = await requestWithFeedback(method, params);
      if (method === "tari_getWalletAddress" && typeof result === "string" && provider?.session) rememberAddress(provider.session.topic, result);
      // An approved switch answers with the new network; follow it so the next call targets it.
      if (method === "tari_switchNetwork" && typeof result === "string" && NETWORKS.includes(result)) chain = `${NAMESPACE}:${result}`;
      return result;
    },
    on(event: string, fn: Listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    },
  };
}

(window as unknown as { __tariConnectorWC: unknown }).__tariConnectorWC = { create, sapientDeepLink };
