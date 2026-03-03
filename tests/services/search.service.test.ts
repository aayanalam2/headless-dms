import { describe, expect, it } from "bun:test";
import { parseSearchParams } from "../../src/services/search.service.ts";

describe("parseSearchParams", () => {
  it("returns defaults when given an empty query", () => {
    const result = parseSearchParams({});
    expect(result.isOk()).toBe(true);
    const params = result.unwrap();
    expect(params.page).toBe(1);
    expect(params.limit).toBe(20);
    expect(params.sortBy).toBe("createdAt");
    expect(params.sortOrder).toBe("desc");
  });

  it("parses valid page and limit", () => {
    const result = parseSearchParams({ page: "2", limit: "10" });
    expect(result.isOk()).toBe(true);
    const params = result.unwrap();
    expect(params.page).toBe(2);
    expect(params.limit).toBe(10);
  });

  it("rejects a page less than 1", () => {
    const result = parseSearchParams({ page: "0" });
    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().tag).toBe("ValidationError");
  });

  it("rejects a limit greater than 100", () => {
    const result = parseSearchParams({ limit: "101" });
    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().tag).toBe("ValidationError");
  });

  it("parses comma-separated tags", () => {
    const result = parseSearchParams({ tags: "finance, q1 , report" });
    expect(result.isOk()).toBe(true);
    expect(result.unwrap().tags).toEqual(["finance", "q1", "report"]);
  });

  it("parses a valid JSON metadata string", () => {
    const result = parseSearchParams({ metadata: '{"author":"alice"}' });
    expect(result.isOk()).toBe(true);
    expect(result.unwrap().metadata).toEqual({ author: "alice" });
  });

  it("rejects malformed JSON in metadata", () => {
    const result = parseSearchParams({ metadata: "not-json" });
    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().tag).toBe("ValidationError");
  });

  it("rejects metadata that is a JSON array (not an object)", () => {
    const result = parseSearchParams({ metadata: '["a","b"]' });
    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().tag).toBe("ValidationError");
  });

  it("falls back to default sortBy when an unknown field is given", () => {
    const result = parseSearchParams({ sortBy: "invalid" });
    expect(result.isOk()).toBe(true);
    expect(result.unwrap().sortBy).toBe("createdAt");
  });
});
