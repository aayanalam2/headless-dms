import { describe, expect, it } from "bun:test";
import { Effect, Either, Option } from "effect";
import { parseSearchParams } from "../../src/services/search.service.ts";
import type { AppError } from "../../src/types/errors.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function runOk<T>(effect: Effect.Effect<T, AppError>) {
  return Effect.runSync(effect);
}

function runErr(effect: Effect.Effect<unknown, AppError>): AppError {
  const result = Effect.runSync(Effect.either(effect));
  if (Either.isRight(result)) throw new Error("Expected failure but got success");
  return result.left;
}

// ---------------------------------------------------------------------------
describe("parseSearchParams", () => {
  it("returns defaults when given an empty query", () => {
    const params = runOk(parseSearchParams({}));
    expect(params.page).toBe(1);
    expect(params.limit).toBe(20);
    expect(params.sortBy).toBe("createdAt");
    expect(params.sortOrder).toBe("desc");
    expect(params.name).toEqual(Option.none());
    expect(params.contentType).toEqual(Option.none());
    expect(params.tags).toEqual(Option.none());
    expect(params.metadata).toEqual(Option.none());
    expect(params.ownerId).toEqual(Option.none());
  });

  it("parses valid page and limit", () => {
    const params = runOk(parseSearchParams({ page: "2", limit: "10" }));
    expect(params.page).toBe(2);
    expect(params.limit).toBe(10);
  });

  it("rejects a page less than 1", () => {
    const err = runErr(parseSearchParams({ page: "0" }));
    expect(err.tag).toBe("ValidationError");
  });

  it("rejects a limit greater than 100", () => {
    const err = runErr(parseSearchParams({ limit: "101" }));
    expect(err.tag).toBe("ValidationError");
  });

  it("parses comma-separated tags", () => {
    const params = runOk(parseSearchParams({ tags: "finance, q1 , report" }));
    expect(params.tags).toEqual(Option.some(["finance", "q1", "report"]));
  });

  it("parses a valid JSON metadata string", () => {
    const params = runOk(parseSearchParams({ metadata: '{"author":"alice"}' }));
    expect(params.metadata).toEqual(Option.some({ author: "alice" }));
  });

  it("rejects malformed JSON in metadata", () => {
    const err = runErr(parseSearchParams({ metadata: "not-json" }));
    expect(err.tag).toBe("ValidationError");
  });

  it("rejects metadata that is a JSON array (not an object)", () => {
    const err = runErr(parseSearchParams({ metadata: '["a","b"]' }));
    expect(err.tag).toBe("ValidationError");
  });

  it("falls back to default sortBy when an unknown field is given", () => {
    const params = runOk(parseSearchParams({ sortBy: "invalid" }));
    expect(params.sortBy).toBe("createdAt");
  });
});
