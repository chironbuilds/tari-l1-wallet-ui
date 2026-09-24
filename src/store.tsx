import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  WasmWallet,
  WasmWalletOutput,
  type WasmTariAddress,
} from "@chironbuilder/tari-l1-wasm";
import type { NetworkId } from "./lib/tari";
import {
  scanRange,
  fetchMiddlewareTip,
  findHeightForTimestamp,
  tryImportOutput,
  type ScanOutput,
  type ScanProgress,
} from "./lib/scanner";
import { createDetectPool, type DetectPool } from "./lib/detect-pool";
import { fetchChainTip } from "./lib/explorer";
import { deriveL2Identity, fetchL2Balances, type L2Identity } from "./lib/l2";
import { attributePayment, deriveSubAddress, type SubAddress } from "./lib/subaddress";
import { wipeOotleState, type TokenBalance } from "./ootle";
import { decryptWithPin, encryptWithPin, type EncryptedBlob } from "./lib/pinLock";
import { configureRpcForNetwork, rpcKernelMerkleProof } from "./lib/rpc";
import { CLAIM_RETRY_MS, burnClaimableNow, claimProofFor, isRetryableClaimError, type BurnRecord } from "./lib/burn";

const STORAGE_KEY = "tari-l1-wallet/v1";

export interface UtxoRecord {
  id: string;
  valueMicro: string;
  kind: "demo" | "scanned" | "change";
  createdAt: number;
  /** Height the output becomes spendable at; 0 for ordinary payments, mined + 180 for coinbase. */
  maturityHeight?: number;
  /** Height the output was mined at, when it came from a chain scan. */
  minedHeight?: number;
  /** The sub-address this payment was sent to, read from the sender's memo. */
  paidTo?: string;
  /** The sender's address, when their wallet chose to include it. */
  senderAddress?: string;
  /**
   * Known to exist but not yet spendable by us: change from a broadcast transaction that the
   * scanner has not picked up from a block yet. There is no wallet handle behind it, so it must
   * never be offered for spending.
   */
  pending?: boolean;
  /**
   * The chain data this output was recovered from. A wallet handle cannot be serialised, so this
   * is what lets a reload re-import the output instead of losing the balance until the next full
   * rescan (which a resume-from-last-height scan would never perform).
   */
  raw?: ScanOutput;
}

/**
 * An output cannot be spent until the chain reaches its maturity height — the node rejects the
 * transaction otherwise. Unknown tip means we cannot prove it is spendable yet, so treat any
 * maturity as locked rather than offering coins the node would refuse.
 */
/** Spendable right now: we hold the wallet handle, it is confirmed, and it has matured. */
export function isSpendable(u: UtxoRecord, tipHeight: number | null): boolean {
  return !u.pending && !isLocked(u, tipHeight);
}

export function isLocked(u: UtxoRecord, tipHeight: number | null): boolean {
  const maturity = u.maturityHeight ?? 0;
  if (maturity === 0) return false;
  return tipHeight === null || tipHeight < maturity;
}

export interface TxRecord {
  id: string;
  /** Money in (outputs a scan recovered) or money out (a transaction we signed). Defaults to out. */
  direction?: "in" | "out";
  toBase58: string;
  amountMicro: string;
  feeMicro: string;
  changeMicro: string | null;
  /**
   * "signed" never left this device; "pending" is accepted by a node but not yet in a block;
   * "mined" was seen on chain. ("submitted" is the older spelling of "pending".)
   */
  status: "signed" | "submitted" | "pending" | "mined" | "failed";
  createdAt: number;
  json: string;
  result?: string;
  /** Commitments this transaction spends; seeing them spent on chain is what confirms it. */
  inputCommitments?: string[];
  /** For a receipt: the sub-address(es) the payments were made to, when they carried one. */
  paidTo?: string[];
  /** For a receipt: the sender addresses that identified themselves, when any did. */
  senders?: string[];
  minedHeight?: number;
}

interface Persisted {
  v: 1;
  network: NetworkId;
  /**
   * Only ever written when no PIN has been set on this device (a pre-lock-feature save, or a user
   * who hasn't opted in yet) — kept for backward compatibility. Once `encBackup` exists, this is
   * always null; the seed lives on disk encrypted, never in the clear.
   */
  backupHex: string | null;
  /** The seed, AES-GCM-encrypted with a key derived from the user's PIN. Null until a PIN is set. */
  encBackup?: EncryptedBlob | null;
  /** Public address, kept out of band from the secret so the lock screen can show "this wallet" without decrypting anything. */
  publicAddressBase58?: string;
  utxos: UtxoRecord[];
  history: TxRecord[];
  nodeUrl: string;
  scannerUrl: string;
  scanThreads: number;
  birthdayMs: number | null;
  lastScannedHeight: number | null;
  autoLockMinutes?: number;
  /** Default fee-payment type for L2/Ootle transactions when a connected dApp doesn't enforce
   * one. "transparent" (unchanged behavior) unless the user opts in to "private". */
  feePrivacyDefault?: "private" | "transparent";
  subAddresses?: SubAddress[];
  /**
   * Chain output hash -> commitment, for outputs this wallet has spent.
   *
   * The query service names a spend by the hash of the output consumed, and the only thing that
   * can translate that back to a commitment is the handle we held — which `spendInputs` frees at
   * send time, long before the spend appears in a block. Without this, a broadcast transaction can
   * never be recognised as mined and stays "pending" forever. Persisted because that wait normally
   * spans a reload.
   */
  spentHashes?: Record<string, string>;
  /** Burns to Ootle, tracked from broadcast through to the claim. */
  burns?: BurnRecord[];
}

function loadPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Persisted;
    if (p.v !== 1) return null;
    return p;
  } catch {
    return null;
  }
}

interface AddressInfo {
  base58: string;
  emoji: string;
  hex: string;
  network: string;
  isDual: boolean;
  features: string[];
}

/** Which layer the wallet is currently showing. Both are derived from the same seed. */
export type Layer = "L1" | "L2";

export interface L2State {
  identity: L2Identity | null;
  balances: TokenBalance[];
  loading: boolean;
  /** Set when the indexer is unreachable — never conflated with "this account has no funds". */
  error: string | null;
}

