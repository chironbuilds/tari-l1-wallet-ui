// One-time move of this app's pre-SDK Ootle storage (a single localStorage key this app's own,
// now-deleted src/ootle/storage.ts used to own) into @chironbuilder/ootle-sdk's own key. Without
// this, an existing visitor picking up the SDK-backed build would see their shielded-output
// ledger, in-flight shields, private-payment scan cursor, and substate-version cache all silently
// reset -- for the shielded ledger specifically that's not cosmetic: it's this wallet's only lead
// back to funds it has shielded (see the SDK's ShieldedOutputRecord doc comment), so losing it
// needs a rescan to even notice the funds again.
//
// The two shapes are identical field-for-field (this app's old storage.ts was itself already a
// hand-written port of the same shape the SDK formalizes), so this is a straight copy under the
// new key rather than a field-by-field reconstruction.
const OLD_KEY = "tari-l1-wallet/ootle/v1";
const NEW_KEY = "ootle-sdk/v1";
const MIGRATION_DONE_KEY = "ootle-sdk/migrated-from-v1";

export async function migrateOotleStorageOnce(): Promise<void> {
  try {
    if (localStorage.getItem(MIGRATION_DONE_KEY)) return;
    const old = localStorage.getItem(OLD_KEY);
    if (old !== null && localStorage.getItem(NEW_KEY) === null) {
      localStorage.setItem(NEW_KEY, old);
    }
    // Deliberately not removing the old key -- see the extension's equivalent migration for why
    // (leaving it is one less way this could ever destroy data it hasn't first proven it copied).
    localStorage.setItem(MIGRATION_DONE_KEY, "1");
  } catch {
    // Unavailable or over quota (private mode, storage disabled) -- behave as a fresh wallet
    // rather than taking the whole app down over a one-time migration.
  }
}
