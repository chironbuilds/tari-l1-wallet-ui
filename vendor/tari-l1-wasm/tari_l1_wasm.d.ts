/* tslint:disable */
/* eslint-disable */

/**
 * Builds and signs a burn of `amount` µT, claimable on Ootle by the holder of `claim_public_key`.
 *
 * # Example (JS)
 * ```js
 * const builder = new WasmBurnBuilder(wallet, 10_000_000n, ootleAccountPublicKeyHex);
 * builder.addInput(utxo);
 * builder.withFeePerGram(5n);
 * builder.withTipHeight(tip);
 * const burn = builder.build();
 * submit(burn.toJson());
 * ```
 */
export class WasmBurnBuilder {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Adds a spendable output (from this wallet) as a full input.
     */
    addInput(input: WasmWalletOutput): void;
    /**
     * Produces the fully-signed burn transaction and its partial claim proof.
     */
    build(): WasmSignedBurn;
    /**
     * `claim_public_key_hex` is the Ootle account's 32-byte public key (`P`). A wrong key burns
     * the funds for good: nothing else can ever claim them.
     */
    constructor(wallet: WasmWallet, amount_micro: bigint, claim_public_key_hex: string);
    withFeePerGram(fee_per_gram_micro: bigint): void;
    /**
     * Sets the current chain tip so the correct consensus-constants epoch is used.
     */
    withTipHeight(tip_height: bigint): void;
}

/**
 * A Ristretto Schnorr keypair (secret + public key).
 */
export class WasmKeyPair {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    static fromSecretKeyHex(hex: string): WasmKeyPair;
    /**
     * Generates a new random keypair using the platform CSPRNG.
     */
    static generate(): WasmKeyPair;
    readonly publicKeyHex: string;
    readonly secretKeyHex: string;
}

/**
 * A Tari (Ristretto) Schnorr signature over a message, using Tari's domain-separated challenge.
 */
export class WasmSchnorrSignature {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Signs a message with the given secret key. The nonce is generated with the platform CSPRNG.
     */
    static sign(secret_key_hex: string, message: Uint8Array): WasmSchnorrSignature;
    /**
     * Verifies a signature against the public key, public nonce and signature hex values.
     */
    static verify(public_key_hex: string, public_nonce_hex: string, signature_hex: string, message: Uint8Array): boolean;
    readonly publicNonceHex: string;
    readonly signatureHex: string;
}

/**
 * A signed burn plus the claim-proof material an Ootle `ClaimBurn` needs.
 */
export class WasmSignedBurn {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Serde JSON representation of the transaction, for `submit_transaction`.
     */
    toJson(): string;
    readonly amountMicro: bigint;
    readonly changeCommitmentHex: string | undefined;
    readonly changeValueMicro: bigint | undefined;
    /**
     * The Ootle account key `P` the burn is addressed to (the proof's `burn_public_key`).
     */
    readonly claimPublicKeyHex: string;
    readonly commitmentHex: string;
    readonly encryptedDataHex: string;
    /**
     * Absolute fee in micro-Minotari.
     */
    readonly feeMicro: bigint;
    readonly kernelExcessHex: string;
    readonly kernelFeeMicro: bigint;
    readonly kernelLockHeight: bigint;
    /**
     * The burn kernel's excess-signature public nonce — half of the merkle-proof lookup key.
     */
    readonly kernelNonceHex: string;
    /**
     * The burn kernel's excess-signature scalar — the other half of the merkle-proof lookup key.
     */
    readonly kernelSignatureHex: string;
    readonly kernelVersion: number;
    readonly outputHashHex: string;
    readonly ownershipNonceHex: string;
    readonly ownershipSignatureHex: string;
    readonly senderOffsetPublicKeyHex: string;
}

/**
 * A fully-signed transaction ready for submission to a base node.
 */
export class WasmSignedTransaction {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Serde JSON representation of the transaction, for a middleware that maps it onto the
     * `tari.rpc.BaseNode/SubmitTransaction` gRPC request.
     */
    toJson(): string;
    /**
     * Protobuf-encoded `proto.types.Transaction` message.
     */
    toProtoBytes(): Uint8Array;
    /**
     * Protobuf-encoded `SubmitTransactionRequest` for gRPC submission.
     */
    toSubmitRequestBytes(): Uint8Array;
    readonly changeCommitmentHex: string | undefined;
    /**
     * Change returned to this wallet, if any.
     */
    readonly changeValueMicro: bigint | undefined;
    /**
     * Absolute fee in micro-Minotari.
     */
    readonly feeMicro: bigint;
}

/**
 * A Tari address (single or dual) with encoding/decoding helpers.
 */
