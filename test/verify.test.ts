import { describe, expect, it } from "vitest";
import {
  importDiscordPublicKey,
  verifyDiscordRequest,
} from "../src/discord/verify.js";

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function makeSignedRequest(body: string, timestamp: string) {
  const keyPair = (await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const rawPublic = new Uint8Array(
    (await crypto.subtle.exportKey("raw", keyPair.publicKey)) as ArrayBuffer,
  );
  const message = new TextEncoder().encode(timestamp + body);
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "Ed25519" }, keyPair.privateKey, message),
  );
  return {
    publicKeyHex: bytesToHex(rawPublic),
    signatureHex: bytesToHex(signature),
  };
}

describe("verifyDiscordRequest", () => {
  it("accepts a correctly signed request", async () => {
    const body = JSON.stringify({ type: 1 });
    const timestamp = "1700000000";
    const { publicKeyHex, signatureHex } = await makeSignedRequest(body, timestamp);
    const key = await importDiscordPublicKey(publicKeyHex);
    expect(await verifyDiscordRequest(key, signatureHex, timestamp, body)).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const body = JSON.stringify({ type: 1 });
    const timestamp = "1700000000";
    const { publicKeyHex, signatureHex } = await makeSignedRequest(body, timestamp);
    const key = await importDiscordPublicKey(publicKeyHex);
    expect(
      await verifyDiscordRequest(key, signatureHex, timestamp, body + "x"),
    ).toBe(false);
  });

  it("rejects missing signature headers", async () => {
    const { publicKeyHex } = await makeSignedRequest("{}", "1");
    const key = await importDiscordPublicKey(publicKeyHex);
    expect(await verifyDiscordRequest(key, null, null, "{}")).toBe(false);
  });
});
