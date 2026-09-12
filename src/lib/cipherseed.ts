import {
  decipherSeed,
  encipherSeed,
  importWalletSeed,
  isPlausibleMnemonic,
  seedToMnemonic,
} from "tari-cipherseed";

export function hexToBytes(hex: string): Uint8Array {
  const s = hex.trim().toLowerCase().replace(/^0x/, "");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function isPlausibleSeedPhrase(mnemonic: string): boolean {
  try {
    return isPlausibleMnemonic(mnemonic);
  } catch {
    return false;
  }
}

export async function exportSeedPhrase(backupHex: string): Promise<string[]> {
  const seed = await decipherSeed(hexToBytes(backupHex));
  const mnemonic = await seedToMnemonic(seed);
  return mnemonic.trim().split(/\s+/);
}

export async function seedPhraseToBackupHex(mnemonic: string): Promise<string> {
  const seed = await importWalletSeed(mnemonic);
  const enciphered = await encipherSeed(seed);
  return bytesToHex(enciphered);
}

export async function seedPhraseToWallet(mnemonic: string): Promise<{
  backupHex: string;
  birthdayMs: number;
}> {
  const seed = await importWalletSeed(mnemonic);
  const enciphered = await encipherSeed(seed);
  const birthdayMs = seed.birthday * 86_400_000;
  return { backupHex: bytesToHex(enciphered), birthdayMs };
}

export async function generateSeedPhrase(): Promise<{
  mnemonic: string;
  backupHex: string;
}> {
  const { createWalletSeed } = await import("tari-cipherseed");
  const { seed, mnemonic } = await createWalletSeed();
  const enciphered = await encipherSeed(seed);
  return { mnemonic, backupHex: bytesToHex(enciphered) };
}
