import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  loadKeyRing,
} from "../src/credentials/encrypt.js";

function randomKeySpec(version: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${version}:${btoa(binary)}`;
}

describe("credential encryption", () => {
  it("round-trips a secret", async () => {
    const ring = await loadKeyRing(randomKeySpec(1));
    const encrypted = await encryptSecret(ring, "key_live_abc123");
    expect(encrypted.keyVersion).toBe(1);
    expect(encrypted.ciphertext).not.toContain("key_live");
    const decrypted = await decryptSecret(ring, encrypted);
    expect(decrypted).toBe("key_live_abc123");
  });

  it("encrypts with the highest version but decrypts older versions", async () => {
    const spec1 = randomKeySpec(1);
    const spec2 = randomKeySpec(2);

    const ringV1Only = await loadKeyRing(spec1);
    const oldCiphertext = await encryptSecret(ringV1Only, "old-secret");
    expect(oldCiphertext.keyVersion).toBe(1);

    const fullRing = await loadKeyRing(`${spec1},${spec2}`);
    // New encryption uses version 2...
    const newCiphertext = await encryptSecret(fullRing, "new-secret");
    expect(newCiphertext.keyVersion).toBe(2);
    // ...but old ciphertext is still readable.
    expect(await decryptSecret(fullRing, oldCiphertext)).toBe("old-secret");
  });

  it("fails to decrypt when the key version is unavailable", async () => {
    const ringA = await loadKeyRing(randomKeySpec(1));
    const secret = await encryptSecret(ringA, "secret");
    const ringB = await loadKeyRing(randomKeySpec(2));
    await expect(decryptSecret(ringB, secret)).rejects.toThrow(/version 1/);
  });

  it("rejects malformed key specs", async () => {
    await expect(loadKeyRing("")).rejects.toThrow();
    await expect(loadKeyRing("nokey")).rejects.toThrow();
  });
});
