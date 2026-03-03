import { describe, expect, it } from "bun:test";
import { faker } from "@faker-js/faker";
import { Option } from "effect";
import { parseSearchParams } from "../../src/services/search.service.ts";
import { runOk, runErr } from "../helpers/factories.ts";

// ---------------------------------------------------------------------------
describe("parseSearchParams", () => {
  // ── Defaults ──────────────────────────────────────────────────────────────

  it("returns sensible defaults for an empty query", () => {
    const p = runOk(parseSearchParams({}));
    expect(p.page).toBe(1);
    expect(p.limit).toBe(20);
    expect(p.sortBy).toBe("createdAt");
    expect(p.sortOrder).toBe("desc");
    expect(p.name).toEqual(Option.none());
    expect(p.contentType).toEqual(Option.none());
    expect(p.tags).toEqual(Option.none());
    expect(p.metadata).toEqual(Option.none());
    expect(p.ownerId).toEqual(Option.none());
  });

  // ── Pagination ────────────────────────────────────────────────────────────

  it("parses a valid page number", () => {
    expect(runOk(parseSearchParams({ page: "3" })).page).toBe(3);
  });

  it("accepts page = 1 (boundary)", () => {
    expect(runOk(parseSearchParams({ page: "1" })).page).toBe(1);
  });

  it("accepts a large valid page number", () => {
    expect(runOk(parseSearchParams({ page: "9999" })).page).toBe(9999);
  });

  it("rejects page = 0", () => {
    expect(runErr(parseSearchParams({ page: "0" }))).toMatchObject({ tag: "ValidationError" });
  });

  it("rejects a negative page", () => {
    expect(runErr(parseSearchParams({ page: "-1" }))).toMatchObject({ tag: "ValidationError" });
  });

  it("rejects a non-numeric page string", () => {
    expect(runErr(parseSearchParams({ page: "abc" }))).toMatchObject({ tag: "ValidationError" });
  });

  it("parses a valid limit", () => {
    expect(runOk(parseSearchParams({ limit: "50" })).limit).toBe(50);
  });

  it("accepts limit = 1 (lower boundary)", () => {
    expect(runOk(parseSearchParams({ limit: "1" })).limit).toBe(1);
  });

  it("accepts limit = 100 (upper boundary)", () => {
    expect(runOk(parseSearchParams({ limit: "100" })).limit).toBe(100);
  });

  it("rejects limit = 101 (exceeds maximum)", () => {
    expect(runErr(parseSearchParams({ limit: "101" }))).toMatchObject({ tag: "ValidationError" });
  });

  it("rejects limit = 0", () => {
    expect(runErr(parseSearchParams({ limit: "0" }))).toMatchObject({ tag: "ValidationError" });
  });

  it("rejects a negative limit", () => {
    expect(runErr(parseSearchParams({ limit: "-5" }))).toMatchObject({ tag: "ValidationError" });
  });

  // ── Sorting ───────────────────────────────────────────────────────────────

  it("accepts sortBy = 'name'", () => {
    expect(runOk(parseSearchParams({ sortBy: "name" })).sortBy).toBe("name");
  });

  it("accepts sortBy = 'updatedAt'", () => {
    expect(runOk(parseSearchParams({ sortBy: "updatedAt" })).sortBy).toBe("updatedAt");
  });

  it("accepts sortBy = 'createdAt'", () => {
    expect(runOk(parseSearchParams({ sortBy: "createdAt" })).sortBy).toBe("createdAt");
  });

  it("falls back to 'createdAt' for an unknown sortBy value", () => {
    const randomField = faker.word.noun();
    expect(runOk(parseSearchParams({ sortBy: randomField })).sortBy).toBe("createdAt");
  });

  it("accepts sortOrder = 'asc'", () => {
    expect(runOk(parseSearchParams({ sortOrder: "asc" })).sortOrder).toBe("asc");
  });

  it("accepts sortOrder = 'desc'", () => {
    expect(runOk(parseSearchParams({ sortOrder: "desc" })).sortOrder).toBe("desc");
  });

  it("falls back to 'desc' for an unrecognised sortOrder", () => {
    expect(runOk(parseSearchParams({ sortOrder: "random" })).sortOrder).toBe("desc");
  });

  // ── String filters ────────────────────────────────────────────────────────

  it("wraps a non-empty name in Option.some", () => {
    const name = faker.word.noun();
    expect(runOk(parseSearchParams({ name })).name).toEqual(Option.some(name));
  });

  it("trims whitespace from name", () => {
    expect(runOk(parseSearchParams({ name: "  report  " })).name).toEqual(
      Option.some("report"),
    );
  });

  it("treats a whitespace-only name as Option.none", () => {
    expect(runOk(parseSearchParams({ name: "   " })).name).toEqual(Option.none());
  });

  it("wraps a non-empty contentType in Option.some", () => {
    expect(runOk(parseSearchParams({ contentType: "application/pdf" })).contentType).toEqual(
      Option.some("application/pdf"),
    );
  });

  it("returns Option.none for undefined ownerId", () => {
    expect(runOk(parseSearchParams({})).ownerId).toEqual(Option.none());
  });

  it("wraps a valid ownerId in Option.some", () => {
    const ownerId = faker.string.uuid();
    expect(runOk(parseSearchParams({ ownerId })).ownerId).toEqual(Option.some(ownerId));
  });

  // ── Tags ──────────────────────────────────────────────────────────────────

  it("parses a single tag", () => {
    expect(runOk(parseSearchParams({ tags: "finance" })).tags).toEqual(
      Option.some(["finance"]),
    );
  });

  it("parses comma-separated tags and trims each entry", () => {
    expect(runOk(parseSearchParams({ tags: " finance , q1 , report " })).tags).toEqual(
      Option.some(["finance", "q1", "report"]),
    );
  });

  it("filters out blank entries between commas", () => {
    expect(runOk(parseSearchParams({ tags: "finance,,q1," })).tags).toEqual(
      Option.some(["finance", "q1"]),
    );
  });

  it("returns Option.none for an empty tags string", () => {
    expect(runOk(parseSearchParams({ tags: "" })).tags).toEqual(Option.none());
  });

  it("returns Option.none for a whitespace-only tags string", () => {
    expect(runOk(parseSearchParams({ tags: "   " })).tags).toEqual(Option.none());
  });

  it("returns Option.none for undefined tags", () => {
    expect(runOk(parseSearchParams({})).tags).toEqual(Option.none());
  });

  // ── Metadata ──────────────────────────────────────────────────────────────

  it("parses a valid JSON object metadata string", () => {
    const obj = { author: faker.person.firstName(), department: faker.commerce.department() };
    expect(runOk(parseSearchParams({ metadata: JSON.stringify(obj) })).metadata).toEqual(
      Option.some(obj),
    );
  });

  it("returns Option.none for empty metadata string", () => {
    expect(runOk(parseSearchParams({ metadata: "" })).metadata).toEqual(Option.none());
  });

  it("returns Option.none for whitespace-only metadata", () => {
    expect(runOk(parseSearchParams({ metadata: "  " })).metadata).toEqual(Option.none());
  });

  it("rejects malformed JSON in metadata", () => {
    expect(runErr(parseSearchParams({ metadata: "{bad json" }))).toMatchObject({
      tag: "ValidationError",
    });
  });

  it("rejects metadata that is a JSON array", () => {
    expect(runErr(parseSearchParams({ metadata: '["a","b"]' }))).toMatchObject({
      tag: "ValidationError",
    });
  });

  it("rejects metadata where a value is a number", () => {
    expect(runErr(parseSearchParams({ metadata: '{"count":42}' }))).toMatchObject({
      tag: "ValidationError",
    });
  });

  it("rejects metadata where a value is a nested object", () => {
    expect(
      runErr(parseSearchParams({ metadata: '{"nested":{"a":"b"}}' })),
    ).toMatchObject({ tag: "ValidationError" });
  });

  it("rejects null as top-level metadata value", () => {
    expect(runErr(parseSearchParams({ metadata: "null" }))).toMatchObject({
      tag: "ValidationError",
    });
  });

  // ── Combined params ───────────────────────────────────────────────────────

  it("parses all filters together correctly", () => {
    const ownerId = faker.string.uuid();
    const name = faker.word.noun();
    const p = runOk(
      parseSearchParams({
        ownerId,
        name,
        contentType: "application/pdf",
        tags: "finance,q1",
        metadata: '{"author":"alice"}',
        page: "2",
        limit: "15",
        sortBy: "name",
        sortOrder: "asc",
      }),
    );
    expect(p.ownerId).toEqual(Option.some(ownerId));
    expect(p.name).toEqual(Option.some(name));
    expect(p.contentType).toEqual(Option.some("application/pdf"));
    expect(p.tags).toEqual(Option.some(["finance", "q1"]));
    expect(p.metadata).toEqual(Option.some({ author: "alice" }));
    expect(p.page).toBe(2);
    expect(p.limit).toBe(15);
    expect(p.sortBy).toBe("name");
    expect(p.sortOrder).toBe("asc");
  });
});
