import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decodeSubstateResponse, decodeTransactionResultResponse } from "../lib/bor";
import { createPortal } from "react-dom";
import { ExternalLink, Eye, Maximize2, Minimize2, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { isSpendable, useStore } from "../store";
import { ggbp1GeneratorFingerprint, ggbp1OriginHash, type WasmGgbp1Request } from "@chironbuilder/tari-l1-wasm";
import {
  GGBP1_CHALLENGE_BYTES,
  GGBP1_GENESIS_HASH,
  GGBP1_MIN_CONFIRMATIONS,
  fromBase64Url,
  ggbp1Capability,
  leaseOutputs,
  leasedOutputIds,
  previewSummary,
  takeRequestSlot,
  toBase64Url,
  type Ggbp1Preview,
} from "../lib/ggbp1";
import {
  type BridgeMethod,
  type BridgeRequest,
  CONNECTED_METHODS,
  ERROR,
  REQUEST_METHODS,
  PROTOCOL,
  SIGNING_METHODS,
  VIEW_METHODS,
  capabilitiesFor,
  describeOperation,
  describeRequest,
  grantConnection,
  grantViewAccess,
  hasViewAccess,
  isBridgeRequest,
  isConnected,
  originOf,
  revokeConnection,
  revokeViewAccess,
  type ApprovalFormatter,
  type TransactionRequestOperation,
} from "../lib/dappBridge";
import {
  claimForSubmit,
  createRequest,
  executeOperation,
  forgetOrigin,
  getRecord,
  parseOperation,
  recordDecision,
  setPreviewedHtlcValue,
  settle,
  summarize,
} from "../lib/dappRequests";
import { previewOperation, type RawPreview } from "../lib/dappPreview";
import { hostOf } from "../lib/dapps";
import { TARI_RESOURCE_ADDRESS, formatResourceAmount, ootleNetworkFor, ootleNetworkLabel, type TokenBalance } from "../ootle";

/** TARI's on-chain divisibility on Ootle -- the fee is always paid in it. */
const TARI_DIVISIBILITY = 6;
import { Badge, Button, Switch } from "./ui";
import { t } from "../i18n";
import { withL2Log } from "../lib/l2history";

interface ApprovalState {
  id: string;
  method: BridgeMethod;
  summary: string[];
  /** Which dialog voice to use. "connect" and "view" are permission grants — nothing is spent, so
   * the "this spends real funds" warning would be false and, worse, would train users to ignore it
   * where it is true. "spend" is everything that moves value. */
  tone: "connect" | "view" | "spend" | "network" | "proof";
  /** Nothing to approve: the dialog only explains why and offers to close (a balance proof this
   * wallet cannot make). */
  blocked?: boolean;
  /** Overrides the tone's own heading and approve label. */
  title?: string;
  approveLabel?: string;
  /** An extra warning shown in its own box (a network switch onto MainNet's real-money notice). */
  notice?: string;
  /** Present only for a transaction request (every `REQUEST_METHODS` operation). `enforced: true`
   * means the dApp set `enforceFeeType` — the dialog shows `initial` as a locked fact, not a
   * choice. Otherwise the dialog renders an editable toggle seeded at `initial` (the dApp's
   * `feeType` hint if it gave one, else this wallet's own default); the user's live pick is read
   * from `feeTypeChoiceRef` at decide-time, never from this object (which never changes after the
   * dialog opens). */
  feeChoice?: { enforced: boolean; initial: "private" | "transparent" };
  /** What a simulation says the request does to the account -- "loading" while it runs. Absent for
   * requests the wallet builds itself, whose summary already states exactly what moves. */
  preview?: PreviewLines | "loading";
  decide: (approved: boolean) => void;
}

interface PreviewLines {
  lines: string[];
  warnings: string[];
}

/** Approve stays disabled this long after a dialog appears, so a click aimed at the dApp (a
 * "double-click here" lure timed to the request) can't land on it. */
const APPROVE_ARM_DELAY_MS = 800;
/** Caps on the scan budgets a dApp may ask for -- each page is one or more indexer round trips. */
const MAX_DAPP_SCAN_PAGES = 20;
const MAX_DAPP_SCAN_PAGE_SIZE = 100;
const clampScan = (n: unknown, max: number): number | undefined =>
  typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : undefined;

function shortAddr(value: string): string {
  return value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value;
}

/** Amounts in the approval dialog at their real scale: TARI and every token the account holds. */
function approvalFormatter(balances: TokenBalance[]): ApprovalFormatter {
  const meta = (r: string) => balances.find((b) => b.resourceAddress === r);
  const divisibility = (r: string) => (r === TARI_RESOURCE_ADDRESS ? TARI_DIVISIBILITY : meta(r)?.divisibility);
  const amount = (raw: string, r: string) => {
    try {
      const d = divisibility(r);
      return d === undefined ? `${BigInt(raw)} base units of` : formatResourceAmount(BigInt(raw), d);
    } catch {
      return raw;
    }
  };
  return {
    amount,
    // A token's symbol is whatever its creator chose, so anything but TARI also shows its address.
    resource: (r) => (r === TARI_RESOURCE_ADDRESS ? "TARI" : meta(r)?.symbol ? `${meta(r)!.symbol} (${shortAddr(r)})` : shortAddr(r)),
    fee: (raw) => `${amount(raw, TARI_RESOURCE_ADDRESS)} TARI`,
  };
}

/** Turns a simulation into dialog lines, amounts formatted. */
function previewLines(raw: RawPreview, fmt: ApprovalFormatter): PreviewLines {
  const lines: string[] = [];
  const warnings: string[] = [];
  const show = (delta: bigint, r: string) => `${fmt.amount((delta < 0n ? -delta : delta).toString(), r)} ${fmt.resource(r)}`;
  if (raw.htlc) {
    if (raw.htlc.value !== null && raw.htlcResource) lines.push(t("frame.previewHtlcValue", { amount: show(raw.htlc.value, raw.htlcResource) }));
    for (const problem of raw.htlc.problems) warnings.push(t("frame.previewHtlcProblem", { problem }));
  }
  if (raw.simulated) {
    if (raw.wouldFail) warnings.push(t("frame.previewWouldFail", { error: raw.wouldFail }));
    for (const [r, delta] of raw.changes) lines.push(t(delta < 0n ? "frame.previewSends" : "frame.previewReceives", { amount: show(delta, r) }));
    if (raw.changes.size === 0 && !raw.wouldFail) lines.push(t("frame.previewNoChanges"));
  } else if (raw.error && !raw.htlc) {
    warnings.push(t("frame.previewUnavailable", { error: raw.error }));
  }
  for (const method of raw.ownAccountCalls) warnings.push(t("frame.previewOwnAccountCall", { method }));
  return { lines, warnings };
}

/**
 * A dApp running inside the wallet, with the provider bridge attached.
 *
 * The frame is cross-origin and sandboxed; every message is checked to have come from this frame
 * and from the dApp's exact origin before it is looked at. The approval dialog is drawn over the
 * frame in the wallet's own chrome — a dApp cannot paint there, so it cannot fake or cover a
 * prompt.
 */
export function DappFrame({
  url,
  name,
  onClose,
}: {
  url: string;
  name: string;
  onClose: () => void;
}) {
  const store = useStore();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const origin = useMemo(() => originOf(url), [url]);
  // A page on the wallet's own origin, framed with allow-scripts + allow-same-origin, IS the wallet:
  // it could read its storage and reach into this window. Such a URL is never framed or bridged.
  const sameOrigin = origin === window.location.origin;
  const [connected, setConnected] = useState(() => (origin ? isConnected(origin) : false));
  const [viewAccess, setViewAccess] = useState(() => (origin ? hasViewAccess(origin) : false));
  const [approval, setApproval] = useState<ApprovalState | null>(null);
  const [approveArmed, setApproveArmed] = useState(false);
  const approvalId = approval?.id ?? null;
  useEffect(() => {
    setApproveArmed(false);
    if (!approvalId) return;
    const timer = setTimeout(() => setApproveArmed(true), APPROVE_ARM_DELAY_MS);
    return () => clearTimeout(timer);
  }, [approvalId]);
  /** Mirrors `feeTypeChoiceRef` for rendering — a ref alone wouldn't re-render the toggle. Reset
   * whenever a new approval opens (including one with no `feeChoice` at all, where it's unused). */
  const [feeTypeDisplay, setFeeTypeDisplay] = useState<"private" | "transparent">("transparent");
  const [blocked, setBlocked] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Read through refs so the message handler can stay mounted for the frame's whole life without
  // being torn down and re-attached every time a balance ticks.
  const storeRef = useRef(store);
  storeRef.current = store;
  const connectedRef = useRef(connected);
  connectedRef.current = connected;
  const viewAccessRef = useRef(viewAccess);
  viewAccessRef.current = viewAccess;

  const reply = useCallback(
    (id: string, payload: { result?: unknown; error?: { code: number; message: string } }) => {
      const frame = frameRef.current?.contentWindow;
      if (!frame || !origin) return;
      // Always the dApp's exact origin, never "*": a wildcard would leak the reply to whatever
      // happened to be loaded if the frame navigated away mid-request.
      frame.postMessage({ protocol: PROTOCOL, id, ...payload }, origin);
    },
    [origin],
  );

  /**
   * Unsolicited push to the dApp -- not a reply to any request, picked up by
   * `public/tari-connector.js`'s own listener table (`data.event`/`data.data`) and surfaced through
   * the documented `window.tari.on(event, handler)` (see `tari-dapp.d.ts`). Without this, `.on()`
   * registers a handler that is syntactically valid but never actually called: the bridge protocol
   * has always supported pushing `{event, data}`, but nothing on this side of the frame ever sent
   * one -- a dApp coded straight from the type definitions would silently never hear about a
   * connection being dropped out from under it.
   */
  const emitEvent = useCallback(
    (event: string, data: unknown) => {
      const frame = frameRef.current?.contentWindow;
      if (!frame || !origin) return;
      frame.postMessage({ protocol: PROTOCOL, event, data }, origin);
    },
    [origin],
  );

  // One approval slot, one prompt at a time. `tari_createTransactionRequest` answers before the user
  // decides, so a dApp can legitimately have two prompts outstanding — and a second one painted over
  // the first would both strand the first promise and, far worse, let someone approve while reading
  // a different request. Each prompt waits for the previous one to be answered.
  const promptQueue = useRef<Promise<unknown>>(Promise.resolve());

  /** The live value of the current approval's fee-type toggle (when `feeChoice` was given), read
   * by the transaction-request flow right after `askUser` resolves — kept out of `askUser`'s own
   * `Promise<boolean>` so every other caller (connect/view-access approvals) is untouched by this.
   * Set fresh each time a `feeChoice` approval opens; the toggle's `onChange` keeps it current. */
  const feeTypeChoiceRef = useRef<"private" | "transparent" | null>(null);

  /** Puts a request in front of the user and waits for a verdict. */
  const askUser = useCallback(
    (
      id: string,
      method: BridgeMethod,
      params: Record<string, unknown>,
      options: {
        tone?: ApprovalState["tone"];
        notice?: string;
        summary?: string[];
        feeChoice?: ApprovalState["feeChoice"];
        blocked?: boolean;
        title?: string;
        approveLabel?: string;
        /** Simulates the request once its dialog is showing; `null` = nothing to preview. */
        previewer?: () => Promise<PreviewLines | null>;
      } = {},
    ) => {
      const answered = promptQueue.current.then(
        () =>
          new Promise<boolean>((resolve) => {
            feeTypeChoiceRef.current = options.feeChoice?.initial ?? null;
            setFeeTypeDisplay(options.feeChoice?.initial ?? "transparent");
            setApproval({
              id,
              method,
              summary: options.summary ?? describeRequest(method, params),
              tone: options.tone ?? "spend",
              notice: options.notice,
              blocked: options.blocked,
              title: options.title,
              approveLabel: options.approveLabel,
              feeChoice: options.feeChoice,
              preview: options.previewer ? "loading" : undefined,
              decide: (approved) => {
                setApproval(null);
                resolve(approved);
              },
            });
            if (options.previewer) {
              const settlePreview = (preview: PreviewLines | undefined) =>
                setApproval((current) => (current && current.id === id ? { ...current, preview } : current));
              options
                .previewer()
                .then((p) => settlePreview(p ?? undefined))
                .catch((e: unknown) =>
                  settlePreview({ lines: [], warnings: [t("frame.previewUnavailable", { error: e instanceof Error ? e.message : String(e) })] }),
                );
            }
          }),
      );
      // Swallowed so one rejected link cannot break the chain and silently skip every later prompt.
      promptQueue.current = answered.catch(() => undefined);
      return answered;
    },
    [],
  );

  const handle = useCallback(
    async (req: BridgeRequest) => {
      const params = req.params ?? {};
      const s = storeRef.current;
      const account = s.l2.identity?.account ?? null;

      // Matches the extension's own gating: the network is answerable to any page, everything
      // else needs a connection the user granted.
      //
      // The *Ootle* network, not `s.network` (the L1 one): every call in this bridge talks to Ootle.
      // ootleNetworkFor pairs them -- MainNet with MainNet, every testnet L1 with Esmeralda -- so a
      // dApp on a testnet L1 is told "esmeralda", the network its Ootle account really lives on.
      if (req.method === "tari_getNetwork") return { result: ootleNetworkFor(s.network) };

      // MetaMask's wallet_switchEthereumChain: a dApp may ask, only the user decides. Here the L1
      // and Ootle networks move together, and a switch reloads the whole app (which ends this
      // frame), so the answer goes back to the dApp first and the reload follows.
      if (req.method === "tari_switchNetwork") {
        const target = params.network;
        if (target !== "mainnet" && target !== "esmeralda") {
          return { error: ERROR.internal('This wallet runs Ootle on "mainnet" or "esmeralda".') };
        }
        const current = ootleNetworkFor(s.network);
        if (target === current) return { result: target };
        const approved = await askUser(req.id, req.method, params, {
          tone: "network",
          summary: [
            t("frame.switchNetworkLine", { from: ootleNetworkLabel(current), to: ootleNetworkLabel(target) }),
            t("frame.switchNetworkReload"),
          ],
          notice: target === "mainnet" ? t("frame.mainnetWarning") : undefined,
        });
        if (!approved) return { error: ERROR.rejected };
        // The network may have moved while the prompt was open (another tab, Settings).
        if (ootleNetworkFor(storeRef.current.network) !== current) {
          return { error: ERROR.internal("The wallet's network changed while this request was open. Ask again.") };
        }
        setTimeout(() => storeRef.current.switchNetwork(target), 150);
        return { result: target };
      }

      if (req.method === "tari_disconnect") {
        if (origin) {
          revokeConnection(origin);
          // An approved-but-unsubmitted request must not outlive the connection that created it:
          // otherwise a site could disconnect, reconnect, and submit something the user approved
          // under the earlier session.
          forgetOrigin(origin);
        }
        setConnected(false);
        setViewAccess(false);
        emitEvent("accountsChanged", []);
        return { result: null };
      }

      if (req.method === "tari_requestAccounts") {
        let justConnected = false;
        if (!connectedRef.current) {
          const approved = await askUser(req.id, req.method, params, { tone: "connect" });
          if (!approved) return { error: ERROR.rejected };
          if (origin) grantConnection(origin);
          setConnected(true);
          // grantConnection replaces the record wholesale, so any earlier view grant is gone —
          // mirror that here rather than leaving the badge showing a permission that no longer
          // exists.
          setViewAccess(false);
          justConnected = true;
        }
        if (!account) return { error: ERROR.internal("No Ootle account in this wallet") };
        const accounts = [await account.getComponentAddress()];
        // Only for a page that connected via `.on("accountsChanged", ...)` rather than reading this
        // call's own return value -- redundant with the result below when it's heard, harmless when
        // it isn't.
        if (justConnected) emitEvent("accountsChanged", accounts);
        return { result: accounts };
      }

      // ---- Private view access ----------------------------------------------------------------
      // Its own grant, its own prompt. Connecting reveals one public component address; this
      // reveals the confidential position nothing else on-chain can see. Read-only: it never
      // authorises a spend, and holding it never waives a spend's own approval.

      if (req.method === "tari_requestViewAccess") {
        if (!connectedRef.current) return { error: ERROR.unauthorized };
        if (viewAccessRef.current) return { result: { granted: true } };
        const approved = await askUser(req.id, req.method, params, { tone: "view" });
        // Refusing is an answer, not an error: a declined optional permission should not look to a
        // dApp like a transport failure it ought to retry.
        if (!approved) return { result: { granted: false } };
        // Re-checked rather than trusting the state captured before an arbitrarily long prompt: the
        // user may have hit Disconnect in the wallet chrome while it sat open.
        if (!origin || !isConnected(origin)) {
          return { error: ERROR.internal("This site was disconnected before view access could be granted") };
        }
        grantViewAccess(origin);
        setViewAccess(true);
        return { result: { granted: true } };
      }


      // ---- Ownership proof ----------------------------------------------------------------------
      // Its own prompt, not folded into SIGNING_METHODS: it spends nothing, so the "spend" tone's
      // warning language would be false here, and reusing it would train users to stop reading it
      // where it is true.

      if (req.method === "tari_signOwnershipChallenge") {
        if (!connectedRef.current) return { error: ERROR.unauthorized };
        if (!account) return { error: ERROR.internal("No Ootle account in this wallet") };
        const challenge = String(params.challenge ?? "");
        const substateId = String(params.substateId ?? "");
        const resourceAddress = String(params.resourceAddress ?? "");
        if (!challenge || !substateId || !resourceAddress) {
          return { error: ERROR.internal("resourceAddress, substateId and challenge are all required") };
        }
        const approved = await askUser(req.id, req.method, params, { tone: "view" });
        if (!approved) return { error: ERROR.rejected };
        try {
          return { result: await account.signOwnershipProof(resourceAddress, substateId, challenge) };
        } catch (e) {
          return { error: ERROR.internal(e instanceof Error ? e.message : String(e)) };
        }
      }

      if (req.method === "tari_signWalletOwnershipChallenge") {
        if (!connectedRef.current) return { error: ERROR.unauthorized };
        if (!account) return { error: ERROR.internal("No Ootle account in this wallet") };
        const challenge = String(params.challenge ?? "");
        if (!challenge) return { error: ERROR.internal("challenge is required") };
        const approved = await askUser(req.id, req.method, params, { tone: "view" });
        if (!approved) return { error: ERROR.rejected };
        try {
          return { result: await account.signWalletOwnership(challenge) };
        } catch (e) {
          return { error: ERROR.internal(e instanceof Error ? e.message : String(e)) };
        }
      }

      if (CONNECTED_METHODS.includes(req.method)) {
        // `tari_getAccounts` and `tari_getBalances` answer empty rather than throwing when
        // disconnected — the extension does the same, so a dApp can poll them harmlessly.
        const soft = req.method === "tari_getAccounts" || req.method === "tari_getBalances";
        if (!connectedRef.current) return soft ? { result: [] } : { error: ERROR.unauthorized };

        // Answered before the account check: these are about this site's own permission, not about
        // the account, so "is my grant still valid?" and "take it back" must keep working even when
        // the L2 account cannot be resolved. A dApp told "No Ootle account" when it asked to
        // *revoke* something would have no way to give the permission up.
        if (req.method === "tari_getViewAccess") return { result: { granted: viewAccessRef.current } };
        if (req.method === "tari_revokeViewAccess") {
          if (origin) revokeViewAccess(origin);
          setViewAccess(false);
          return { result: null };
        }

        if (!account) return soft ? { result: [] } : { error: ERROR.internal("No Ootle account") };

        switch (req.method) {
          case "tari_getAccounts":
            return { result: [await account.getComponentAddress()] };
          case "tari_getWalletAddress":
            // The bech32m `otl_…` address — owner + view *public* keys, which is what a stealth
            // output's `destination` decodes as. Not the component address, and not derivable from
            // one (a component address is a one-way hash of the owner key and carries no view key),
            // so a dApp paying this account privately has no other way to get it. Safe to hand over
            // on a plain connection: it lets anyone pay this account privately and no one read it.
            return { result: await account.getWalletAddress() };
          case "tari_getBalances": {
            // The same `TokenBalance[]` the extension returns, bigints included — postMessage
            // structured-clones them, so no stringifying that a dApp would have to undo.
            //
            // The confidential half is withheld without the view grant. `privateVisible` is what
            // keeps the withheld case distinguishable from a real zero: a dApp reading
            // `confidentialAmount: 0n` alone must not be able to conclude the account holds nothing
            // privately.
            const visible = viewAccessRef.current;
            return {
              result: s.l2.balances.map((b) => ({
                ...b,
                confidentialAmount: visible ? b.confidentialAmount : 0n,
                confidentialDecryptFailures: visible ? b.confidentialDecryptFailures : 0,
                privateVisible: visible,
              })),
            };
          }
          case "tari_getCapabilities":
            return { result: capabilitiesFor(origin, ggbp1Capability(s.network, !!s.wallet?.canSpend)) };
          case "tari_getSubstate": {
            const provider = await account.getProvider();
            return {
              result: decodeSubstateResponse(
                await provider.getSubstate(
                  String(params.substateId ?? ""),
                  (params.version as number | null | undefined) ?? null,
                ),
              ),
            };
          }
          case "tari_getTransactionResult": {
            const provider = await account.getProvider();
            return { result: decodeTransactionResultResponse(await provider.getTransactionResult(String(params.transactionId ?? ""))) };
          }
        }
      }

      // ---- Confidential reads -----------------------------------------------------------------

      if (VIEW_METHODS.includes(req.method)) {
        if (!connectedRef.current) return { error: ERROR.unauthorized };
        // A distinct message from "not connected" on purpose: a dApp that handles both identically
        // would loop on the connect prompt for a user who is already connected and simply hasn't
        // been asked for view access yet.
        if (!viewAccessRef.current) {
          return { error: { code: 4100, message: "No private view access — call tari_requestViewAccess first" } };
        }
        if (!account) return { error: ERROR.internal("No Ootle account in this wallet") };
        try {
          switch (req.method) {
            case "tari_getPrivateBalances":
              return { result: await account.getPrivateBalances() };
            case "tari_getShieldedOutputs": {
              const resourceAddress = params.resourceAddress ? String(params.resourceAddress) : undefined;
              const records = await account.listUnspentShieldedOutputs(resourceAddress);
              // Projected field by field rather than spread: a `ShieldedOutputRecord` also carries
              // `accountId` and `spent`, neither of which is a dApp's business, and a spread would
              // hand over whatever internal field is added to that record next.
              return {
                result: records.map((r) => ({
                  resourceAddress: r.resourceAddress,
                  commitment: r.commitment,
                  amount: r.amount,
                  transactionId: r.transactionId,
                  createdAt: r.createdAt,
                  memo: r.memo,
                })),
              };
            }
            case "tari_scanForPrivatePayments": {
              const maxPages = clampScan(params.maxPages, MAX_DAPP_SCAN_PAGES);
              const { claimed, found } = await account.scanForPrivatePayments(maxPages);
              // Refreshed because a scan that finds anything changes the balance the wallet's own
              // panel is showing — a dApp shouldn't be able to move the user's funds into view
              // without the wallet noticing.
              storeRef.current.refreshL2();
              return { result: { claimed, found } };
            }
            case "tari_scanForResourceUtxos": {
              const resourceAddress = String(params.resourceAddress ?? "");
              if (!resourceAddress) return { error: ERROR.internal("resourceAddress is required") };
              const maxPages = clampScan(params.maxPages, MAX_DAPP_SCAN_PAGES);
              const pageSize = clampScan(params.pageSize, MAX_DAPP_SCAN_PAGE_SIZE);
              const limit = typeof params.limit === "number" ? params.limit : undefined;
              const transactionIds = Array.isArray(params.transactionIds)
                ? (params.transactionIds as string[]).slice(0, MAX_DAPP_SCAN_PAGE_SIZE)
                : undefined;
              const found = await account.scanForResourceUtxos(resourceAddress, { maxPages, pageSize, limit, transactionIds });
              // Same reasoning as tari_scanForPrivatePayments above: a scan that discovers real
              // outputs must be reflected in the wallet's own view, not only handed to the dApp.
              storeRef.current.refreshL2();
              return { result: { claimed: found.length, found } };
            }
            case "tari_claimPrivatePayment": {
              const result = await account.claimPrivatePayment(String(params.resourceAddress ?? ""), String(params.commitment ?? ""));
              storeRef.current.refreshL2();
              return { result };
            }
          }
        } catch (e) {
          return { error: ERROR.internal(e instanceof Error ? e.message : String(e)) };
        }
      }

      // ---- Transaction requests ---------------------------------------------------------------

      if (REQUEST_METHODS.includes(req.method)) {
        if (!connectedRef.current) return { error: ERROR.unauthorized };
        if (!origin) return { error: ERROR.unauthorized };
        if (!account) return { error: ERROR.internal("No Ootle account in this wallet") };

        if (req.method === "tari_createTransactionRequest") {
          let operation;
          try {
            operation = parseOperation(params);
          } catch (e) {
            // Rejected before the user ever sees it: showing an approval assembled from missing
            // fields would ask someone to authorise a description that isn't the transaction.
            return { error: ERROR.internal(e instanceof Error ? e.message : String(e)) };
          }
          const fmt = approvalFormatter(s.l2.balances);
          const summary = describeOperation(operation, fmt);
          const requestId = createRequest(origin, operation, summary.join(" · "));
          const previewer = async () => {
            const raw = await previewOperation(account, operation);
            if (!raw) return null;
            if (raw.htlc?.value != null) setPreviewedHtlcValue(requestId, raw.htlc.value.toString());
            return previewLines(raw, approvalFormatter(storeRef.current.l2.balances));
          };
          // Absent for `redeemStealthOutputWithPrivateFee`, which has no `feeType` field (already
          // always private). Otherwise seeded from the dApp's own `feeType` hint if it gave one,
          // else this wallet's own default -- `enforced` locks the dialog's toggle instead of
          // letting the user change it (parseOperation already required `feeType` be set whenever
          // `enforceFeeType` is).
          const feeChoice =
            operation.kind === "redeemStealthOutputWithPrivateFee"
              ? undefined
              : {
                  enforced: operation.enforceFeeType === true,
                  initial: operation.feeType ?? storeRef.current.feePrivacyDefault,
                };
          // Deliberately not awaited. `create` answers with the id straight away so a dApp that
          // reloads while the user is deciding can still find the request; awaiting here would put
          // the whole flow back inside one promise that a reload destroys.
          void askUser(requestId, req.method, params, { summary, feeChoice, previewer }).then((approved) =>
            recordDecision(requestId, approved, feeChoice ? feeTypeChoiceRef.current ?? feeChoice.initial : undefined),
          );
          return { result: { requestId } };
        }

        if (req.method === "tari_getTransactionRequest") {
          const record = getRecord(origin, String(params.requestId ?? ""));
          if (!record) return { error: ERROR.internal("Unknown transaction request.") };
          return { result: summarize(record) };
        }

        // tari_submitTransactionRequest
        const claim = claimForSubmit(origin, String(params.requestId ?? ""));
        if (!claim.claimed) return { error: ERROR.internal(claim.reason) };
        try {
          const op = claim.record.operation as { kind?: string };
          const result = await withL2Log(s.l2.identity?.address, { kind: "dapp", counterparty: origin ?? undefined, note: op.kind }, () =>
            executeOperation(account, claim.record.operation, { previewedHtlcValue: claim.record.previewedHtlcValue }),
          );
          settle(claim.record.id, { result });
          storeRef.current.refreshL2();
          return { result };
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          settle(claim.record.id, { error: message });
          return { error: ERROR.internal(message) };
        }
      }

      if (SIGNING_METHODS.includes(req.method)) {
        if (!connectedRef.current) return { error: ERROR.unauthorized };
        if (!account) return { error: ERROR.internal("No Ootle account in this wallet") };
        const instructions = Array.isArray(params.instructions) ? params.instructions : [];
        const maxFee = params.maxFee ? BigInt(String(params.maxFee)) : undefined;
        const inputs = params.inputs as never[] | undefined;

        // A dry run spends nothing — it is how a dApp prices a quote. Prompting per keystroke
        // would make that unusable, so only a real submission asks.
        if (params.dryRun) {
          try {
            return {
              result: await account.execute(instructions as never[], { maxFee, dryRun: true, inputs }),
            };
          } catch (e) {
            return { error: ERROR.internal(e instanceof Error ? e.message : String(e)) };
          }
        }

        let summary;
        try {
          summary = describeRequest(req.method, params, approvalFormatter(s.l2.balances));
        } catch (e) {
          return { error: ERROR.internal(e instanceof Error ? e.message : String(e)) };
        }
        const asOperation: TransactionRequestOperation = {
          kind: "instructions",
          instructions,
          maxFee: params.maxFee !== undefined ? String(params.maxFee) : undefined,
          inputs,
        };
        const previewer = async () => {
          const raw = await previewOperation(account, asOperation);
          return raw ? previewLines(raw, approvalFormatter(storeRef.current.l2.balances)) : null;
        };
        const approved = await askUser(req.id, req.method, params, { summary, previewer });
        if (!approved) return { error: ERROR.rejected };
        try {
          const result = await withL2Log(s.l2.identity?.address, { kind: "dapp", counterparty: origin ?? undefined, note: "instructions" }, () =>
            account.execute(instructions as never[], { maxFee, inputs }),
          );
          storeRef.current.refreshL2();
          return { result };
        } catch (e) {
          return { error: ERROR.internal(e instanceof Error ? e.message : String(e)) };
        }
      }

      // GGBP-1 v3 balance proofs over this wallet's L1 outputs (experimental). Every secret and every
      // signed byte stays in the wasm; this side checks the site, the clock, the lock and the
      // limits, and shows the user exactly which outputs would be disclosed.
      if (req.method === "tari_getBalanceProofSubject" || req.method === "tari_requestBalanceProof") {
        if (!connectedRef.current || !origin) return { error: ERROR.unauthorized };
        const capability = ggbp1Capability(s.network, !!s.wallet?.canSpend);
        if (!capability || !s.network) return { error: ERROR.unsupported(req.method) };
        const wallet = s.wallet;
        if (!wallet || s.walletLocked) return { error: ERROR.internal("The wallet is locked.") };

        if (req.method === "tari_getBalanceProofSubject") {
          const approved = await askUser(req.id, req.method, params, {
            tone: "proof",
            title: t("frame.askProofKey"),
            approveLabel: t("frame.shareProofKey"),
          });
          if (!approved) return { error: ERROR.rejected };
          const current = storeRef.current.wallet;
          if (!current || storeRef.current.walletLocked) return { error: ERROR.internal("The wallet is locked.") };
          try {
            return {
              result: {
                protocol: "ggbp1",
                version: 3,
                network: capability.network,
                genesisHash: GGBP1_GENESIS_HASH[capability.network],
                originHash: ggbp1OriginHash(origin),
                subjectPublicKey: current.ggbp1SubjectPublicKey(origin),
                commitmentGeneratorFingerprint: ggbp1GeneratorFingerprint(),
              },
            };
          } catch (e) {
            return { error: ERROR.internal(e instanceof Error ? e.message : String(e)) };
          }
        }

        if (params.protocol !== "ggbp1" || params.version !== 3) {
          return { error: ERROR.internal('Only { protocol: "ggbp1", version: 3 } is supported.') };
        }
        const challenge = fromBase64Url(String(params.challenge ?? ""));
        if (!challenge || challenge.length !== GGBP1_CHALLENGE_BYTES) {
          return { error: ERROR.internal("challenge must be the 223-byte GGBP-1 v3 challenge, base64url without padding.") };
        }
        // A request from a tab the user is not looking at is refused, not queued.
        if (document.visibilityState !== "visible") return { error: ERROR.rejected };
        const releaseSlot = takeRequestSlot(origin);
        if (!releaseSlot) return { error: ERROR.rejected };
        let request: WasmGgbp1Request | null = null;
        let releaseLease: (() => Promise<void>) | null = null;
        try {
          const tip = s.tipHeight;
          if (tip === null) return { error: ERROR.internal("The wallet does not know the chain tip yet. Try again shortly.") };
          try {
            request = wallet.ggbp1Request(origin, challenge, BigInt(Math.floor(Date.now() / 1000)));
          } catch (e) {
            // About the challenge itself (wrong site, network, subject, expired): safe to explain.
            return { error: ERROR.internal(e instanceof Error ? e.message : String(e)) };
          }
          const leased = leasedOutputIds(s.network);
          for (const u of s.utxos) {
            if (!u.minedHeight || leased.has(u.id) || !isSpendable(u, tip)) continue;
            const handle = s.getHandle(u.id);
            if (handle) request.addCandidate(handle, BigInt(u.minedHeight));
          }
          let preview: Ggbp1Preview | null = null;
          try {
            preview = JSON.parse(request.prepare(BigInt(tip), BigInt(GGBP1_MIN_CONFIRMATIONS))) as Ggbp1Preview;
          } catch {
            preview = null;
          }
          if (!preview) {
            // The user is told why; the site only ever sees the same "rejected" as a refusal, so it
            // cannot tell "not enough" from "no".
            await askUser(req.id, req.method, params, {
              tone: "proof",
              blocked: true,
              summary: [t("frame.ggbp1CannotProve")],
            });
            return { error: ERROR.rejected };
          }
          releaseLease = await leaseOutputs(
            s.network,
            preview.outputs.map((o) => o.commitment),
            req.id,
            origin,
            preview.expiresAt * 1000,
          );
          if (!releaseLease) return { error: ERROR.rejected };
          const approved = await askUser(req.id, req.method, params, {
            tone: "proof",
            summary: previewSummary(preview),
            notice: t("frame.ggbp1Linkability"),
          });
          if (!approved) return { error: ERROR.rejected };
          // Re-check everything that could have changed while the dialog was open.
          const now = storeRef.current;
          if (!connectedRef.current) return { error: ERROR.unauthorized };
          if (document.visibilityState !== "visible" || now.walletLocked || now.wallet !== wallet) {
            return { error: ERROR.rejected };
          }
          const stillSpendable = preview.outputs.every((o) => {
            const u = now.utxos.find((x) => x.id === o.commitment);
            return !!u && isSpendable(u, now.tipHeight);
          });
          if (!stillSpendable) return { error: ERROR.internal("One of those outputs was spent meanwhile. Ask again.") };
          const consumed = request;
          request = null; // approve() consumes it
          const response = consumed.approve(BigInt(Math.floor(Date.now() / 1000)));
          return { result: { protocol: "ggbp1", version: 3, response: toBase64Url(response) } };
        } catch (e) {
          return { error: ERROR.internal(e instanceof Error ? e.message : String(e)) };
        } finally {
          request?.free();
          if (releaseLease) await releaseLease();
          releaseSlot();
        }
      }

      // Named by the extension but not implemented here. `tari_getCapabilities` reports each of
      // these as false, so a dApp can find out without provoking a failure.
      return { error: ERROR.unsupported(req.method) };
    },
    [askUser, origin],
  );

  useEffect(() => {
    if (!origin || sameOrigin) return;
    const onMessage = (event: MessageEvent) => {
      // Both checks matter: the origin alone would accept a message from any other frame or tab
      // on that origin, and the source alone would accept this frame after it navigated somewhere
      // else entirely.
      if (event.source !== frameRef.current?.contentWindow) return;
      if (event.origin !== origin) return;
      if (!isBridgeRequest(event.data)) return;
      // A throw anywhere in handle() (e.g. describeOperation rejecting malformed follow-up
      // instructions) must still answer the dApp, not leave its request pending forever.
      void handle(event.data)
        .catch((e: unknown) => ({ error: ERROR.internal(e instanceof Error ? e.message : String(e)) }))
        .then((payload) => reply(event.data.id, payload));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [origin, sameOrigin, handle, reply]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    // The page behind must not scroll while the dApp owns the whole viewport.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [expanded]);

  // A site that refuses to be framed produces no error a parent can catch — the load event simply
  // never brings anything usable. A timeout is the only signal available.
  useEffect(() => {
    const timer = setTimeout(() => setBlocked((b) => (loaded ? b : true)), 4000);
    return () => clearTimeout(timer);
  }, [loaded]);

  const body = (
    <div
      className={
        expanded
          ? "fixed inset-0 z-[200] flex min-h-0 flex-col"
          : "flex h-full min-h-0 flex-col"
      }
      style={expanded ? { background: "var(--tari-bg-panel)" } : undefined}
    >
      <div
        className="flex flex-wrap items-center gap-2 border-b px-3 py-2"
        style={{ borderColor: "var(--tari-border)" }}
      >
        <span className="truncate text-sm font-bold text-[var(--tari-text)]">{name}</span>
        <span className="truncate font-mono text-[11px] text-[var(--tari-text-dim)]">
          {hostOf(url)}
        </span>
        {connected ? (
          <Badge tone="green">
            <ShieldCheck size={11} /> {t("frame.connected")}
          </Badge>
        ) : (
          <Badge tone="slate">{t("frame.notConnected")}</Badge>
        )}
        {/* Shown only when granted. A site without it is the ordinary case and needs no label; a
            site that can read the private balance is exactly what this chrome exists to make
            visible, and the wallet's own header is somewhere the dApp cannot paint over. */}
        {viewAccess && (
          <Badge tone="amber">
            <Eye size={11} /> {t("frame.seesPrivate")}
          </Badge>
        )}
        <span className="ml-auto flex items-center gap-2">
          {viewAccess && (
            <Button
              size="sm"
              variant="ghost"
              title={t("frame.revokeViewTitle")}
              onClick={() => {
                // Offered separately from Disconnect: wanting a dApp to keep working while it stops
                // reading your confidential position is a reasonable thing to want, and folding the
                // two together would make the only way to get it a full teardown.
                if (origin) revokeViewAccess(origin);
                setViewAccess(false);
              }}
            >
              {t("frame.revokeView")}
            </Button>
          )}
          {connected && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (origin) {
                  revokeConnection(origin);
                  forgetOrigin(origin);
                }
                setConnected(false);
                setViewAccess(false);
                emitEvent("accountsChanged", []);
              }}
            >
              {t("frame.disconnect")}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setExpanded((e) => !e)}
            title={expanded ? t("frame.exitFullTitle") : t("frame.full")}
            aria-label={expanded ? t("frame.exitFull") : t("frame.full")}
          >
            {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
          >
            <ExternalLink size={13} /> {t("frame.tab")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label={t("frame.closeDapp")}>
            <X size={14} />
          </Button>
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        {sameOrigin ? (
          <div className="absolute inset-0 grid place-items-center p-6 text-center" style={{ background: "var(--tari-bg-panel)" }}>
            <div>
              <ShieldAlert size={22} className="mx-auto mb-2 text-[var(--st-amber)]" />
              <p className="font-semibold text-[var(--tari-text)]">{t("frame.sameOrigin")}</p>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-[var(--tari-text-dim)]">
                {t("frame.sameOriginBody", { host: hostOf(url) })}
              </p>
              <Button size="sm" className="mt-4" onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>
                <ExternalLink size={13} /> {t("frame.openInTab")}
              </Button>
            </div>
          </div>
        ) : (
        <iframe
          ref={frameRef}
          src={url}
          title={name}
          onLoad={() => setLoaded(true)}
          // `allow-same-origin` is required, and is not the footgun it looks like here.
          //
          // Without it the frame gets an *opaque* origin: `event.origin` arrives as the string
          // "null", so the origin check below can never match and no message is ever delivered.
          // Worse, "null" is what every sandboxed frame reports, so it could not be used as a
          // security check even if messages did arrive.
          //
          // The usual warning — that `allow-scripts allow-same-origin` lets a frame remove its own
          // sandbox — applies to content served from the *embedder's* origin. This frame is a
          // genuinely foreign origin, so all this does is restore its normal cross-origin identity:
          // it still cannot reach the wallet's DOM or storage, and the origin check becomes
          // meaningful. Isolation here comes from the dApp being a different origin, not from the
          // sandbox attribute.
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"
          // `strict-origin`, not `no-referrer`: this wallet's own trust check never reads
          // `document.referrer` (see the message handler below — it checks `event.source` and
          // `event.origin` on incoming requests), so `no-referrer` bought nothing here. It did cost
          // something: a `tari-connector.js` that hardens itself by checking `document.referrer`
          // against this site's known origin (a reasonable thing for a dApp to do, and one real
          // vendored copy in the wild already does) sees an empty referrer under `no-referrer` and
          // concludes it isn't embedded at all, so every request rejects with "wallet unavailable"
          // even though it plainly is. `strict-origin` sends only the bare origin (no path, no
          // query, nothing session-specific) on same-scheme navigations, which the dApp could
          // already infer from the connector script's own documented src URL, so this leaks nothing
          // new.
          referrerPolicy="strict-origin"
          className="h-full w-full border-0 bg-white"
        />
        )}

        {blocked && !loaded && !sameOrigin && (
          <div
            className="absolute inset-0 grid place-items-center p-6 text-center"
            style={{ background: "var(--tari-bg-panel)" }}
          >
            <div>
              <ShieldAlert size={22} className="mx-auto mb-2 text-[var(--st-amber)]" />
              <p className="font-semibold text-[var(--tari-text)]">{t("frame.refusesEmbed")}</p>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-[var(--tari-text-dim)]">
                {t("frame.refusesEmbedBody", { host: hostOf(url) })}
              </p>
              <Button
                size="sm"
                className="mt-4"
                onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
              >
                <ExternalLink size={13} /> {t("frame.openInTab")}
              </Button>
            </div>
          </div>
        )}

        {approval && (
          <div className="absolute inset-0 grid place-items-center bg-black/50 p-4 backdrop-blur-sm">
            <div
              className="w-full max-w-sm rounded-2xl border p-5 shadow-xl"
              style={{ borderColor: "var(--tari-border)", background: "var(--tari-bg-panel)" }}
            >
              <p className="text-sm font-bold text-[var(--tari-text)]">
                {approval.title ??
                  (approval.tone === "connect"
                  ? t("frame.askConnect")
                  : approval.tone === "view"
                    ? t("frame.askView")
                    : approval.tone === "network"
                      ? t("frame.askSwitchNetwork")
                      : approval.tone === "proof"
                        ? t("frame.askProof")
                        : t("frame.askApprove"))}
              </p>
              <p className="mt-1 font-mono text-[11px] break-all text-[var(--tari-text-dim)]">
                {origin}
              </p>
              <ul className="mt-4 space-y-1.5">
                {approval.summary.map((line, i) => (
                  <li
                    key={i}
                    className="flex gap-2 text-xs leading-relaxed text-[var(--tari-text)]"
                  >
                    <span className="text-[var(--tari-text-dim)]">•</span>
                    <span className="min-w-0 break-words">{line}</span>
                  </li>
                ))}
              </ul>
              {approval.preview && (
                <div className="mt-4 rounded-xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] p-2.5">
                  <p className="mb-1.5 text-[11px] font-semibold text-[var(--tari-text-dim)]">{t("frame.previewTitle")}</p>
                  {approval.preview === "loading" ? (
                    <p className="text-xs text-[var(--tari-text-dim)]">{t("frame.previewLoading")}</p>
                  ) : (
                    <>
                      {approval.preview.lines.map((line, i) => (
                        <p key={i} className="text-xs leading-relaxed text-[var(--tari-text)]">
                          {line}
                        </p>
                      ))}
                      {approval.preview.warnings.map((line, i) => (
                        <p key={`w${i}`} className="mt-1 text-xs leading-relaxed text-[var(--st-amber)]">
                          {line}
                        </p>
                      ))}
                    </>
                  )}
                </div>
              )}
              {approval.feeChoice && (
                <div className="mt-4 rounded-xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] p-2.5">
                  <p className="mb-1.5 text-[11px] font-semibold text-[var(--tari-text-dim)]">{t("frame.feePayment")}</p>
                  {approval.feeChoice.enforced ? (
                    <p className="text-xs text-[var(--tari-text)]">
                      {t("frame.feeEnforced", {
                        kind: approval.feeChoice.initial === "private" ? t("frame.feePrivate") : t("frame.feeTransparent"),
                      })}
                    </p>
                  ) : (
                    <Switch
                      checked={feeTypeDisplay === "private"}
                      onChange={(v) => {
                        const next = v ? "private" : "transparent";
                        feeTypeChoiceRef.current = next;
                        setFeeTypeDisplay(next);
                      }}
                      offLabel={t("frame.transparent")}
                      onLabel={t("frame.private")}
                    />
                  )}
                </div>
              )}
              {/* The spend warning is shown only where it is true. A permission grant moves no
                  funds, and putting "this spends real funds" on one would be both wrong and
                  corrosive — a warning that appears on everything gets read as decoration by the
                  time it appears on something that matters. */}
              {approval.tone === "spend" && (
                <p className="mt-4 rounded-xl border border-[var(--st-amber)]/30 bg-[var(--st-amber)]/10 p-2.5 text-[11px] leading-relaxed text-[var(--tari-text)]">
                  {t("frame.spendWarning")}
                </p>
              )}
              {approval.tone === "view" && (
                <p className="mt-4 rounded-xl border border-[var(--st-amber)]/30 bg-[var(--st-amber)]/10 p-2.5 text-[11px] leading-relaxed text-[var(--tari-text)]">
                  {t("frame.viewWarning")}
                </p>
              )}
              {approval.tone === "proof" && !approval.blocked && (
                <p className="mt-4 rounded-xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] p-2.5 text-[11px] leading-relaxed text-[var(--tari-text)]">
                  {t("frame.ggbp1NothingMoves")}
                </p>
              )}
              {approval.notice && (
                <p className="mt-4 rounded-xl border border-[var(--st-amber)]/30 bg-[var(--st-amber)]/10 p-2.5 text-[11px] leading-relaxed text-[var(--tari-text)]">
                  {approval.notice}
                </p>
              )}
              <div className="mt-4 flex gap-2.5">
                {!approval.blocked && (
                  <Button className="flex-1" disabled={!approveArmed} onClick={() => approveArmed && approval.decide(true)}>
                    {approval.approveLabel ??
                      (approval.tone === "connect"
                      ? t("frame.connect")
                      : approval.tone === "view"
                        ? t("frame.showBalance")
                        : approval.tone === "network"
                          ? t("frame.switchNetwork")
                          : approval.tone === "proof"
                            ? t("frame.proveBalance")
                            : t("frame.approve"))}
                  </Button>
                )}
                <Button variant="outline" className="flex-1" onClick={() => approval.decide(false)}>
                  {approval.blocked ? t("frame.close") : approval.tone === "spend" ? t("frame.reject") : t("frame.deny")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // Portalled to the body when expanded: the panel this normally lives in sits inside a
  // `-translate-y-1/2` ancestor, and a transformed ancestor becomes the containing block for
  // `position: fixed` — so a fixed overlay rendered in place would be trapped inside the card
  // rather than covering the viewport.
  return expanded ? createPortal(body, document.body) : body;
}

async function accountPayload(account: { getComponentAddress(): Promise<string> } | null) {
  if (!account) return null;
  return { address: await account.getComponentAddress(), layer: "ootle" };
}

function transactionIdOf(result: unknown): string | null {
  if (result && typeof result === "object" && "transaction_id" in result) {
    return String((result as { transaction_id: unknown }).transaction_id);
  }
  return null;
}
