import { describe, expect, it } from "bun:test";
import { faker } from "@faker-js/faker";
import { buildJwtClaims, hashPassword, verifyPassword } from "../../src/services/auth.service.ts";
import { Role } from "../../src/types/enums.ts";
import { makeUserRow } from "../helpers/factories.ts";

// ---------------------------------------------------------------------------
// hashPassword
// ---------------------------------------------------------------------------

describe("hashPassword", () => {
  it("returns a non-empty string", async () => {
    const hash = await hashPassword(faker.internet.password(), 1);
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });

  it("returns a bcrypt hash starting with the $2 prefix", async () => {
    const hash = await hashPassword(faker.internet.password({ length: 16 }), 1);
    expect(hash.startsWith("$2")).toBe(true);
  });

  it("hash is different from the original plaintext", async () => {
    const plaintext = faker.internet.password({ length: 12 });
    const hash = await hashPassword(plaintext, 1);
    expect(hash).not.toBe(plaintext);
  });

  it("produces a distinct hash each time (salt uniqueness)", async () => {
    const plaintext = faker.internet.password({ length: 12 });
    const h1 = await hashPassword(plaintext, 1);
    const h2 = await hashPassword(plaintext, 1);
    expect(h1).not.toBe(h2);
  });

  it("produces different hashes for different passwords", async () => {
    const p1 = faker.internet.password({ length: 12 });
    const p2 = faker.internet.password({ length: 14 });
    const h1 = await hashPassword(p1, 1);
    const h2 = await hashPassword(p2, 1);
    expect(h1).not.toBe(h2);
  });

  it("works with Unicode characters in the password", async () => {
    const hash = await hashPassword("p@ssw0rd-Ünïcödé!", 1);
    expect(hash.startsWith("$2")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// verifyPassword
// ---------------------------------------------------------------------------

describe("verifyPassword", () => {
  it("returns true when the plaintext matches the stored hash", async () => {
    const plaintext = faker.internet.password({ length: 16 });
    const hash = await hashPassword(plaintext, 1);
    expect(await verifyPassword(plaintext, hash)).toBe(true);
  });

  it("returns false when the plaintext does not match", async () => {
    const hash = await hashPassword(faker.internet.password({ length: 12 }), 1);
    const wrong = faker.internet.password({ length: 12 });
    expect(await verifyPassword(wrong, hash)).toBe(false);
  });

  it("returns false for an empty string against a valid hash", async () => {
    const hash = await hashPassword("original", 1);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("returns false for a similar-but-not-equal password (case difference)", async () => {
    const hash = await hashPassword("Password123", 1);
    expect(await verifyPassword("password123", hash)).toBe(false);
  });

  it("returns false for a hash that was produced from a different password", async () => {
    const hashA = await hashPassword("alpha", 1);
    const hashB = await hashPassword("beta", 1);
    // Cross-check: A's hash does not match B's plaintext
    expect(await verifyPassword("alpha", hashB)).toBe(false);
    expect(await verifyPassword("beta", hashA)).toBe(false);
  });

  it("is consistently true across 5 hash/verify round trips", async () => {
    for (let i = 0; i < 5; i++) {
      const p = faker.internet.password({ length: 10 });
      const h = await hashPassword(p, 1);
      expect(await verifyPassword(p, h)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// buildJwtClaims
// ---------------------------------------------------------------------------

describe("buildJwtClaims", () => {
  it("maps userId, email, and role from the user row", () => {
    const user = makeUserRow();
    const claims = buildJwtClaims(user);
    expect(claims.userId).toBe(user.id);
    expect(claims.email).toBe(user.email);
    expect(claims.role).toBe(user.role);
  });

  it("does not leak the password hash into the claims", () => {
    const user = makeUserRow();
    const claims = buildJwtClaims(user) as Record<string, unknown>;
    expect(Object.keys(claims)).not.toContain("passwordHash");
    expect(Object.keys(claims)).not.toContain("password_hash");
  });

  it("does not include the createdAt timestamp in the claims", () => {
    const user = makeUserRow();
    const claims = buildJwtClaims(user) as Record<string, unknown>;
    expect(Object.keys(claims)).not.toContain("createdAt");
  });

  it("correctly maps the admin role", () => {
    const admin = makeUserRow({ role: Role.Admin });
    expect(buildJwtClaims(admin).role).toBe(Role.Admin);
  });

  it("correctly maps the user role", () => {
    const user = makeUserRow({ role: Role.User });
    expect(buildJwtClaims(user).role).toBe(Role.User);
  });

  it("produces a stable result across multiple calls for the same row", () => {
    const user = makeUserRow();
    const claims1 = buildJwtClaims(user);
    const claims2 = buildJwtClaims(user);
    expect(claims1).toEqual(claims2);
  });

  it("produces different claims for different users", () => {
    const u1 = makeUserRow();
    const u2 = makeUserRow();
    expect(buildJwtClaims(u1)).not.toEqual(buildJwtClaims(u2));
  });
});
