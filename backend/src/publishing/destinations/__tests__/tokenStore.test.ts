import { AesGcmTokenStore, InMemoryTokenVault } from "../tokenStore";

describe("AesGcmTokenStore", () => {
  const key = "test-key-not-a-real-secret";

  it("round-trips encrypt/decrypt", () => {
    const store = new AesGcmTokenStore(key);
    const secret = "oauth-token-12345";
    const cipher = store.encrypt(secret);
    expect(cipher).not.toContain(secret);
    expect(store.decrypt(cipher)).toBe(secret);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const store = new AesGcmTokenStore(key);
    const a = store.encrypt("same");
    const b = store.encrypt("same");
    expect(a).not.toBe(b);
    expect(store.decrypt(a)).toBe("same");
    expect(store.decrypt(b)).toBe("same");
  });

  it("fails to decrypt tampered ciphertext (auth tag)", () => {
    const store = new AesGcmTokenStore(key);
    const cipher = store.encrypt("secret");
    const tampered = cipher.slice(0, -2) + (cipher.endsWith("A") ? "B" : "A");
    expect(() => store.decrypt(tampered)).toThrow();
  });
});

describe("InMemoryTokenVault (encrypted at rest)", () => {
  it("stores and retrieves a token without keeping plaintext", async () => {
    const vault = new InMemoryTokenVault(new AesGcmTokenStore("vault-key"));
    await vault.store("user-1", "google-drive", "super-secret-token");
    // The internal map must hold only ciphertext.
    const cipher = (vault as any).vault.get("user-1:google-drive");
    expect(cipher).toBeDefined();
    expect(cipher).not.toContain("super-secret-token");
    expect(await vault.retrieve("user-1", "google-drive")).toBe("super-secret-token");
  });

  it("returns null for unknown (user, provider) and supports revoke", async () => {
    const vault = new InMemoryTokenVault(new AesGcmTokenStore("vault-key"));
    expect(await vault.retrieve("user-2", "onedrive")).toBeNull();
    await vault.store("user-2", "onedrive", "tok");
    expect(await vault.retrieve("user-2", "onedrive")).toBe("tok");
    await vault.revoke("user-2", "onedrive");
    expect(await vault.retrieve("user-2", "onedrive")).toBeNull();
  });
});