export class WasmTariAddress {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    static fromBase58(s: string): WasmTariAddress;
    static fromBytes(bytes: Uint8Array): WasmTariAddress;
    static fromEmoji(emoji: string): WasmTariAddress;
    static fromHex(s: string): WasmTariAddress;
    static newDual(view_key_hex: string, spend_key_hex: string, network: string, features: number): WasmTariAddress;
    static newSingle(spend_key_hex: string, network: string, features: number): WasmTariAddress;
    toBase58(): string;
    toBytes(): Uint8Array;
    toEmoji(): string;
    toHex(): string;
    toString(): string;
    /**
     * Returns this address with a payment id attached — a *sub-address*.
     *
     * The view and spend keys are carried over untouched, so a payment to the returned address is
     * recovered by exactly the same wallet keys as a payment to this one; the payment id only
     * rides along in the address's memo field (and sets the `payment_id` feature bit). A sending
     * wallet copies those bytes into the output's memo, which is what lets the recipient tell one
     * sub-address's payments from another's. Nothing here derives new key material, so a
     * sub-address can never receive funds this wallet cannot spend.
     *
     * Only dual addresses can carry a payment id; a single address has no view key to receive
     * one-sided payments with in the first place.
     */
    withPaymentId(payment_id: Uint8Array): WasmTariAddress;
    readonly featureBits: number;
    readonly features: string[];
    readonly isSingle: boolean;
    readonly network: string;
    /**
     * The payment id carried by this address, empty when it is a plain address.
     */
    readonly paymentId: Uint8Array;
    readonly spendKeyHex: string;
    readonly viewKeyHex: string | undefined;
}

/**
 * Builds and signs a complete one-sided Minotari transaction entirely in WASM.
 *
 * # Example (JS)
 * ```js
 * const builder = new WasmTxBuilder(wallet);
 * builder.addInput(utxo1);
 * builder.addRecipient(recipientAddress, 5_000_000n);
 * builder.withFeePerGram(2n);
 * builder.withTipHeight(currentTipHeight); // selects the consensus-constants epoch
 * const signed = builder.build();
 * // A base node speaks gRPC, not JSON-RPC: hand `signed.toJson()` to a gRPC-speaking
 * // middleware that maps it onto `tari.rpc.BaseNode/SubmitTransaction`.
 * ```
 */
export class WasmTxBuilder {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Adds a spendable output as a COMPACT input, referencing the spent output by its
     * chain-stored hash only.
     *
     * Only valid where the consumer hydrates compact inputs from its own database (block
     * propagation and block validation). The mempool does NOT, so a transaction built this way is
     * rejected by `SubmitTransaction`; use `addInput` for anything submitted to a base node.
     * Falls back to a full input when the output has no known chain hash.
     */
    addCompactInput(input: WasmWalletOutput): void;
    /**
     * Adds a spendable output (from this wallet) to be consumed by the transaction.
     *
     * The output is spent as a FULL input, carrying all of the spent output's data. A base node
     * only hydrates compact inputs while validating a *block* body, so a transaction submitted to
     * its mempool must carry the data itself — see `addCompactInput`.
     */
    addInput(input: WasmWalletOutput): void;
    /**
     * Adds a recipient; `address` may be emoji, base58 or hex. Must be a dual/one-sided address.
     */
    addRecipient(address: string, amount_micro: bigint): void;
    /**
     * Produces the fully-signed transaction (range proofs included).
     */
    build(): WasmSignedTransaction;
    constructor(wallet: WasmWallet);
    withFeePerGram(fee_per_gram_micro: bigint): void;
    withLockHeight(lock_height: bigint): void;
    /**
     * Includes this wallet's own address in the recipient's memo, so they can see who paid.
     *
     * Off by default. A one-sided payment reveals nothing about its sender on chain, and this
     * deliberately gives that up: anyone who can read the recipient's view key — the recipient,
     * or whoever they show it to — learns the payment came from this wallet. It cannot be undone
     * once the transaction is broadcast.
     */
    withSenderRevealed(reveal: boolean): void;
    /**
     * Sets the current chain tip so the correct consensus-constants epoch is used.
     */
    withTipHeight(tip_height: bigint): void;
}

/**
 * A self-contained Tari wallet capable of building fully-signed L1 transactions entirely in WASM.
 *
 * Keys are derived from a CipherSeed; the seed can be exported/imported as an enciphered hex blob
 * (no passphrase) for persistence. Recipients must be dual ("one-sided") addresses since payments
 * are constructed as stealth one-sided transactions.
 */
