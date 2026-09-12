import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Eye, Maximize2, Minimize2, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useStore } from "../store";
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
} from "../lib/dappBridge";
import {
  claimForSubmit,
  createRequest,
  executeOperation,
  forgetOrigin,
  getRecord,
  parseOperation,
  recordDecision,
  settle,
  summarize,
} from "../lib/dappRequests";
import { hostOf } from "../lib/dapps";
import { Badge, Button } from "./ui";

interface ApprovalState {
  id: string;
  method: BridgeMethod;
  summary: string[];
  /** Which dialog voice to use. "connect" and "view" are permission grants — nothing is spent, so
   * the "this spends real funds" warning would be false and, worse, would train users to ignore it
   * where it is true. "spend" is everything that moves value. */
  tone: "connect" | "view" | "spend";
  decide: (approved: boolean) => void;
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
  const [connected, setConnected] = useState(() => (origin ? isConnected(origin) : false));
  const [viewAccess, setViewAccess] = useState(() => (origin ? hasViewAccess(origin) : false));
  const [approval, setApproval] = useState<ApprovalState | null>(null);
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

  /** Puts a request in front of the user and waits for a verdict. */
  const askUser = useCallback(
    (
      id: string,
      method: BridgeMethod,
      params: Record<string, unknown>,
      options: { tone?: ApprovalState["tone"]; summary?: string[] } = {},
    ) => {
      const answered = promptQueue.current.then(
        () =>
          new Promise<boolean>((resolve) => {
            setApproval({
              id,
              method,
              summary: options.summary ?? describeRequest(method, params),
              tone: options.tone ?? "spend",
              decide: (approved) => {
                setApproval(null);
                resolve(approved);
              },
            });
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
      if (req.method === "tari_getNetwork") return { result: s.network };

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
            return { result: capabilitiesFor(origin) };
          case "tari_getSubstate": {
            const provider = await account.getProvider();
            return {
              result: await provider.getSubstate(
                String(params.substateId ?? ""),
                (params.version as number | null | undefined) ?? null,
              ),
            };
          }
          case "tari_getTransactionResult": {
            const provider = await account.getProvider();
            return { result: await provider.getTransactionResult(String(params.transactionId ?? "")) };
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
              const maxPages = typeof params.maxPages === "number" ? params.maxPages : undefined;
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
              const maxPages = typeof params.maxPages === "number" ? params.maxPages : undefined;
              const pageSize = typeof params.pageSize === "number" ? params.pageSize : undefined;
              const limit = typeof params.limit === "number" ? params.limit : undefined;
              const transactionIds = Array.isArray(params.transactionIds) ? (params.transactionIds as string[]) : undefined;
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
          const summary = describeOperation(operation);
          const requestId = createRequest(origin, operation, summary.join(" · "));
          // Deliberately not awaited. `create` answers with the id straight away so a dApp that
          // reloads while the user is deciding can still find the request; awaiting here would put
          // the whole flow back inside one promise that a reload destroys.
          void askUser(requestId, req.method, params, { summary }).then((approved) => recordDecision(requestId, approved));
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
          const result = await executeOperation(account, claim.record.operation);
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

        const approved = await askUser(req.id, req.method, params);
        if (!approved) return { error: ERROR.rejected };
        try {
          const result = await account.execute(instructions as never[], { maxFee, inputs });
          storeRef.current.refreshL2();
          return { result };
        } catch (e) {
          return { error: ERROR.internal(e instanceof Error ? e.message : String(e)) };
        }
      }

      // Named by the extension but not implemented here. `tari_getCapabilities` reports each of
      // these as false, so a dApp can find out without provoking a failure.
      return { error: ERROR.unsupported(req.method) };
    },
    [askUser, origin],
  );

  useEffect(() => {
    if (!origin) return;
    const onMessage = (event: MessageEvent) => {
      // Both checks matter: the origin alone would accept a message from any other frame or tab
      // on that origin, and the source alone would accept this frame after it navigated somewhere
      // else entirely.
      if (event.source !== frameRef.current?.contentWindow) return;
      if (event.origin !== origin) return;
      if (!isBridgeRequest(event.data)) return;
      void handle(event.data).then((payload) => reply(event.data.id, payload));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [origin, handle, reply]);

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
            <ShieldCheck size={11} /> connected
          </Badge>
        ) : (
          <Badge tone="slate">not connected</Badge>
        )}
        {/* Shown only when granted. A site without it is the ordinary case and needs no label; a
            site that can read the private balance is exactly what this chrome exists to make
            visible, and the wallet's own header is somewhere the dApp cannot paint over. */}
        {viewAccess && (
          <Badge tone="amber">
            <Eye size={11} /> sees private balance
          </Badge>
        )}
        <span className="ml-auto flex items-center gap-2">
          {viewAccess && (
            <Button
              size="sm"
              variant="ghost"
              title="Stop this dApp seeing your private balance, without disconnecting it"
              onClick={() => {
                // Offered separately from Disconnect: wanting a dApp to keep working while it stops
                // reading your confidential position is a reasonable thing to want, and folding the
                // two together would make the only way to get it a full teardown.
                if (origin) revokeViewAccess(origin);
                setViewAccess(false);
              }}
            >
              Revoke view
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
              Disconnect
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setExpanded((e) => !e)}
            title={expanded ? "Exit full screen (Esc)" : "Full screen"}
            aria-label={expanded ? "Exit full screen" : "Full screen"}
          >
            {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
          >
            <ExternalLink size={13} /> Tab
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close dApp">
            <X size={14} />
          </Button>
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
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
          referrerPolicy="no-referrer"
          className="h-full w-full border-0 bg-white"
        />

        {blocked && !loaded && (
          <div
            className="absolute inset-0 grid place-items-center p-6 text-center"
            style={{ background: "var(--tari-bg-panel)" }}
          >
            <div>
              <ShieldAlert size={22} className="mx-auto mb-2 text-[var(--st-amber)]" />
              <p className="font-semibold text-[var(--tari-text)]">This dApp refuses to embed</p>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-[var(--tari-text-dim)]">
                {hostOf(url)} sends <code>X-Frame-Options</code> or a{" "}
                <code>frame-ancestors</code> policy that blocks other sites from framing it. Open it
                in a tab instead — the provider is only available inside the wallet, so it will run
                without one.
              </p>
              <Button
                size="sm"
                className="mt-4"
                onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
              >
                <ExternalLink size={13} /> Open in a tab
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
                {approval.tone === "connect"
                  ? "Connect to this dApp?"
                  : approval.tone === "view"
                    ? "Let this dApp see your private balance?"
                    : "Approve this request?"}
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
              {/* The spend warning is shown only where it is true. A permission grant moves no
                  funds, and putting "this spends real funds" on one would be both wrong and
                  corrosive — a warning that appears on everything gets read as decoration by the
                  time it appears on something that matters. */}
              {approval.tone === "spend" && (
                <p className="mt-4 rounded-xl border border-[var(--st-amber)]/30 bg-[var(--st-amber)]/10 p-2.5 text-[11px] leading-relaxed text-[var(--tari-text)]">
                  This spends real funds. Approve only if you started this action yourself.
                </p>
              )}
              {approval.tone === "view" && (
                <p className="mt-4 rounded-xl border border-[var(--st-amber)]/30 bg-[var(--st-amber)]/10 p-2.5 text-[11px] leading-relaxed text-[var(--tari-text)]">
                  This does not move any funds. It lets the site read what you hold privately, until
                  you revoke it.
                </p>
              )}
              <div className="mt-4 flex gap-2.5">
                <Button className="flex-1" onClick={() => approval.decide(true)}>
                  {approval.tone === "connect" ? "Connect" : approval.tone === "view" ? "Show my balance" : "Approve"}
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => approval.decide(false)}>
                  {approval.tone === "spend" ? "Reject" : "Deny"}
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