interface Store {
  ready: boolean;
  wallet: WasmWallet | null;
  network: NetworkId | null;
  backupHex: string | null;
  addressInfo: AddressInfo | null;
  utxos: UtxoRecord[];
  totalMicro: bigint;
  unlockedMicro: bigint;
  lockedMicro: bigint;
  pendingMicro: bigint;
  tipHeight: number | null;
  history: TxRecord[];
  nodeUrl: string;
  scannerUrl: string;
  scanThreads: number;
  setScanThreads: (n: number) => void;
  subAddresses: SubAddress[];
  addSubAddress: (label: string) => string | null;
  removeSubAddress: (label: string) => void;
  /**
   * The address currently being presented for receiving — null means the wallet's main address.
   * Purely a display choice: every sub-address shares this wallet's keys, so the balance, the
   * history and everything spendable are identical whichever is selected.
   */
  activeSubAddress: string | null;
  setActiveSubAddress: (label: string | null) => void;
  layer: Layer;
  setLayer: (layer: Layer) => void;
  /** The layer a switch is moving to while its transition plays, or null when settled. */
  pendingLayer: Layer | null;
  /** Starts a layer switch. The change itself commits when the transition finishes. */
  requestLayer: (layer: Layer) => void;
  l2: L2State;
  refreshL2: () => void;
  /** Rediscovers shielded outputs by scanning the chain; returns how many it claimed. */
  scanL2PrivateFunds: () => Promise<number>;
  scan: ScanProgress | null;
  birthdayMs: number | null;
  lastScannedHeight: number | null;
  setWalletBirthday: (birthdayMs: number) => void;
  createWallet: (network: NetworkId, pin: string) => Promise<void>;
  restoreWallet: (backupHex: string, network: NetworkId, pin: string) => Promise<string | null>;
  forget: () => void;
  /** True once this device has a PIN set — i.e. the seed is encrypted at rest and `lock()` works. */
  hasPin: boolean;
  /** True while a PIN-protected wallet exists on disk but hasn't been decrypted this session. */
  walletLocked: boolean;
  /** The address to show on the lock screen, read from the unencrypted persisted record. */
  lockedAddressHint: string | null;
  /** Hides the wallet and frees its key material from memory; a no-op until a PIN is set. */
  lock: () => void;
  /** Decrypts the seed with `pin` and restores the wallet. Returns false on a wrong PIN. */
  unlock: (pin: string) => Promise<boolean>;
  /** Opts an unencrypted (legacy or never-secured) wallet into PIN protection. */
  setPin: (pin: string) => Promise<void>;
  changePin: (oldPin: string, newPin: string) => Promise<boolean>;
  /** Checks `pin` against the encrypted seed without touching wallet state. False if no PIN is set. */
  verifyPin: (pin: string) => Promise<boolean>;
  autoLockMinutes: number;
  setAutoLockMinutes: (minutes: number) => void;
  /** See `Persisted.feePrivacyDefault`'s doc comment. */
  feePrivacyDefault: "private" | "transparent";
  setFeePrivacyDefault: (v: "private" | "transparent") => void;
  fundDemo: (valueMicro: bigint) => void;
  addScannedOutput: (handle: WasmWalletOutput, minedHeight: number, maturityHeight: number, raw?: ScanOutput) => void;
  getHandle: (id: string) => WasmWalletOutput | undefined;
  setScannerUrl: (url: string) => void;
  startScan: (from: number, to: number) => void;
  stopScan: () => void;
  spendInputs: (consumedIds: string[], changeMicro: bigint, changeCommitmentHex: string | null) => void;
  removeSpent: (commitments: string[]) => void;
  notifyNewBlock: (height: number) => void;
  markMinedBySpentInputs: (commitments: string[], height: number | null) => void;
  addTx: (rec: TxRecord) => void;
  updateTx: (id: string, patch: Partial<TxRecord>) => void;
  clearHistory: () => void;
  setNodeUrl: (url: string) => void;
  burns: BurnRecord[];
  addBurn: (rec: BurnRecord) => void;
  updateBurn: (id: string, patch: Partial<BurnRecord>) => void;
  /** Claims a mined burn into this wallet's Ootle account now, rather than waiting for the retry. */
  claimBurnNow: (id: string) => Promise<void>;
  /** This wallet's Ootle account public key — the claim key its own burns are addressed to. */
  ootleClaimPublicKey: () => Promise<string>;
}

const StoreCtx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(StoreCtx);
  if (!s) throw new Error("StoreProvider missing");
  return s;
}

