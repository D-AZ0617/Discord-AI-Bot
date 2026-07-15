/**
 * Envelope encryption for bring-your-own-key (BYOK) provider credentials.
 *
 * Provider API keys are encrypted with AES-256-GCM before being stored in
 * Supabase. Master keys live only in Cloudflare secrets and are versioned so
 * they can be rotated: new secrets are encrypted with the highest version while
 * existing ciphertext can still be decrypted with older versions.
 *
 * Key material format (env `CREDENTIAL_ENCRYPTION_KEYS`):
 *   "1:<base64 32-byte key>,2:<base64 32-byte key>"
 */

export interface EncryptedSecret {
  ciphertext: string; // base64
  iv: string; // base64
  keyVersion: number;
}

interface VersionedKey {
  version: number;
  key: CryptoKey;
}

export interface KeyRing {
  encryptKey: VersionedKey;
  byVersion: Map<number, CryptoKey>;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 32) {
    throw new Error("Encryption keys must be 32 bytes (base64-encoded).");
  }
  return crypto.subtle.importKey(
    "raw",
    raw as unknown as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Parse and import all configured master keys into a usable key ring. */
export async function loadKeyRing(spec: string): Promise<KeyRing> {
  const entries = spec
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEYS must define at least one key.");
  }

  const byVersion = new Map<number, CryptoKey>();
  let highest: VersionedKey | null = null;
  for (const entry of entries) {
    const separator = entry.indexOf(":");
    if (separator === -1) {
      throw new Error("Each key must be formatted as 'version:base64key'.");
    }
    const version = Number(entry.slice(0, separator));
    if (!Number.isSafeInteger(version) || version <= 0) {
      throw new Error("Key version must be a positive integer.");
    }
    if (byVersion.has(version)) {
      throw new Error(`Duplicate key version: ${version}`);
    }
    const key = await importAesKey(base64ToBytes(entry.slice(separator + 1)));
    byVersion.set(version, key);
    if (!highest || version > highest.version) {
      highest = { version, key };
    }
  }
  return { encryptKey: highest!, byVersion };
}

export async function encryptSecret(
  ring: KeyRing,
  plaintext: string,
): Promise<EncryptedSecret> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as ArrayBuffer },
    ring.encryptKey.key,
    encoded as unknown as ArrayBuffer,
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    keyVersion: ring.encryptKey.version,
  };
}

export async function decryptSecret(
  ring: KeyRing,
  secret: EncryptedSecret,
): Promise<string> {
  const key = ring.byVersion.get(secret.keyVersion);
  if (!key) {
    throw new Error(
      `No encryption key available for version ${secret.keyVersion}.`,
    );
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(secret.iv) as unknown as ArrayBuffer },
    key,
    base64ToBytes(secret.ciphertext) as unknown as ArrayBuffer,
  );
  return new TextDecoder().decode(plaintext);
}
