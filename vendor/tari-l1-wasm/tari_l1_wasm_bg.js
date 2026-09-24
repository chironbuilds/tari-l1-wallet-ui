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
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmBurnBuilderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmburnbuilder_free(ptr, 0);
    }
    /**
     * Adds a spendable output (from this wallet) as a full input.
     * @param {WasmWalletOutput} input
     */
    addInput(input) {
        _assertClass(input, WasmWalletOutput);
        wasm.wasmburnbuilder_addInput(this.__wbg_ptr, input.__wbg_ptr);
    }
    /**
     * Produces the fully-signed burn transaction and its partial claim proof.
     * @returns {WasmSignedBurn}
     */
    build() {
        const ptr = this.__destroy_into_raw();
        const ret = wasm.wasmburnbuilder_build(ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmSignedBurn.__wrap(ret[0]);
    }
    /**
     * `claim_public_key_hex` is the Ootle account's 32-byte public key (`P`). A wrong key burns
     * the funds for good: nothing else can ever claim them.
     * @param {WasmWallet} wallet
     * @param {bigint} amount_micro
     * @param {string} claim_public_key_hex
     */
    constructor(wallet, amount_micro, claim_public_key_hex) {
        _assertClass(wallet, WasmWallet);
        const ptr0 = passStringToWasm0(claim_public_key_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmburnbuilder_new(wallet.__wbg_ptr, amount_micro, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmBurnBuilderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {bigint} fee_per_gram_micro
     */
    withFeePerGram(fee_per_gram_micro) {
        wasm.wasmburnbuilder_withFeePerGram(this.__wbg_ptr, fee_per_gram_micro);
    }
    /**
     * Sets the current chain tip so the correct consensus-constants epoch is used.
     * @param {bigint} tip_height
     */
    withTipHeight(tip_height) {
        wasm.wasmburnbuilder_withTipHeight(this.__wbg_ptr, tip_height);
    }
}
if (Symbol.dispose) WasmBurnBuilder.prototype[Symbol.dispose] = WasmBurnBuilder.prototype.free;

/**
 * A Ristretto Schnorr keypair (secret + public key).
 */
export class WasmKeyPair {
    static __wrap(ptr) {
        const obj = Object.create(WasmKeyPair.prototype);
        obj.__wbg_ptr = ptr;
        WasmKeyPairFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmKeyPairFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmkeypair_free(ptr, 0);
    }
    /**
     * @param {string} hex
     * @returns {WasmKeyPair}
     */
    static fromSecretKeyHex(hex) {
        const ptr0 = passStringToWasm0(hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmkeypair_fromSecretKeyHex(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmKeyPair.__wrap(ret[0]);
    }
    /**
     * Generates a new random keypair using the platform CSPRNG.
     * @returns {WasmKeyPair}
     */
    static generate() {
        const ret = wasm.wasmkeypair_generate();
        return WasmKeyPair.__wrap(ret);
    }
    /**
     * @returns {string}
     */
    get publicKeyHex() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmkeypair_publicKeyHex(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get secretKeyHex() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmkeypair_secretKeyHex(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) WasmKeyPair.prototype[Symbol.dispose] = WasmKeyPair.prototype.free;

/**
 * A Tari (Ristretto) Schnorr signature over a message, using Tari's domain-separated challenge.
 */
export class WasmSchnorrSignature {
    static __wrap(ptr) {
        const obj = Object.create(WasmSchnorrSignature.prototype);
        obj.__wbg_ptr = ptr;
        WasmSchnorrSignatureFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmSchnorrSignatureFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmschnorrsignature_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    get publicNonceHex() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmschnorrsignature_publicNonceHex(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Signs a message with the given secret key. The nonce is generated with the platform CSPRNG.
     * @param {string} secret_key_hex
     * @param {Uint8Array} message
     * @returns {WasmSchnorrSignature}
     */
    static sign(secret_key_hex, message) {
        const ptr0 = passStringToWasm0(secret_key_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(message, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmschnorrsignature_sign(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmSchnorrSignature.__wrap(ret[0]);
    }
    /**
     * @returns {string}
     */
    get signatureHex() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmschnorrsignature_signatureHex(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Verifies a signature against the public key, public nonce and signature hex values.
     * @param {string} public_key_hex
     * @param {string} public_nonce_hex
     * @param {string} signature_hex
     * @param {Uint8Array} message
     * @returns {boolean}
     */
    static verify(public_key_hex, public_nonce_hex, signature_hex, message) {
        const ptr0 = passStringToWasm0(public_key_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(public_nonce_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(signature_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray8ToWasm0(message, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.wasmschnorrsignature_verify(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
}
if (Symbol.dispose) WasmSchnorrSignature.prototype[Symbol.dispose] = WasmSchnorrSignature.prototype.free;

/**
 * A signed burn plus the claim-proof material an Ootle `ClaimBurn` needs.
 */
export class WasmSignedBurn {
    static __wrap(ptr) {
        const obj = Object.create(WasmSignedBurn.prototype);
        obj.__wbg_ptr = ptr;
        WasmSignedBurnFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmSignedBurnFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmsignedburn_free(ptr, 0);
    }
    /**
     * @returns {bigint}
     */
    get amountMicro() {
        const ret = wasm.wasmsignedburn_amountMicro(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * @returns {string | undefined}
     */
    get changeCommitmentHex() {
        const ret = wasm.wasmsignedburn_changeCommitmentHex(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * @returns {bigint | undefined}
     */
    get changeValueMicro() {
        const ret = wasm.wasmsignedburn_changeValueMicro(this.__wbg_ptr);
        return ret[0] === 0 ? undefined : BigInt.asUintN(64, ret[1]);
    }
    /**
     * The Ootle account key `P` the burn is addressed to (the proof's `burn_public_key`).
     * @returns {string}
     */
    get claimPublicKeyHex() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmsignedburn_claimPublicKeyHex(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get commitmentHex() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmsignedburn_commitmentHex(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get encryptedDataHex() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmsignedburn_encryptedDataHex(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Absolute fee in micro-Minotari.
     * @returns {bigint}
     */
    get feeMicro() {
        const ret = wasm.wasmsignedburn_feeMicro(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * @returns {string}
     */
    get kernelExcessHex() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmsignedburn_kernelExcessHex(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {bigint}
     */
    get kernelFeeMicro() {
        const ret = wasm.wasmsignedburn_kernelFeeMicro(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * @returns {bigint}
     */
    get kernelLockHeight() {
        const ret = wasm.wasmsignedburn_kernelLockHeight(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * The burn kernel's excess-signature public nonce — half of the merkle-proof lookup key.
     * @returns {string}
     */
    get kernelNonceHex() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmsignedburn_kernelNonceHex(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * The burn kernel's excess-signature scalar — the other half of the merkle-proof lookup key.
     * @returns {string}
     */
    get kernelSignatureHex() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmsignedburn_kernelSignatureHex(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    get kernelVersion() {
        const ret = wasm.wasmsignedburn_kernelVersion(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {string}
     */
    get outputHashHex() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmsignedburn_outputHashHex(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get ownershipNonceHex() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmsignedburn_ownershipNonceHex(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get ownershipSignatureHex() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmsignedburn_ownershipSignatureHex(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get senderOffsetPublicKeyHex() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmsignedburn_senderOffsetPublicKeyHex(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Serde JSON representation of the transaction, for `submit_transaction`.
     * @returns {string}
     */
    toJson() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.wasmsignedburn_toJson(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
}
if (Symbol.dispose) WasmSignedBurn.prototype[Symbol.dispose] = WasmSignedBurn.prototype.free;

/**
 * A fully-signed transaction ready for submission to a base node.
 */
export class WasmSignedTransaction {
    static __wrap(ptr) {
        const obj = Object.create(WasmSignedTransaction.prototype);
        obj.__wbg_ptr = ptr;
        WasmSignedTransactionFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmSignedTransactionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmsignedtransaction_free(ptr, 0);
    }
    /**
     * @returns {string | undefined}
     */
    get changeCommitmentHex() {
        const ret = wasm.wasmsignedtransaction_changeCommitmentHex(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * Change returned to this wallet, if any.
     * @returns {bigint | undefined}
     */
    get changeValueMicro() {
        const ret = wasm.wasmsignedtransaction_changeValueMicro(this.__wbg_ptr);
        return ret[0] === 0 ? undefined : BigInt.asUintN(64, ret[1]);
    }
    /**
     * Absolute fee in micro-Minotari.
     * @returns {bigint}
     */
    get feeMicro() {
        const ret = wasm.wasmsignedtransaction_feeMicro(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * Serde JSON representation of the transaction, for a middleware that maps it onto the
     * `tari.rpc.BaseNode/SubmitTransaction` gRPC request.
     * @returns {string}
     */
    toJson() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.wasmsignedtransaction_toJson(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Protobuf-encoded `proto.types.Transaction` message.
     * @returns {Uint8Array}
     */
    toProtoBytes() {
        const ret = wasm.wasmsignedtransaction_toProtoBytes(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Protobuf-encoded `SubmitTransactionRequest` for gRPC submission.
     * @returns {Uint8Array}
     */
    toSubmitRequestBytes() {
        const ret = wasm.wasmsignedtransaction_toSubmitRequestBytes(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
}
if (Symbol.dispose) WasmSignedTransaction.prototype[Symbol.dispose] = WasmSignedTransaction.prototype.free;

/**
 * A Tari address (single or dual) with encoding/decoding helpers.
 */
export class WasmTariAddress {
    static __wrap(ptr) {
        const obj = Object.create(WasmTariAddress.prototype);
        obj.__wbg_ptr = ptr;
        WasmTariAddressFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmTariAddressFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmtariaddress_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get featureBits() {
        const ret = wasm.wasmtariaddress_featureBits(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {string[]}
     */
    get features() {
        const ret = wasm.wasmtariaddress_features(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {string} s
     * @returns {WasmTariAddress}
     */
    static fromBase58(s) {
        const ptr0 = passStringToWasm0(s, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmtariaddress_fromBase58(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmTariAddress.__wrap(ret[0]);
    }
    /**
     * @param {Uint8Array} bytes
     * @returns {WasmTariAddress}
     */
    static fromBytes(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmtariaddress_fromBytes(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmTariAddress.__wrap(ret[0]);
    }
    /**
     * @param {string} emoji
     * @returns {WasmTariAddress}
     */
    static fromEmoji(emoji) {
        const ptr0 = passStringToWasm0(emoji, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmtariaddress_fromEmoji(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmTariAddress.__wrap(ret[0]);
    }
    /**
     * @param {string} s
     * @returns {WasmTariAddress}
     */
    static fromHex(s) {
        const ptr0 = passStringToWasm0(s, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmtariaddress_fromHex(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmTariAddress.__wrap(ret[0]);
    }
    /**
     * @returns {boolean}
     */
    get isSingle() {
        const ret = wasm.wasmtariaddress_isSingle(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {string}
     */
    get network() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmtariaddress_network(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {string} view_key_hex
     * @param {string} spend_key_hex
     * @param {string} network
     * @param {number} features
     * @returns {WasmTariAddress}
     */
    static newDual(view_key_hex, spend_key_hex, network, features) {
        const ptr0 = passStringToWasm0(view_key_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(spend_key_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(network, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmtariaddress_newDual(ptr0, len0, ptr1, len1, ptr2, len2, features);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmTariAddress.__wrap(ret[0]);
    }
    /**
     * @param {string} spend_key_hex
     * @param {string} network
     * @param {number} features
     * @returns {WasmTariAddress}
     */
    static newSingle(spend_key_hex, network, features) {
        const ptr0 = passStringToWasm0(spend_key_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(network, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmtariaddress_newSingle(ptr0, len0, ptr1, len1, features);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmTariAddress.__wrap(ret[0]);
    }
    /**
     * The payment id carried by this address, empty when it is a plain address.
     * @returns {Uint8Array}
     */
    get paymentId() {
        const ret = wasm.wasmtariaddress_paymentId(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {string}
     */
    get spendKeyHex() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmtariaddress_spendKeyHex(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    toBase58() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmtariaddress_toBase58(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {Uint8Array}
     */
    toBytes() {
        const ret = wasm.wasmtariaddress_toBytes(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {string}
     */
    toEmoji() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmtariaddress_toEmoji(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    toHex() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmtariaddress_toHex(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    toString() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmtariaddress_toString(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string | undefined}
     */
    get viewKeyHex() {
        const ret = wasm.wasmtariaddress_viewKeyHex(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
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
     * @param {Uint8Array} payment_id
     * @returns {WasmTariAddress}
     */
    withPaymentId(payment_id) {
        const ptr0 = passArray8ToWasm0(payment_id, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmtariaddress_withPaymentId(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmTariAddress.__wrap(ret[0]);
    }
}
if (Symbol.dispose) WasmTariAddress.prototype[Symbol.dispose] = WasmTariAddress.prototype.free;

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
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmTxBuilderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmtxbuilder_free(ptr, 0);
    }
    /**
     * Adds a spendable output as a COMPACT input, referencing the spent output by its
     * chain-stored hash only.
     *
     * Only valid where the consumer hydrates compact inputs from its own database (block
     * propagation and block validation). The mempool does NOT, so a transaction built this way is
     * rejected by `SubmitTransaction`; use `addInput` for anything submitted to a base node.
     * Falls back to a full input when the output has no known chain hash.
     * @param {WasmWalletOutput} input
     */
    addCompactInput(input) {
        _assertClass(input, WasmWalletOutput);
        wasm.wasmtxbuilder_addCompactInput(this.__wbg_ptr, input.__wbg_ptr);
    }
    /**
     * Adds a spendable output (from this wallet) to be consumed by the transaction.
     *
     * The output is spent as a FULL input, carrying all of the spent output's data. A base node
     * only hydrates compact inputs while validating a *block* body, so a transaction submitted to
     * its mempool must carry the data itself — see `addCompactInput`.
     * @param {WasmWalletOutput} input
     */
    addInput(input) {
        _assertClass(input, WasmWalletOutput);
        wasm.wasmtxbuilder_addInput(this.__wbg_ptr, input.__wbg_ptr);
    }
    /**
     * Adds a recipient; `address` may be emoji, base58 or hex. Must be a dual/one-sided address.
     * @param {string} address
     * @param {bigint} amount_micro
     */
    addRecipient(address, amount_micro) {
        const ptr0 = passStringToWasm0(address, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmtxbuilder_addRecipient(this.__wbg_ptr, ptr0, len0, amount_micro);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Produces the fully-signed transaction (range proofs included).
     * @returns {WasmSignedTransaction}
     */
    build() {
        const ptr = this.__destroy_into_raw();
        const ret = wasm.wasmtxbuilder_build(ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmSignedTransaction.__wrap(ret[0]);
    }
    /**
     * @param {WasmWallet} wallet
     */
    constructor(wallet) {
        _assertClass(wallet, WasmWallet);
        const ret = wasm.wasmtxbuilder_new(wallet.__wbg_ptr);
        this.__wbg_ptr = ret;
        WasmTxBuilderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {bigint} fee_per_gram_micro
     */
    withFeePerGram(fee_per_gram_micro) {
        wasm.wasmtxbuilder_withFeePerGram(this.__wbg_ptr, fee_per_gram_micro);
    }
    /**
     * @param {bigint} lock_height
     */
    withLockHeight(lock_height) {
        wasm.wasmtxbuilder_withLockHeight(this.__wbg_ptr, lock_height);
    }
    /**
     * Includes this wallet's own address in the recipient's memo, so they can see who paid.
     *
     * Off by default. A one-sided payment reveals nothing about its sender on chain, and this
     * deliberately gives that up: anyone who can read the recipient's view key — the recipient,
     * or whoever they show it to — learns the payment came from this wallet. It cannot be undone
     * once the transaction is broadcast.
     * @param {boolean} reveal
     */
    withSenderRevealed(reveal) {
        wasm.wasmtxbuilder_withSenderRevealed(this.__wbg_ptr, reveal);
    }
    /**
     * Sets the current chain tip so the correct consensus-constants epoch is used.
     * @param {bigint} tip_height
     */
    withTipHeight(tip_height) {
        wasm.wasmtxbuilder_withTipHeight(this.__wbg_ptr, tip_height);
    }
}
if (Symbol.dispose) WasmTxBuilder.prototype[Symbol.dispose] = WasmTxBuilder.prototype.free;

/**
 * A self-contained Tari wallet capable of building fully-signed L1 transactions entirely in WASM.
 *
 * Keys are derived from a CipherSeed; the seed can be exported/imported as an enciphered hex blob
 * (no passphrase) for persistence. Recipients must be dual ("one-sided") addresses since payments
 * are constructed as stealth one-sided transactions.
 */
export class WasmWallet {
    static __wrap(ptr) {
        const obj = Object.create(WasmWallet.prototype);
        obj.__wbg_ptr = ptr;
        WasmWalletFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmWalletFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmwallet_free(ptr, 0);
    }
    /**
     * Creates a fresh spendable UTXO handle owned by this wallet (useful for testing flows and
     * self-transfer construction before on-chain confirmation).
     * @param {bigint} value_micro
     * @returns {WasmWalletOutput}
     */
    createSelfUtxo(value_micro) {
        const ret = wasm.wasmwallet_createSelfUtxo(this.__wbg_ptr, value_micro);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmWalletOutput.__wrap(ret[0]);
    }
    /**
     * Debug: hashes range-proof hex with Tari's domain hasher (matches chain rangeproof_hash).
     * @param {string} range_proof_hex
     * @returns {string}
     */
    static debugHashRangeProof(range_proof_hex) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(range_proof_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.wasmwallet_debugHashRangeProof(ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Restores a wallet from an enciphered seed blob (see `getBackupHex`).
     * @param {string} backup_hex
     * @param {string} network
     * @returns {WasmWallet}
     */
    static fromBackupHex(backup_hex, network) {
        const ptr0 = passStringToWasm0(backup_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(network, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmwallet_fromBackupHex(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmWallet.__wrap(ret[0]);
    }
    /**
     * The wallet's own dual one-sided payment address.
     * @returns {WasmTariAddress}
     */
    getAddress() {
        const ret = wasm.wasmwallet_getAddress(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmTariAddress.__wrap(ret[0]);
    }
    /**
     * Exports the wallet seed as an enciphered hex blob for persistence.
     * @returns {string}
     */
    getBackupHex() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.wasmwallet_getBackupHex(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Recovers a spendable output owned by this wallet from scanned chain data.
     *
     * The encrypted value/mask are decrypted internally (view-key and DH stealth flows), verified
     * against the commitment, and the resulting UTXO becomes spendable by `WasmTxBuilder`.
     * @param {string} commitment_hex
     * @param {string} encrypted_data_hex
     * @param {string} sender_offset_pub_hex
     * @param {string} script_hex
     * @param {string} metadata_sig_hex
     * @param {bigint} minimum_value_promise_micro
     * @param {bigint} maturity
     * @param {number} output_type_byte
     * @param {number} range_proof_type_byte
     * @param {string} coinbase_extra_hex
     * @param {string} covenant_hex
     * @param {string} range_proof_hex
     * @param {string} output_hash_hex
     * @returns {WasmWalletOutput}
     */
    importScannedOutput(commitment_hex, encrypted_data_hex, sender_offset_pub_hex, script_hex, metadata_sig_hex, minimum_value_promise_micro, maturity, output_type_byte, range_proof_type_byte, coinbase_extra_hex, covenant_hex, range_proof_hex, output_hash_hex) {
        const ptr0 = passStringToWasm0(commitment_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(encrypted_data_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(sender_offset_pub_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(script_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(metadata_sig_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passStringToWasm0(coinbase_extra_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len5 = WASM_VECTOR_LEN;
        const ptr6 = passStringToWasm0(covenant_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len6 = WASM_VECTOR_LEN;
        const ptr7 = passStringToWasm0(range_proof_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len7 = WASM_VECTOR_LEN;
        const ptr8 = passStringToWasm0(output_hash_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len8 = WASM_VECTOR_LEN;
        const ret = wasm.wasmwallet_importScannedOutput(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, minimum_value_promise_micro, maturity, output_type_byte, range_proof_type_byte, ptr5, len5, ptr6, len6, ptr7, len7, ptr8, len8);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmWalletOutput.__wrap(ret[0]);
    }
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
     * @param {string} commitment_hex
     * @param {string} encrypted_data_hex
     * @param {string} sender_offset_pub_hex
     * @returns {boolean}
     */
    isOutputMine(commitment_hex, encrypted_data_hex, sender_offset_pub_hex) {
        const ptr0 = passStringToWasm0(commitment_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(encrypted_data_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(sender_offset_pub_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmwallet_isOutputMine(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * @param {string} network
     */
    constructor(network) {
        const ptr0 = passStringToWasm0(network, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmwallet_new(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmWalletFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Debug: build marker to verify the served wasm is current.
     * @returns {string}
     */
    static wasmBuildMarker() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmwallet_wasmBuildMarker();
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) WasmWallet.prototype[Symbol.dispose] = WasmWallet.prototype.free;

/**
 * A spendable output owned by a `WasmWallet`.
 */
export class WasmWalletOutput {
    static __wrap(ptr) {
        const obj = Object.create(WasmWalletOutput.prototype);
        obj.__wbg_ptr = ptr;
        WasmWalletOutputFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmWalletOutputFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmwalletoutput_free(ptr, 0);
    }
    /**
     * The chain-stored output hash (if this output was imported from scanned chain data).
     * @returns {string | undefined}
     */
    get chainOutputHash() {
        const ret = wasm.wasmwalletoutput_chainOutputHash(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * @returns {string}
     */
    get commitmentHex() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmwalletoutput_commitmentHex(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * The payment id the sender attached, as raw bytes — empty when the output carries no memo.
     * Matching these against a sub-address's payment id is what attributes a received payment.
     * @returns {Uint8Array}
     */
    get paymentId() {
        const ret = wasm.wasmwalletoutput_paymentId(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * The payment id as UTF-8 text, when it is valid UTF-8 — sub-addresses created by this wallet
     * use the label itself, so this is normally the human-readable label.
     * @returns {string | undefined}
     */
    get paymentIdText() {
        const ret = wasm.wasmwalletoutput_paymentIdText(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * Error from the last compact-input seeding attempt, if any.
     * @returns {string | undefined}
     */
    get seedError() {
        const ret = wasm.wasmwalletoutput_seedError(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * The sender's base58 address, when their wallet included one in the memo.
     *
     * Absent for anything that did not: coinbase/mining rewards, wallets that do not attach a
     * sender address, and anyone who deliberately stayed anonymous. A one-sided payment is
     * unlinkable to its sender on-chain, so this is a courtesy from the sender, never a
     * guarantee — and never something to treat as proof of who paid.
     * @returns {string | undefined}
     */
    get senderAddress() {
        const ret = wasm.wasmwalletoutput_senderAddress(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * The fee the sender recorded paying for this payment, when the memo carries one.
     * @returns {bigint | undefined}
     */
    get senderFeeMicro() {
        const ret = wasm.wasmwalletoutput_senderFeeMicro(this.__wbg_ptr);
        return ret[0] === 0 ? undefined : BigInt.asUintN(64, ret[1]);
    }
    /**
     * @returns {bigint}
     */
    get valueMicro() {
        const ret = wasm.wasmwalletoutput_valueMicro(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
}
if (Symbol.dispose) WasmWalletOutput.prototype[Symbol.dispose] = WasmWalletOutput.prototype.free;

/**
 * Formats an amount in micro-Minotari as a human-readable currency string.
 * `separator` is the thousands separator (e.g. ',' or '.').
 * @param {bigint} micro_minotari
 * @param {string} separator
 * @returns {string}
 */
export function amountToCurrencyString(micro_minotari, separator) {
    let deferred2_0;
    let deferred2_1;
    try {
        const char0 = separator.codePointAt(0);
        _assertChar(char0);
        const ret = wasm.amountToCurrencyString(micro_minotari, char0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * BLAKE2b-256 hash of the input bytes, hex encoded. Matches Tari's 256-bit Blake2b usage.
 * @param {Uint8Array} data
 * @returns {string}
 */
export function blake2b256Hex(data) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.blake2b256Hex(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * BLAKE2b-512 hash of the input bytes, hex encoded. This is the digest Tari uses for Schnorr challenges.
 * @param {Uint8Array} data
 * @returns {string}
 */
export function blake2b512Hex(data) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.blake2b512Hex(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Computes the absolute transaction fee (in micro-Minotari) using the latest transaction weights.
 * @param {bigint} fee_per_gram_micro
 * @param {number} num_kernels
 * @param {number} num_inputs
 * @param {number} num_outputs
 * @param {number} features_and_scripts_byte_size
 * @returns {bigint}
 */
export function calculateFee(fee_per_gram_micro, num_kernels, num_inputs, num_outputs, features_and_scripts_byte_size) {
    const ret = wasm.calculateFee(fee_per_gram_micro, num_kernels, num_inputs, num_outputs, features_and_scripts_byte_size);
    return BigInt.asUintN(64, ret);
}

/**
 * Creates a compressed Pedersen commitment for `value` (in micro-Minotari) under the given blinding factor.
 * @param {string} blinding_factor_hex
 * @param {bigint} value
 * @returns {string}
 */
export function commitValue(blinding_factor_hex, value) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(blinding_factor_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.commitValue(ptr0, len0, value);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Returns true if the blinding factor and value open the given (hex-encoded, compressed) commitment.
 * @param {string} blinding_factor_hex
 * @param {bigint} value
 * @param {string} commitment_hex
 * @returns {boolean}
 */
export function openValue(blinding_factor_hex, value, commitment_hex) {
    const ptr0 = passStringToWasm0(blinding_factor_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(commitment_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.openValue(ptr0, len0, value, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * Parses a human-readable Minotari amount string (e.g. "12.345678 T" or "1234567") into micro-Minotari.
 * @param {string} s
 * @returns {bigint}
 */
export function parseAmount(s) {
    const ptr0 = passStringToWasm0(s, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.parseAmount(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return BigInt.asUintN(64, ret[0]);
}
export function __wbg___wbindgen_is_function_1ff95bcc5517c252(arg0) {
    const ret = typeof(arg0) === 'function';
    return ret;
}
export function __wbg___wbindgen_is_object_a27215656b807791(arg0) {
    const val = arg0;
    const ret = typeof(val) === 'object' && val !== null;
    return ret;
}
export function __wbg___wbindgen_is_string_ea5e6cc2e4141dfe(arg0) {
    const ret = typeof(arg0) === 'string';
    return ret;
}
export function __wbg___wbindgen_is_undefined_c05833b95a3cf397(arg0) {
    const ret = arg0 === undefined;
    return ret;
}
export function __wbg___wbindgen_throw_344f42d3211c4765(arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
}
export function __wbg_call_a6e5c5dce5018821() { return handleError(function (arg0, arg1, arg2) {
    const ret = arg0.call(arg1, arg2);
    return ret;
}, arguments); }
export function __wbg_crypto_38df2bab126b63dc(arg0) {
    const ret = arg0.crypto;
    return ret;
}
export function __wbg_getRandomValues_c44a50d8cfdaebeb() { return handleError(function (arg0, arg1) {
    arg0.getRandomValues(arg1);
}, arguments); }
export function __wbg_getRandomValues_cc7f052a444bb2ce() { return handleError(function (arg0, arg1) {
    globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
}, arguments); }
export function __wbg_length_1f0964f4a5e2c6d8(arg0) {
    const ret = arg0.length;
    return ret;
}
export function __wbg_msCrypto_bd5a034af96bcba6(arg0) {
    const ret = arg0.msCrypto;
    return ret;
}
export function __wbg_new_with_length_e6785c33c8e4cce8(arg0) {
    const ret = new Uint8Array(arg0 >>> 0);
    return ret;
}
export function __wbg_node_84ea875411254db1(arg0) {
    const ret = arg0.node;
    return ret;
}
export function __wbg_now_86c0d4ba3fa605b8() {
    const ret = Date.now();
    return ret;
}
export function __wbg_process_44c7a14e11e9f69e(arg0) {
    const ret = arg0.process;
    return ret;
}
export function __wbg_prototypesetcall_4770620bbe4688a0(arg0, arg1, arg2) {
    Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
}
export function __wbg_randomFillSync_6c25eac9869eb53c() { return handleError(function (arg0, arg1) {
    arg0.randomFillSync(arg1);
}, arguments); }
export function __wbg_require_b4edbdcf3e2a1ef0() { return handleError(function () {
    const ret = module.require;
    return ret;
}, arguments); }
export function __wbg_static_accessor_GLOBAL_4ef717fb391d88b7() {
    const ret = typeof global === 'undefined' ? null : global;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}
export function __wbg_static_accessor_GLOBAL_THIS_8d1badc68b5a74f4() {
    const ret = typeof globalThis === 'undefined' ? null : globalThis;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}
export function __wbg_static_accessor_SELF_146583524fe1469b() {
    const ret = typeof self === 'undefined' ? null : self;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}
export function __wbg_static_accessor_WINDOW_f2829a2234d7819e() {
    const ret = typeof window === 'undefined' ? null : window;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}
export function __wbg_subarray_3ed232c8a6baee09(arg0, arg1, arg2) {
    const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
    return ret;
}
export function __wbg_versions_276b2795b1c6a219(arg0) {
    const ret = arg0.versions;
    return ret;
}
export function __wbindgen_cast_0000000000000001(arg0, arg1) {
    // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
    const ret = getArrayU8FromWasm0(arg0, arg1);
    return ret;
}
export function __wbindgen_cast_0000000000000002(arg0, arg1) {
    // Cast intrinsic for `Ref(String) -> Externref`.
    const ret = getStringFromWasm0(arg0, arg1);
    return ret;
}
export function __wbindgen_init_externref_table() {
    const table = wasm.__wbindgen_externrefs;
    const offset = table.grow(4);
    table.set(0, undefined);
    table.set(offset + 0, undefined);
    table.set(offset + 1, null);
    table.set(offset + 2, true);
    table.set(offset + 3, false);
}
const WasmBurnBuilderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmburnbuilder_free(ptr, 1));
const WasmKeyPairFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmkeypair_free(ptr, 1));
const WasmSchnorrSignatureFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmschnorrsignature_free(ptr, 1));
const WasmSignedBurnFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmsignedburn_free(ptr, 1));
const WasmSignedTransactionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmsignedtransaction_free(ptr, 1));
const WasmTariAddressFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmtariaddress_free(ptr, 1));
const WasmTxBuilderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmtxbuilder_free(ptr, 1));
const WasmWalletFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmwallet_free(ptr, 1));
const WasmWalletOutputFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmwalletoutput_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertChar(c) {
    if (typeof(c) === 'number' && (c >= 0x110000 || (c >= 0xD800 && c < 0xE000))) throw new Error(`expected a valid Unicode scalar value, found ${c}`);
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;


let wasm;
export function __wbg_set_wasm(val) {
    wasm = val;
}