function describe(addr: WasmTariAddress): AddressInfo {
  return {
    base58: addr.toBase58(),
    emoji: addr.toEmoji(),
    hex: addr.toHex(),
    network: addr.network,
    isDual: !addr.isSingle && addr.viewKeyHex !== undefined,
    features: addr.features,
  };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [wallet, setWallet] = useState<WasmWallet | null>(null);
  const [network, setNetwork] = useState<NetworkId | null>(null);
  const [backupHex, setBackupHex] = useState<string | null>(null);
  const [encBackup, setEncBackup] = useState<EncryptedBlob | null>(null);
  const [walletLocked, setWalletLocked] = useState(false);
  const [lockedAddressHint, setLockedAddressHint] = useState<string | null>(null);
  const [autoLockMinutes, setAutoLockMinutesState] = useState(5);
  const [feePrivacyDefault, setFeePrivacyDefaultState] = useState<"private" | "transparent">("transparent");
  // Stashes the just-loaded persisted record while locked, so unlock() can finish the restore the
  // mount effect deferred instead of re-reading (and re-trusting) localStorage a second time.
  const pendingPersistedRef = useRef<Persisted | null>(null);
  const [addressInfo, setAddressInfo] = useState<AddressInfo | null>(null);
  const [utxos, setUtxos] = useState<UtxoRecord[]>([]);
  const [history, setHistory] = useState<TxRecord[]>([]);
  const [nodeUrl, setNodeUrlState] = useState("");
  const [scanThreads, setScanThreadsState] = useState(10);
  const [scannerUrl, setScannerUrlState] = useState(
    import.meta.env.PROD && typeof window !== "undefined"
      ? `${window.location.origin}/api`
      : "http://127.0.0.1:8080/api",
  );
  const [scan, setScan] = useState<ScanProgress | null>(null);
  const [birthdayMs, setBirthdayMsState] = useState<number | null>(null);
  const [lastScannedHeight, setLastScannedHeight] = useState<number | null>(null);
  const [tipHeight, setTipHeight] = useState<number | null>(null);
  const [subAddresses, setSubAddresses] = useState<SubAddress[]>([]);
  const [activeSubAddress, setActiveSubAddressState] = useState<string | null>(null);
  // Read from inside the scan callback, which is created once per scan and would otherwise close
  // over a stale list.
  const subAddressesRef = useRef<SubAddress[]>([]);
  const [layer, setLayerState] = useState<Layer>("L1");
  const [pendingLayer, setPendingLayer] = useState<Layer | null>(null);
  const [burns, setBurns] = useState<BurnRecord[]>([]);
  const [l2, setL2] = useState<L2State>({ identity: null, balances: [], loading: false, error: null });
  const stopRef = useRef(false);
  // `scan` keeps the *last* progress object after a scan finishes, so it can never stand in for
  // "a scan is running". These refs carry the live values into the polling closure below.
  const scanningRef = useRef(false);
  // Change coming back to us is not income — it is the remainder of our own spend — so it is kept
  // out of the received totals and the incoming activity entries.
  const ownChangeRef = useRef(new Set<string>());
  // Every commitment this wallet has ever controlled, including ones it has already spent. Spending
  // drops the handle, so `handles` alone forgets — and a block we spent in then stops looking like
  // our own transaction, which is what made our own payments come back as income.
  const everOwnedRef = useRef(new Set<string>());
  /** See `Persisted.spentHashes`: outlives the handle so a spend can still be attributed. */
  const spentHashRef = useRef(new Map<string, string>());
  const lastScannedRef = useRef<number | null>(null);

  const handles = useRef(new Map<string, WasmWalletOutput>());

  // Shared by the mount-time restore and by unlock(): re-derives every wallet handle from the
  // chain data each UTXO record carries, since a handle itself cannot be persisted or survive a
  // lock. Anything we cannot rebuild (no raw chain data, e.g. this session's demo outputs) is
  // dropped or marked pending exactly as a plain reload already does today.
  const reconstructWalletState = (w: WasmWallet, hex: string, srcUtxos: UtxoRecord[], srcHistory: TxRecord[]) => {
    const restored: UtxoRecord[] = [];
    const isCommitmentId = (id: string) => /^[0-9a-f]{64}$/i.test(id);
    for (const u of srcUtxos) {
      if (u.kind === "demo") continue;
      if (!u.raw && !isCommitmentId(u.id)) continue;
      if (u.raw) {
        const { handle } = tryImportOutput(w, u.raw);
        if (handle) {
          handles.current.set(u.id, handle);
          restored.push({ ...u, pending: false });
          continue;
        }
      }
      restored.push({ ...u, pending: true });
    }
    for (const u of restored) {
      everOwnedRef.current.add(u.id.toLowerCase());
      if (u.kind === "change") ownChangeRef.current.add(u.id.toLowerCase());
    }
    for (const t of srcHistory) {
      for (const c of t.inputCommitments ?? []) everOwnedRef.current.add(c.toLowerCase());
    }
    setWallet(w);
    setBackupHex(hex);
    setAddressInfo(describe(w.getAddress()));
    setUtxos(restored);
  };

  useEffect(() => {
    try {
      const p = loadPersisted();
      if (p) {
        setHistory(p.history ?? []);
        setNodeUrlState(p.nodeUrl ?? "");
        if (p.scannerUrl) setScannerUrlState(p.scannerUrl);
        if (p.scanThreads) setScanThreadsState(p.scanThreads);
        if (p.birthdayMs) setBirthdayMsState(p.birthdayMs);
        if (p.lastScannedHeight) setLastScannedHeight(p.lastScannedHeight);
        if (p.subAddresses) setSubAddresses(p.subAddresses);
        if (p.autoLockMinutes !== undefined) setAutoLockMinutesState(p.autoLockMinutes);
        if (p.feePrivacyDefault !== undefined) setFeePrivacyDefaultState(p.feePrivacyDefault);
        if (p.spentHashes) {
          for (const [hash, commitment] of Object.entries(p.spentHashes)) {
            spentHashRef.current.set(hash.toLowerCase(), commitment.toLowerCase());
          }
        }
        if (p.burns) setBurns(p.burns);
        if (p.network) {
          configureRpcForNetwork(p.network);
          setNetwork(p.network);
        }
        if (p.encBackup && p.network) {
          // A PIN has been set on this device: the seed only exists on disk encrypted, so the
          // wallet stays locked until unlock() supplies the PIN to decrypt it.
          setEncBackup(p.encBackup);
          setLockedAddressHint(p.publicAddressBase58 ?? null);
          pendingPersistedRef.current = p;
          setWalletLocked(true);
        } else if (p.backupHex && p.network) {
          // No PIN set yet on this device (an older save, or a user who hasn't opted in) — same
          // zero-friction boot as before the lock feature existed.
          try {
            const w = WasmWallet.fromBackupHex(p.backupHex, p.network);
            reconstructWalletState(w, p.backupHex, p.utxos ?? [], p.history ?? []);
          } catch (e) {
            // Never erase the saved wallet here: a failure to rebuild it (wasm not ready after a hot
            // reload, a transient error) says nothing about whether the seed is good, and deleting it
            // is unrecoverable for anyone without their phrase. Only forget() removes it.
            console.error("Failed to restore saved wallet; leaving it on disk untouched", e);
          }
        }
      }
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!ready || walletLocked) return;
    const p: Persisted = {
      v: 1,
      network: (network ?? "mainnet") as NetworkId,
      backupHex: encBackup ? null : backupHex,
      encBackup,
      publicAddressBase58: addressInfo?.base58,
      autoLockMinutes,
      feePrivacyDefault,
      utxos,
      history,
      subAddresses,
      nodeUrl,
      scannerUrl,
      scanThreads,
      birthdayMs,
      lastScannedHeight,
      spentHashes: Object.fromEntries(spentHashRef.current),
      burns,
    };
    // No wallet in memory is not a reason to delete the saved one: it may simply have failed to
    // load. Erasing is forget()'s job alone.
    if (!backupHex && !encBackup) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    } catch {
      /* storage full or blocked */
    }
  }, [
    ready,
    walletLocked,
    network,
    backupHex,
    encBackup,
    addressInfo,
    autoLockMinutes,
    feePrivacyDefault,
    utxos,
    history,
    subAddresses,
    nodeUrl,
    scannerUrl,
    scanThreads,
    birthdayMs,
    lastScannedHeight,
    burns,
  ]);

  const setWalletBirthday = useCallback((ms: number) => {
    setBirthdayMsState(ms);
    setLastScannedHeight(null);
  }, []);

  const createWallet = useCallback(async (net: NetworkId, pin: string) => {
    configureRpcForNetwork(net);
    const w = new WasmWallet(net);
    handles.current.clear();
    const hex = w.getBackupHex();
    const enc = await encryptWithPin(hex, pin);
    setWallet(w);
    setNetwork(net);
    setBackupHex(hex);
    setEncBackup(enc);
    setWalletLocked(false);
    setAddressInfo(describe(w.getAddress()));
    setUtxos([]);
    setHistory([]);
    setBurns([]);
    setLayerState("L1");
    setPendingLayer(null);
    setL2({ identity: null, balances: [], loading: false, error: null });
    // A wallet created here is born now, so no block before this moment can hold its outputs.
    // Recording that is what lets the auto-scan run at all: the birthday is the only thing that
    // says where a wallet's history begins, and a wallet without one used to get no automatic
    // scanning whatsoever — not even tip polling.
    setBirthdayMsState(Date.now());
    setLastScannedHeight(null);
  }, []);

  const restoreWallet = useCallback(
    async (hex: string, net: NetworkId, pin: string): Promise<string | null> => {
      let w: WasmWallet;
      const trimmed = hex.trim();
      configureRpcForNetwork(net);
      try {
        w = WasmWallet.fromBackupHex(trimmed, net);
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
      const enc = await encryptWithPin(trimmed, pin);
      handles.current.clear();
      setWallet(w);
      setNetwork(net);
      setBackupHex(trimmed);
      setEncBackup(enc);
      setWalletLocked(false);
      setAddressInfo(describe(w.getAddress()));
      setUtxos([]);
      setHistory([]);
      setBurns([]);
      // The cursor belongs to whichever wallet was here before; keeping it would skip straight
      // past this wallet's own history. Seed restores set a birthday right after this returns.
      setLastScannedHeight(null);
      return null;
    },
    [],
  );

  const forget = useCallback(() => {
    for (const h of handles.current.values()) h.free();
    handles.current.clear();
    wallet?.free();
    localStorage.removeItem(STORAGE_KEY);
    wipeOotleState();
    setSubAddresses([]);
    setActiveSubAddressState(null);
    setLayerState("L1");
    setPendingLayer(null);
    setL2({ identity: null, balances: [], loading: false, error: null });
    setWallet(null);
    setNetwork(null);
    setBackupHex(null);
    setEncBackup(null);
    setWalletLocked(false);
    setLockedAddressHint(null);
    pendingPersistedRef.current = null;
    setAddressInfo(null);
    setUtxos([]);
    setHistory([]);
    setBurns([]);
  }, [wallet]);

  const lock = useCallback(() => {
    if (!encBackup) return; // no PIN set on this device yet — nothing to lock into
    for (const h of handles.current.values()) h.free();
    handles.current.clear();
    wallet?.free();
    setWallet(null);
    setBackupHex(null);
    setLockedAddressHint(addressInfo?.base58 ?? null);
    setAddressInfo(null);
    setWalletLocked(true);
  }, [wallet, encBackup, addressInfo]);

  const unlock = useCallback(
    async (pin: string): Promise<boolean> => {
      if (!encBackup || !network) return false;
      const hex = await decryptWithPin(encBackup, pin);
      if (hex === null) return false;
      try {
        const w = WasmWallet.fromBackupHex(hex, network);
        const pending = pendingPersistedRef.current;
        if (pending) {
          reconstructWalletState(w, hex, pending.utxos ?? [], pending.history ?? []);
          pendingPersistedRef.current = null;
        } else {
          // Re-unlocking after a manual lock() mid-session: utxos/history never left state, just
          // rebuild the wasm handles behind them.
          reconstructWalletState(w, hex, utxos, history);
        }
        setWalletLocked(false);
        setLockedAddressHint(null);
        return true;
      } catch {
        return false;
      }
    },
    [encBackup, network, utxos, history],
  );

  const setPin = useCallback(
    async (pin: string) => {
      if (!backupHex) return;
      setEncBackup(await encryptWithPin(backupHex, pin));
    },
    [backupHex],
  );

  const changePin = useCallback(
    async (oldPin: string, newPin: string): Promise<boolean> => {
      if (!encBackup) return false;
      const hex = await decryptWithPin(encBackup, oldPin);
      if (hex === null) return false;
      setEncBackup(await encryptWithPin(hex, newPin));
      return true;
    },
    [encBackup],
  );

  const verifyPin = useCallback(
    async (pin: string): Promise<boolean> => {
      if (!encBackup) return false;
      return (await decryptWithPin(encBackup, pin)) !== null;
    },
    [encBackup],
  );

  const setAutoLockMinutes = useCallback((minutes: number) => {
    setAutoLockMinutesState(minutes);
  }, []);

  const setFeePrivacyDefault = useCallback((v: "private" | "transparent") => {
    setFeePrivacyDefaultState(v);
  }, []);

  const fundDemo = useCallback(
    (valueMicro: bigint) => {
      if (!wallet || valueMicro <= 0n) return;
      const h = wallet.createSelfUtxo(valueMicro);
      const rec: UtxoRecord = {
        id: crypto.randomUUID(),
        valueMicro: valueMicro.toString(),
        kind: "demo",
        createdAt: Date.now(),
      };
      handles.current.set(rec.id, h);
      setUtxos((u) => [...u, rec]);
    },
    [wallet],
  );

  const addScannedOutput = useCallback((handle: WasmWalletOutput, minedHeight: number, maturityHeight: number, raw?: ScanOutput) => {
    const id = handle.commitmentHex;
    if (handles.current.has(id)) return;
    // The sender's memo carries the payment id of the address they paid; matching it against our
    // labels is what tells one sub-address's payments from another's.
    const paidTo = attributePayment(handle.paymentId, subAddressesRef.current)?.label;
    const rec: UtxoRecord = {
      id,
      valueMicro: handle.valueMicro.toString(),
      kind: "scanned",
      createdAt: Date.now(),
      minedHeight,
      maturityHeight,
      raw,
      paidTo,
      senderAddress: handle.senderAddress,
    };
    everOwnedRef.current.add(id.toLowerCase());
    handles.current.set(id, handle);
    // Replaces the pending placeholder for our own change, now that it is confirmed and spendable.
    // The "change" label is kept so a later reload still recognises it as our own money returning.
    setUtxos((u) => {
      const previous = u.find((existing) => existing.id === id);
      const merged = previous?.kind === "change" ? { ...rec, kind: "change" as const } : rec;
      return [...u.filter((existing) => existing.id !== id), merged];
    });
  }, []);

  /**
   * Confirms any pending transaction whose inputs the chain now shows as spent. This is what turns
   * a broadcast transaction from pending into mined, and it works even for a transaction that left
   * no change output for us to recognise.
   */
  const markMinedBySpentInputs = useCallback((commitments: string[], height: number | null) => {
    if (commitments.length === 0) return;
    const spent = new Set(commitments.map((c) => c.toLowerCase()));
    setHistory((prev) =>
      prev.map((t) => {
        if (t.status !== "pending" && t.status !== "submitted") return t;
        const inputs = t.inputCommitments ?? [];
        if (!inputs.some((c) => spent.has(c.toLowerCase()))) return t;
        return { ...t, status: "mined" as const, minedHeight: height ?? t.minedHeight };
      }),
    );
  }, []);

  /** Drops outputs the chain shows as already spent — they are not ours to spend any more. */
  const removeSpent = useCallback((commitments: string[]) => {
    if (commitments.length === 0) return;
    const gone = new Set(commitments.map((c) => c.toLowerCase()));
    handles.current.forEach((h, id) => {
      if (gone.has(id.toLowerCase())) {
        h.free();
        handles.current.delete(id);
      }
    });
    setUtxos((prev) => prev.filter((u) => !gone.has(u.id.toLowerCase())));
  }, []);

  const spendInputs = useCallback(
    (consumedIds: string[], changeMicro: bigint, changeCommitmentHex: string | null) => {
      if (!wallet) return;
      const consumed = new Set(consumedIds);
      for (const c of consumedIds) everOwnedRef.current.add(c.toLowerCase());
      let changeRec: UtxoRecord | null = null;
      if (changeMicro > 0n && changeCommitmentHex) {
        // The change output belongs to the broadcast transaction, so we know its commitment but
        // hold no spendable handle until the scanner imports it from the block it lands in. Keying
        // the record by commitment lets that import supersede this placeholder.
        ownChangeRef.current.add(changeCommitmentHex.toLowerCase());
        everOwnedRef.current.add(changeCommitmentHex.toLowerCase());
        changeRec = {
          id: changeCommitmentHex,
          valueMicro: changeMicro.toString(),
          kind: "change",
          createdAt: Date.now(),
          pending: true,
        };
      }
      handles.current.forEach((h, id) => {
        if (consumed.has(id)) {
          // Read the chain hash before freeing: once the handle is gone this mapping cannot be
          // recovered, and it is the only way to recognise this spend when it lands in a block.
          const chainHash = h.chainOutputHash;
          if (chainHash) spentHashRef.current.set(chainHash.toLowerCase(), id.toLowerCase());
          h.free();
          handles.current.delete(id);
        }
      });
      setUtxos((prev) => {
        const kept = prev.filter((u) => !consumed.has(u.id));
        if (changeRec) kept.push(changeRec);
        return kept;
      });
    },
    [wallet],
  );

  const addTx = useCallback((rec: TxRecord) => {
    setHistory((h) => [rec, ...h].slice(0, 100));
  }, []);

  const updateTx = useCallback((id: string, patch: Partial<TxRecord>) => {
    setHistory((h) => h.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const clearHistory = useCallback(() => setHistory([]), []);

  const addBurn = useCallback((rec: BurnRecord) => {
    setBurns((b) => [rec, ...b]);
  }, []);

  const updateBurn = useCallback((id: string, patch: Partial<BurnRecord>) => {
    setBurns((b) => b.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const burnsRef = useRef<BurnRecord[]>([]);
  burnsRef.current = burns;
  const claimingRef = useRef(new Set<string>());

  const ootleClaimPublicKey = useCallback(async (): Promise<string> => {
    if (!backupHex) throw new Error("No wallet loaded.");
    const identity = await deriveL2Identity(backupHex);
    const key = await identity.account.getPublicKey();
    return Array.from(key, (b) => b.toString(16).padStart(2, "0")).join("");
  }, [backupHex]);

  const claimBurn = useCallback(
    async (id: string, manual: boolean) => {
      const rec = burnsRef.current.find((r) => r.id === id);
      if (!rec || !backupHex || claimingRef.current.has(id)) return;
      const proof = claimProofFor(rec);
      if (!proof) return;
      claimingRef.current.add(id);
      setBurns((b) =>
        b.map((r) => (r.id === id ? { ...r, status: "claiming", lastError: undefined, lastAttemptAt: Date.now() } : r)),
      );
      try {
        const identity = await deriveL2Identity(backupHex);
        const { transactionId, claimedAmount } = await identity.account.claimBurn(proof);
        setBurns((b) =>
          b.map((r) =>
            r.id === id
              ? { ...r, status: "claimed", claimTxId: transactionId, claimedMicro: claimedAmount.toString() }
              : r,
          ),
        );
        refreshL2Ref.current();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // The burn stays claimable whatever went wrong, so it returns to waiting either way.
        setBurns((b) => b.map((r) => (r.id === id ? { ...r, status: "mined", lastError: message } : r)));
        if (manual) throw isRetryableClaimError(message) ? new Error(`Not claimable yet: ${message}`) : e;
      } finally {
        claimingRef.current.delete(id);
      }
    },
    [backupHex],
  );

  const claimBurnNow = useCallback((id: string) => claimBurn(id, true), [claimBurn]);

  /**
   * Moves each burn along: a broadcast burn is mined once its kernel has a merkle proof, and a
   * mined burn to this wallet's own account is claimed automatically, retried on a slow cadence
   * because validators only accept it once the L1 block is well confirmed.
   */
  const advanceBurns = useCallback(async () => {
    for (const rec of burnsRef.current) {
      const needsProof = rec.status === "broadcast" || (rec.status === "external" && !rec.merkle);
      if (needsProof) {
        try {
          const merkle = await rpcKernelMerkleProof(rec.parts.kernel.nonceHex, rec.parts.kernel.signatureHex);
          if (merkle) {
            const { block_height, ...proof } = merkle;
            setBurns((b) =>
              b.map((r) =>
                r.id === rec.id
                  ? {
                      ...r,
                      merkle: proof,
                      minedHeight: block_height ?? undefined,
                      status: r.status === "external" ? "external" : "mined",
                      // Counts as an attempt so the first claim waits for the block to settle.
                      lastAttemptAt: Date.now(),
                    }
                  : r,
              ),
            );
          }
        } catch {
          /* node unreachable — try again on the next pass */
        }
      } else if (
        rec.status === "mined" &&
        rec.toOwnAccount &&
        burnClaimableNow(network) &&
        Date.now() - (rec.lastAttemptAt ?? 0) >= CLAIM_RETRY_MS
      ) {
        void claimBurn(rec.id, false);
      }
    }
  }, [claimBurn, network]);

  const burnsInFlight = burns.some(
    (r) =>
      r.status === "broadcast" ||
      (r.status === "mined" && r.toOwnAccount && burnClaimableNow(network)) ||
      (r.status === "external" && !r.merkle),
  );
  useEffect(() => {
    if (!ready || !wallet || walletLocked || !burnsInFlight) return;
    void advanceBurns();
    const id = setInterval(() => void advanceBurns(), 30_000);
    return () => clearInterval(id);
  }, [ready, wallet, walletLocked, burnsInFlight, advanceBurns]);

  const setNodeUrl = useCallback((url: string) => {
    setNodeUrlState(url.trim());
  }, []);

  useEffect(() => {
    if (!ready || !wallet || !birthdayMs || scan) return;
    let cancelled = false;
    void (async () => {
      const t = await fetchChainTip();
      if (cancelled || !t) return;
      setTipHeight(t.height);
      let birthdayHeight = await findHeightForTimestamp(scannerUrl, birthdayMs, t.height);
      if (birthdayHeight === null) {
        const blocksSinceBirthday = Math.floor(Math.max(0, Date.now() - birthdayMs) / 1000 / 120);
        birthdayHeight = Math.max(1, t.height - blocksSinceBirthday * 4);
      }
      const resumeFrom = Math.max(1, (lastScannedHeight ?? birthdayHeight - 1) + 1);
      if (resumeFrom > t.height) return;
      const mw = await fetchMiddlewareTip(scannerUrl);
      if (mw && mw.prunedHeight > 0 && birthdayHeight < mw.prunedHeight && resumeFrom < mw.prunedHeight) {
        setHistory((h) =>
          [
            {
              id: crypto.randomUUID(),
              toBase58: "chain scan",
              amountMicro: "0",
              feeMicro: "0",
              changeMicro: null,
              status: "failed" as const,
              createdAt: Date.now(),
              json: JSON.stringify({ type: "scan-warning", pruned: mw.prunedHeight }),
              result: `Scanner node only serves blocks ≥ ${mw.prunedHeight.toLocaleString()} (horizon-pruned). Outputs mined before that need an archival node.`,
            },
            ...h,
          ].slice(0, 100),
        );
      }
      startScan(resumeFrom, t.height);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, wallet, birthdayMs]);


  useEffect(() => {
    lastScannedRef.current = lastScannedHeight;
  }, [lastScannedHeight]);

  useEffect(() => {
    subAddressesRef.current = subAddresses;
  }, [subAddresses]);

  const refreshL2 = useCallback(() => {
    if (!backupHex) return;
    setL2((prev) => ({ ...prev, loading: true, error: null }));
    void (async () => {
      try {
        const identity = await deriveL2Identity(backupHex);
        const { balances, error } = await fetchL2Balances(identity.account);
        setL2({ identity, balances, loading: false, error });
      } catch (e) {
        setL2({
          identity: null,
          balances: [],
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  }, [backupHex]);
  const refreshL2Ref = useRef(refreshL2);
  refreshL2Ref.current = refreshL2;

  /**
   * Shielded outputs are freestanding UTXO substates that no vault lists, so the only lead to
   * them is a local ledger — which a different device, or a different wallet on the same seed,
   * naturally does not share. Scanning the chain rebuilds that ledger from what this account can
   * actually decrypt, which is what makes funds shielded elsewhere visible here.
   */
  const scanL2PrivateFunds = useCallback(async (): Promise<number> => {
    const account = l2.identity?.account;
    if (!account) return 0;
    setL2((prev) => ({ ...prev, loading: true }));
    try {
      const { claimed } = await account.scanForPrivatePayments();
      const { balances, error } = await fetchL2Balances(account);
      setL2((prev) => ({ ...prev, balances, error, loading: false }));
      return claimed;
    } catch (e) {
      setL2((prev) => ({
        ...prev,
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      }));
      return 0;
    }
  }, [l2.identity]);

  const setLayer = useCallback(
    (next: Layer) => {
      setLayerState(next);
      setPendingLayer(null);
      // Derive on first arrival rather than at wallet load: an L1-only user never pays for it.
      if (next === "L2") refreshL2();
    },
    [refreshL2],
  );

  // Lives here rather than in the Dashboard so any surface can ask for the switch — the L2 panel's
  // own "back to L1" button gets the same transition as the card's "switch to L2".
  const requestLayer = useCallback(
    (next: Layer) => {
      setPendingLayer((current) => (current === null && next !== layer ? next : current));
    },
    [layer],
  );

  /**
   * Creates a sub-address for `label`. Returns an error message, or null on success.
   *
   * The address is derived from the wallet's own — same view and spend keys, with the label as the
   * payment id — so nothing here can produce an address this wallet cannot receive on.
   */
  const addSubAddress = useCallback(
    (label: string): string | null => {
      if (!wallet) return "No wallet loaded.";
      try {
        const sub = deriveSubAddress(wallet.getAddress(), label);
        setSubAddresses((prev) => [...prev, sub]);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    [wallet],
  );

  const setActiveSubAddress = useCallback((label: string | null) => {
    setActiveSubAddressState(label);
  }, []);

  const removeSubAddress = useCallback((label: string) => {
    // Only forgets the label. Anything already paid to it was received by the wallet's own keys
    // and is unaffected — the address remains valid and spendable either way.
    setSubAddresses((prev) => prev.filter((s) => s.label !== label));
    // Fall back to the main address rather than presenting one that is no longer listed.
    setActiveSubAddressState((current) => (current === label ? null : current));
  }, []);

  const setScannerUrl = useCallback((url: string) => {
    setScannerUrlState(url.trim());
  }, []);

  const setScanThreads = useCallback((n: number) => {
    setScanThreadsState(Math.min(24, Math.max(1, Math.floor(n))));
  }, []);

  const startScan = useCallback(
    (from: number, to: number) => {
      if (!wallet || scanningRef.current) return;
      scanningRef.current = true;
      stopRef.current = false;
      setScan({
        current: from,
        to,
        blocksScanned: 0,
        outputsSeen: 0,
        found: 0,
        skipped: 0,
        skippedHeights: [],
        importFailures: 0,
        failureSamples: [],
        safeCompleted: from - 1,
        spentAgain: 0,
        done: false,
      });
      // What this scan actually recovered, so the activity entry can report an amount rather than
      // just a count. Outputs the scan later finds spent are taken back off the total.
      // Classified once the scan has finished, because whether an output is income or our own
      // change depends on outputs the scan may not have reached yet — concurrent batches deliver
      // blocks out of order, and a rescan from the birthday starts with no memory of past sends.
      const candidates: {
        commitment: string;
        value: bigint;
        blockInputs: string[];
        paidTo?: string;
        senderAddress?: string;
      }[] = [];
      const everOwned = everOwnedRef.current;
      for (const c of handles.current.keys()) everOwned.add(c.toLowerCase());
      // Ownership testing is the expensive part of a scan and it is pure CPU, so it runs in
      // workers rather than on the thread that paints. Each costs a wasm instance, which is why
      // the pool lives for one scan and is torn down at the end rather than kept warm.
      const poolRef: { current: DetectPool | null } = { current: null };
      if (backupHex) {
        // Deliberately not awaited: the scan starts now on the main thread and switches to the
        // workers the moment they are up. A pool that never starts costs some speed, never the scan.
        void createDetectPool(backupHex, network ?? "mainnet", scanThreads)
          .then((p) => { poolRef.current = p; })
          .catch(() => { poolRef.current = null; });
      }
      void scanRange(
        scannerUrl,
        wallet,
        from,
        to,
        (handle, blockHeight, output, blockInputs) => {
          const commitment = handle.commitmentHex.toLowerCase();
          // Money arriving for the first time is the only thing that can be income; rescanning a
          // range we already covered re-imports outputs we have long held.
          if (!handles.current.has(handle.commitmentHex)) {
            // Which sub-address this payment was made to, from the payment id the sender attached.
            const paidTo = attributePayment(handle.paymentId, subAddressesRef.current)?.label;
            candidates.push({
              commitment,
              value: handle.valueMicro,
              blockInputs,
              paidTo,
              senderAddress: handle.senderAddress,
            });
          }
          everOwned.add(commitment);
          addScannedOutput(handle, blockHeight, Number(output.maturity || "0"), output);
        },
        (commitments, height) => {
          removeSpent(commitments);
          markMinedBySpentInputs(commitments, height);
        },
        (commitment) => {
          everOwned.add(commitment);
        },
        (p) => {
          setScan({ ...p });
          if (!p.error) {
            setLastScannedHeight(p.safeCompleted);
          }
        },
        () => stopRef.current,
        scanThreads,
        poolRef,
        // The query service names a spend by the hash of the output consumed. Only our own spends
        // matter, and every handle we hold remembers the chain hash it was imported with, so the
        // translation back to a commitment is answerable here without asking the network.
        (outputHash) => {
          const key = outputHash.toLowerCase();
          // Outputs already spent come first: those are the ones whose confirmation is being
          // waited on, and their handles are long gone.
          const spent = spentHashRef.current.get(key);
          if (spent) return spent;
          for (const [commitment, handle] of handles.current) {
            if (handle.chainOutputHash?.toLowerCase() === key) return commitment.toLowerCase();
          }
          return undefined;
        },
      )
        .catch((e) => ({
          current: from,
          to,
          blocksScanned: 0,
          outputsSeen: 0,
          found: 0,
          skipped: 0,
          skippedHeights: [],
          importFailures: 0,
          failureSamples: [],
          safeCompleted: from - 1,
          spentAgain: 0,
          done: true,
          error: e instanceof Error ? e.message : String(e),
        }))
        .then((final) => {
        poolRef.current?.dispose();
        poolRef.current = null;
        setScan(final);
        if (final.done && !final.error) {
          setLastScannedHeight(final.safeCompleted);
        }
        // An output is our own change, not income, when the block that created it also spends a
        // commitment this wallet owns — that block holds one of our own transactions. This is what
        // a rescan has to fall back on, since it has no record of the sends that produced them.
        let receivedMicro = 0n;
        const paidToLabels = new Set<string>();
        const senderAddresses = new Set<string>();
        for (const c of candidates) {
          if (ownChangeRef.current.has(c.commitment)) continue;
          if (c.blockInputs.some((i) => everOwned.has(i.toLowerCase()))) continue;
          receivedMicro += c.value;
          if (c.paidTo) paidToLabels.add(c.paidTo);
          if (c.senderAddress) senderAddresses.add(c.senderAddress);
        }
        const worthReporting =
          receivedMicro > 0n || final.skipped > 0 || final.importFailures > 0 || !!final.error;
        if (worthReporting) {
          const bits: string[] = [`Found ${final.found} owned output(s)`];
          if (final.skipped > 0) {
            bits.push(
              `${final.skipped} block(s) unavailable: ${final.skippedHeights.slice(0, 5).join(", ")}${final.skippedHeights.length > 5 ? "…" : ""}`,
            );
          }
          if (final.importFailures > 0) {
            bits.push(
              `${final.importFailures} output(s) failed import — e.g. ${final.failureSamples[0] ?? "?"}`,
            );
          }
          if (final.error) bits.push(`scan error: ${final.error}`);
          setHistory((h) =>
            [
              {
                id: crypto.randomUUID(),
                direction: "in" as const,
                toBase58: `chain scan ${from}–${to}`,
                amountMicro: receivedMicro.toString(),
                feeMicro: "0",
                changeMicro: null,
                status: final.error ? ("failed" as const) : ("mined" as const),
                createdAt: Date.now(),
                json: JSON.stringify({
                  type: "scan",
                  from,
                  to,
                  found: final.found,
                  skipped: final.skipped,
                  importFailures: final.importFailures,
                  safeCompleted: final.safeCompleted,
                }),
                paidTo: paidToLabels.size > 0 ? [...paidToLabels] : undefined,
                senders: senderAddresses.size > 0 ? [...senderAddresses] : undefined,
                result: bits.join(" · "),
              },
              ...h,
            ].slice(0, 100),
          );
        }
        })
        .finally(() => {
          scanningRef.current = false;
        });
    },
    [wallet, scannerUrl, scanThreads, addScannedOutput, removeSpent, markMinedBySpentInputs],
  );

  const catchUp = useCallback(async () => {
    if (scanningRef.current) return;
    // The middleware serves the blocks we are about to ask for, so its tip is the one to chase;
    // the public explorer can run a block or two ahead of it and we would ask for blocks it does
    // not have yet.
    const mw = await fetchMiddlewareTip(scannerUrl);
    const height = mw?.height ?? (await fetchChainTip())?.height;
    if (!height) return;
    setTipHeight(height);
    let from = lastScannedRef.current;
    if (from === null) {
      // Nothing scanned yet — the first pass either has not run or did not finish. Work out where
      // this wallet's history starts so the poll can get it going by itself. With no birthday
      // recorded (a wallet restored from enciphered backup hex, which carries no birth date) there
      // is no honest answer, so leave the first pass to a manual scan rather than guess a start
      // height and silently miss history. The poll keeps running either way, so the moment that
      // scan sets a cursor this takes over and follows the tip unaided.
      if (!birthdayMs) return;
      const birthdayHeight = await findHeightForTimestamp(scannerUrl, birthdayMs, height);
      if (birthdayHeight === null) return;
      from = birthdayHeight - 1;
    }
    if (height > from) startScan(from + 1, height);
  }, [birthdayMs, scannerUrl, startScan]);

  /**
   * Called the moment the block ticker sees a new block, so a payment shows up as soon as it is
   * mined instead of waiting for the next poll. The poll below is the backstop.
   */
  const notifyNewBlock = useCallback(
    (height: number) => {
      setTipHeight((prev) => (prev === null || height > prev ? height : prev));
      void catchUp();
    },
    [catchUp],
  );

  useEffect(() => {
    // Deliberately not gated on the birthday: a wallet that has scanned before knows exactly where
    // it left off, and one that has not still needs its tip polled and these listeners attached.
    if (!ready || !wallet) return;
    void catchUp();
    const id = setInterval(() => void catchUp(), 15000);
    // Browsers throttle timers in background tabs to about once a minute, so a wallet left open in
    // another tab falls behind the chain. Catch up the moment it is looked at again.
    const onVisible = () => {
      if (document.visibilityState === "visible") void catchUp();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [ready, wallet, catchUp]);

  const stopScan = useCallback(() => {
    stopRef.current = true;
  }, []);

  const totalMicro = useMemo(() => {
    return utxos.reduce((acc, u) => acc + BigInt(u.valueMicro), 0n);
  }, [utxos]);

  const { unlockedMicro, lockedMicro, pendingMicro } = useMemo(() => {
    let unlocked = 0n;
    let locked = 0n;
    let pending = 0n;
    for (const u of utxos) {
      const value = BigInt(u.valueMicro);
      if (u.pending) pending += value;
      else if (isLocked(u, tipHeight)) locked += value;
      else unlocked += value;
    }
    return { unlockedMicro: unlocked, lockedMicro: locked, pendingMicro: pending };
  }, [utxos, tipHeight]);

  const value: Store = {
    ready,
    wallet,
    network,
    backupHex,
    addressInfo,
    utxos,
    totalMicro,
    unlockedMicro,
    lockedMicro,
    pendingMicro,
    tipHeight,
    history,
    nodeUrl,
    scannerUrl,
    scanThreads,
    setScanThreads,
    subAddresses,
    addSubAddress,
    removeSubAddress,
    activeSubAddress,
    setActiveSubAddress,
    layer,
    setLayer,
    pendingLayer,
    requestLayer,
    l2,
    refreshL2,
    scanL2PrivateFunds,
    scan,
    birthdayMs,
    lastScannedHeight,
    setWalletBirthday,
    createWallet,
    restoreWallet,
    forget,
    hasPin: encBackup !== null,
    walletLocked,
    lockedAddressHint,
    lock,
    unlock,
    setPin,
    changePin,
    verifyPin,
    autoLockMinutes,
    setAutoLockMinutes,
    feePrivacyDefault,
    setFeePrivacyDefault,
    fundDemo,
    addScannedOutput,
    removeSpent,
    notifyNewBlock,
    markMinedBySpentInputs,
    getHandle: (id: string) => handles.current.get(id),
    spendInputs,
    addTx,
    updateTx,
    clearHistory,
    setNodeUrl,
    burns,
    addBurn,
    updateBurn,
    claimBurnNow,
    ootleClaimPublicKey,
    setScannerUrl,
    startScan,
    stopScan,
  };

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}