export class WasmWallet {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Creates a fresh spendable UTXO handle owned by this wallet (useful for testing flows and
     * self-transfer construction before on-chain confirmation).
     */
    createSelfUtxo(value_micro: bigint): WasmWalletOutput;
    /**
     * Debug: hashes range-proof hex with Tari's domain hasher (matches chain rangeproof_hash).
     */
    static debugHashRangeProof(range_proof_hex: string): string;
    /**
     * Restores a wallet from an enciphered seed blob (see `getBackupHex`).
     */
    static fromBackupHex(backup_hex: string, network: string): WasmWallet;
    /**
     * The wallet's own dual one-sided payment address.
     */
    getAddress(): WasmTariAddress;
    /**
     * Exports the wallet seed as an enciphered hex blob for persistence.
     */
    getBackupHex(): string;
    /**
     * Recovers a spendable output owned by this wallet from scanned chain data.
     *
     * The encrypted value/mask are decrypted internally (view-key and DH stealth flows), verified
     * against the commitment, and the resulting UTXO becomes spendable by `WasmTxBuilder`.
     */
    importScannedOutput(commitment_hex: string, encrypted_data_hex: string, sender_offset_pub_hex: string, script_hex: string, metadata_sig_hex: string, minimum_value_promise_micro: bigint, maturity: bigint, output_type_byte: number, range_proof_type_byte: number, coinbase_extra_hex: string, covenant_hex: string, range_proof_hex: string, output_hash_hex: string): WasmWalletOutput;
    /**
     * Answers only "is this one mine", and builds nothing.
     *
     * A chain scan asks this of every output that has ever existed, and the answer is no for all
     * but a handful. Routing that through `importScannedOutput` makes each miss pay for a hex
     * parse of the script, metadata signature, covenant and coinbase extra, the construction of
     * an `OutputFeatures`, and a thrown JS exception to report the miss — none of which the
     * answer depends on. Ownership is settled by the commitment, the encrypted data and the
     * sender offset key alone, so those are all this takes, and it returns a plain bool.
     *
     * The caller re-fetches and imports the winners properly; this is a filter, not an import.
     */
    isOutputMine(commitment_hex: string, encrypted_data_hex: string, sender_offset_pub_hex: string): boolean;
    constructor(network: string);
    /**
     * Debug: build marker to verify the served wasm is current.
     */
    static wasmBuildMarker(): string;
}

/**
 * A spendable output owned by a `WasmWallet`.
 */
export class WasmWalletOutput {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The chain-stored output hash (if this output was imported from scanned chain data).
     */
    readonly chainOutputHash: string | undefined;
    readonly commitmentHex: string;
    /**
     * The payment id the sender attached, as raw bytes — empty when the output carries no memo.
     * Matching these against a sub-address's payment id is what attributes a received payment.
     */
    readonly paymentId: Uint8Array;
    /**
     * The payment id as UTF-8 text, when it is valid UTF-8 — sub-addresses created by this wallet
     * use the label itself, so this is normally the human-readable label.
     */
    readonly paymentIdText: string | undefined;
    /**
     * Error from the last compact-input seeding attempt, if any.
     */
    readonly seedError: string | undefined;
    /**
     * The sender's base58 address, when their wallet included one in the memo.
     *
     * Absent for anything that did not: coinbase/mining rewards, wallets that do not attach a
     * sender address, and anyone who deliberately stayed anonymous. A one-sided payment is
     * unlinkable to its sender on-chain, so this is a courtesy from the sender, never a
     * guarantee — and never something to treat as proof of who paid.
     */
    readonly senderAddress: string | undefined;
    /**
     * The fee the sender recorded paying for this payment, when the memo carries one.
     */
    readonly senderFeeMicro: bigint | undefined;
    readonly valueMicro: bigint;
}

/**
 * Formats an amount in micro-Minotari as a human-readable currency string.
 * `separator` is the thousands separator (e.g. ',' or '.').
 */
export function amountToCurrencyString(micro_minotari: bigint, separator: string): string;

/**
 * BLAKE2b-256 hash of the input bytes, hex encoded. Matches Tari's 256-bit Blake2b usage.
 */
export function blake2b256Hex(data: Uint8Array): string;

/**
 * BLAKE2b-512 hash of the input bytes, hex encoded. This is the digest Tari uses for Schnorr challenges.
 */
export function blake2b512Hex(data: Uint8Array): string;

/**
 * Computes the absolute transaction fee (in micro-Minotari) using the latest transaction weights.
 */
export function calculateFee(fee_per_gram_micro: bigint, num_kernels: number, num_inputs: number, num_outputs: number, features_and_scripts_byte_size: number): bigint;

/**
 * Creates a compressed Pedersen commitment for `value` (in micro-Minotari) under the given blinding factor.
 */
export function commitValue(blinding_factor_hex: string, value: bigint): string;

/**
 * Returns true if the blinding factor and value open the given (hex-encoded, compressed) commitment.
 */
export function openValue(blinding_factor_hex: string, value: bigint, commitment_hex: string): boolean;

/**
 * Parses a human-readable Minotari amount string (e.g. "12.345678 T" or "1234567") into micro-Minotari.
 */
export function parseAmount(s: string): bigint;
