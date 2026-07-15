/**
 * Discord signs every interaction request with Ed25519. We verify the signature
 * using the Web Crypto API, which is available identically in Cloudflare Workers
 * and in Node's test runtime, so the same code path is exercised by tests.
 */

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return null;
    bytes[i] = byte;
  }
  return bytes;
}

const encoder = new TextEncoder();

export async function importDiscordPublicKey(
  publicKeyHex: string,
): Promise<CryptoKey> {
  const raw = hexToBytes(publicKeyHex);
  if (!raw) throw new Error("DISCORD_PUBLIC_KEY must be valid hex");
  return crypto.subtle.importKey(
    "raw",
    raw as unknown as ArrayBuffer,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
}

/**
 * Verify a raw interaction request body against the `X-Signature-*` headers.
 * Returns true only for authentic, well-formed requests.
 */
export async function verifyDiscordRequest(
  publicKey: CryptoKey,
  signatureHex: string | null,
  timestamp: string | null,
  rawBody: string,
): Promise<boolean> {
  if (!signatureHex || !timestamp) return false;
  const signature = hexToBytes(signatureHex);
  if (!signature) return false;
  const message = encoder.encode(timestamp + rawBody);
  try {
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      signature as unknown as ArrayBuffer,
      message as unknown as ArrayBuffer,
    );
  } catch {
    return false;
  }
}
