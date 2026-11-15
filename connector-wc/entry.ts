// tari-connector-wc.js -- the opt-in WalletConnect transport for tari-connector.js.
//
// Loaded by tari-connector.js only when a dApp sets `window.TARI_WALLETCONNECT = { projectId }`
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

interface Config {
  projectId: string;
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
button, a.btn { display: block; box-sizing: border-box; width: 100%; min-height: 46px; margin: 8px 0 0; border-radius: 12px;
  border: 1px solid #2c2338; background: #211a2b; color: #f2f2f6; font: 600 15px inherit; cursor: pointer;
  text-decoration: none; line-height: 46px; padding: 0 12px; }
.primary { background: linear-gradient(135deg, #fc72ff, #a259ff); border: 0; color: #120b18; }
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
        ${isPhone() ? "" : '<div class="qr" id="qr"></div>'}
        ${isPhone() ? '<a class="btn primary" id="open" href="#">Open Sapient</a>' : ""}
        <button type="button" id="copy">Copy link</button>
        <button type="button" id="cancel">Cancel</button>
        <div class="status" id="status">Preparing a secure connection…</div>
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
        qrEl.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
      }
      const open = root.getElementById("open") as HTMLAnchorElement | null;
      if (open) open.href = sapientDeepLink(value);
      root.getElementById("status")!.textContent = "Waiting for you to approve in Sapient…";
    },
    close,
    cancelled,
  };
}

// ---------------- transport ----------------
function create(config: Config) {
  if (!config || typeof config.projectId !== "string" || !config.projectId) {
    throw new Error("TARI_WALLETCONNECT needs a projectId (create one at cloud.reown.com).");
  }
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
      projectId: config.projectId,
      metadata: config.metadata ?? defaultMetadata(),
      relayUrl: config.relayUrl,
    });
    provider.on("display_uri", (uri: string) => modal?.setUri(uri));
    provider.on("session_event", (e: { params: { event: { name: string; data: unknown } } }) => {
      const { name, data } = e.params.event;
      if (name === "networkChanged" && typeof data === "string" && NETWORKS.includes(data)) chain = `${NAMESPACE}:${data}`;
      if (EVENTS.includes(name)) emit(name, data);
    });
    provider.on("session_delete", () => emit("disconnect", null));
    return provider;
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

  return {
    get connected() {
      return Boolean(provider?.session);
    },
    async request(method: string, params: unknown) {
      if (method === "tari_disconnect") {
        if (provider?.session) await provider.disconnect();
        emit("disconnect", null);
        return null;
      }
      await connect();
      const result = await provider!.request({ method, params: (params ?? {}) as object }, chain);
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
