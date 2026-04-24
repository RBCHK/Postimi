/**
 * Round-trip + tamper-resistance tests for the AES-256-GCM token
 * encryption that protects OAuth tokens at rest.
 *
 * The data at rest is row-level secrets (X/LinkedIn/Threads refresh
 * tokens). These tests lock in:
 *   1. encrypt → decrypt round-trips for typical token shapes.
 *   2. Rotating `TOKEN_ENCRYPTION_KEY` makes ciphertext undecryptable
 *      under the new key (intended — we don't support graceful rotation
 *      yet; rotation means re-encrypt everything or lose access).
 *   3. Two encryptions of the same plaintext produce DIFFERENT
 *      ciphertext (IV-based — fresh nonce every call). This matters for
 *      traffic analysis: two identical stored ciphertexts would leak
 *      that two users share a token.
 *   4. Malformed ciphertext throws a typed error, not a silent null.
 *   5. Wrong env-var lengths throw a loud error at encrypt time rather
 *      than producing an unusable value.
 *
 * NOTE: we never check the exact plaintext matches a hard-coded value —
 * that could mask a future output-encoding change. We compare
 * `decrypt(encrypt(x)) === x` round-trips.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

const ORIGINAL_KEY = process.env.TOKEN_ENCRYPTION_KEY;

// Two distinct 64-hex (32-byte) keys for rotation tests. Hex characters
// are chosen so the keys are obviously distinct.
const KEY_A = "1111111111111111111111111111111111111111111111111111111111111111";
const KEY_B = "2222222222222222222222222222222222222222222222222222222222222222";

beforeEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY = KEY_A;
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
  else process.env.TOKEN_ENCRYPTION_KEY = ORIGINAL_KEY;
});

describe("token-encryption — round-trip", () => {
  it("encrypt → decrypt returns the original plaintext", async () => {
    const { encryptToken, decryptToken } = await import("@/lib/token-encryption");
    const plaintext = `test-plaintext-${Date.now()}`;
    const ciphertext = encryptToken(plaintext);
    expect(ciphertext).not.toBe(plaintext);
    expect(decryptToken(ciphertext)).toBe(plaintext);
  });

  it("handles unicode plaintext (UTF-8 multi-byte)", async () => {
    const { encryptToken, decryptToken } = await import("@/lib/token-encryption");
    // Cyrillic + emoji + newline exercise multi-byte + control chars.
    const plaintext = "пароль-секрет\n" + String.fromCodePoint(0x1f512) + "-123";
    expect(decryptToken(encryptToken(plaintext))).toBe(plaintext);
  });

  it("handles empty string (edge case for token format assumptions)", async () => {
    const { encryptToken, decryptToken } = await import("@/lib/token-encryption");
    expect(decryptToken(encryptToken(""))).toBe("");
  });

  it("handles long tokens (realistic refresh-token lengths)", async () => {
    const { encryptToken, decryptToken } = await import("@/lib/token-encryption");
    // OAuth refresh tokens are often 200-500 bytes; go bigger to be safe.
    const plaintext = "t-" + "x".repeat(4096);
    expect(decryptToken(encryptToken(plaintext))).toBe(plaintext);
  });

  it("ciphertext uses the v1: prefix", async () => {
    const { encryptToken } = await import("@/lib/token-encryption");
    const ciphertext = encryptToken("hello");
    expect(ciphertext.startsWith("v1:")).toBe(true);
    // Format is v1:<iv>:<authTag>:<data>, all base64 — four parts total.
    expect(ciphertext.split(":")).toHaveLength(4);
  });
});

describe("token-encryption — nondeterminism (IV-based)", () => {
  it("two encryptions of the same plaintext produce different ciphertext", async () => {
    const { encryptToken, decryptToken } = await import("@/lib/token-encryption");
    const plaintext = `shared-${Date.now()}`;
    const c1 = encryptToken(plaintext);
    const c2 = encryptToken(plaintext);
    // Different IVs → different ciphertexts.
    expect(c1).not.toBe(c2);
    // Both round-trip correctly.
    expect(decryptToken(c1)).toBe(plaintext);
    expect(decryptToken(c2)).toBe(plaintext);
  });

  it("IV component is different on each encrypt", async () => {
    const { encryptToken } = await import("@/lib/token-encryption");
    const c1 = encryptToken("x").split(":");
    const c2 = encryptToken("x").split(":");
    // parts: [version, iv, authTag, data] — IV must differ between calls.
    expect(c1[1]).not.toBe(c2[1]);
  });

  it("100 encrypts of the same plaintext produce 100 distinct ciphertexts (IV entropy)", async () => {
    const { encryptToken } = await import("@/lib/token-encryption");
    const plaintext = "repeat-me";
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) {
      set.add(encryptToken(plaintext));
    }
    // If any two encryptions collide, IV generation is broken (e.g. seeded
    // or reused) — a catastrophic GCM failure (nonce reuse breaks confidentiality).
    expect(set.size).toBe(100);
  });
});

describe("token-encryption — key rotation", () => {
  it("ciphertext encrypted under KEY_A fails to decrypt under KEY_B", async () => {
    const { encryptToken, decryptToken } = await import("@/lib/token-encryption");
    const plaintext = "secret-token";
    process.env.TOKEN_ENCRYPTION_KEY = KEY_A;
    const ciphertext = encryptToken(plaintext);

    // Rotate key — decryption under the new key must NOT succeed. If it
    // did, we'd silently decrypt garbage and write nonsense to the user's
    // integrations.
    process.env.TOKEN_ENCRYPTION_KEY = KEY_B;
    expect(() => decryptToken(ciphertext)).toThrow();
  });

  it("ciphertext encrypted and decrypted under the same key round-trips", async () => {
    const { encryptToken, decryptToken } = await import("@/lib/token-encryption");
    const plaintext = "secret-token";
    process.env.TOKEN_ENCRYPTION_KEY = KEY_B;
    const ciphertext = encryptToken(plaintext);
    expect(decryptToken(ciphertext)).toBe(plaintext);
  });
});

describe("token-encryption — bad input handling", () => {
  it("decrypt on malformed format (wrong version) throws", async () => {
    const { decryptToken } = await import("@/lib/token-encryption");
    expect(() => decryptToken("v2:aaa:bbb:ccc")).toThrow(/Unsupported token format/);
  });

  it("decrypt on too few parts throws", async () => {
    const { decryptToken } = await import("@/lib/token-encryption");
    expect(() => decryptToken("v1:only-one-part")).toThrow(/Unsupported token format/);
  });

  it("decrypt on a completely unrelated string throws", async () => {
    const { decryptToken } = await import("@/lib/token-encryption");
    // Someone stores an unencrypted token by mistake; must NOT come back as-is.
    expect(() => decryptToken("plain-text-leaked-into-db")).toThrow();
  });

  it("decrypt on tampered ciphertext throws (GCM auth tag catches bit-flips)", async () => {
    const { encryptToken, decryptToken } = await import("@/lib/token-encryption");
    const good = encryptToken("sensitive");
    const parts = good.split(":");
    // Flip the last byte of the ciphertext (data section) by re-encoding
    // to buffer, XOR-ing one byte, and re-encoding back to base64.
    const data = Buffer.from(parts[3]!, "base64");
    data[data.length - 1] = data[data.length - 1]! ^ 0x01;
    const tampered = [parts[0], parts[1], parts[2], data.toString("base64")].join(":");

    expect(() => decryptToken(tampered)).toThrow();
  });

  it("decrypt on tampered auth tag throws (separate path from ciphertext tamper)", async () => {
    const { encryptToken, decryptToken } = await import("@/lib/token-encryption");
    const good = encryptToken("sensitive");
    const parts = good.split(":");
    // Flip one bit of the GCM auth tag only. Auth tag is cryptographically
    // bound to (key, iv, aad=none, ciphertext); any bit flip here must fail
    // closed. A regression that skipped setAuthTag() would mask this.
    const tag = Buffer.from(parts[2]!, "base64");
    tag[0] = tag[0]! ^ 0x80;
    const tampered = [parts[0], parts[1], tag.toString("base64"), parts[3]].join(":");

    expect(() => decryptToken(tampered)).toThrow();
  });

  it("decrypt on tampered IV throws", async () => {
    const { encryptToken, decryptToken } = await import("@/lib/token-encryption");
    const good = encryptToken("sensitive");
    const parts = good.split(":");
    // Flip IV — GCM auth tag is bound to IV, so any change must fail closed.
    const iv = Buffer.from(parts[1]!, "base64");
    iv[0] = iv[0]! ^ 0x80;
    const tampered = [parts[0], iv.toString("base64"), parts[2], parts[3]].join(":");

    expect(() => decryptToken(tampered)).toThrow();
  });

  it("encrypt throws when TOKEN_ENCRYPTION_KEY is unset", async () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    // Dynamic import after env change so getEncryptionKey reads the new state.
    const { encryptToken } = await import("@/lib/token-encryption");
    expect(() => encryptToken("x")).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it("encrypt throws when TOKEN_ENCRYPTION_KEY has wrong length", async () => {
    // 60 hex chars = 30 bytes, not 32.
    process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(60);
    const { encryptToken } = await import("@/lib/token-encryption");
    expect(() => encryptToken("x")).toThrow(/64-character hex|32 bytes/);
  });
});
