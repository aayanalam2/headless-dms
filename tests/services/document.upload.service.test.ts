import { describe, expect, it } from "bun:test";
import { faker } from "@faker-js/faker";
import { Option } from "effect";
import { parseOptionalJson, parseTags } from "../../src/services/document.upload.service.ts";
import { runOk, runErr } from "../helpers/factories.ts";

// ---------------------------------------------------------------------------
// parseOptionalJson
// ---------------------------------------------------------------------------

describe("parseOptionalJson", () => {
  it("returns an empty object for Option.none()", () => {
    expect(runOk(parseOptionalJson(Option.none()))).toEqual({});
  });

  it("returns an empty object for Option.some('')", () => {
    expect(runOk(parseOptionalJson(Option.some("")))).toEqual({});
  });

  it("returns an empty object for whitespace-only input", () => {
    expect(runOk(parseOptionalJson(Option.some("   ")))).toEqual({});
  });

  it("parses a simple JSON object with string values", () => {
    const obj = { author: faker.person.firstName(), department: "finance" };
    expect(runOk(parseOptionalJson(Option.some(JSON.stringify(obj))))).toEqual(obj);
  });

  it("parses a multi-key object", () => {
    const obj: Record<string, string> = {};
    const count = faker.number.int({ min: 2, max: 6 });
    for (let i = 0; i < count; i++) {
      obj[faker.word.noun()] = faker.word.adjective();
    }
    expect(runOk(parseOptionalJson(Option.some(JSON.stringify(obj))))).toEqual(obj);
  });

  it("rejects a JSON array", () => {
    const err = runErr(parseOptionalJson(Option.some('["a","b"]')));
    expect(err).toMatchObject({ tag: "ValidationError" });
  });

  it("rejects a JSON string primitive", () => {
    const err = runErr(parseOptionalJson(Option.some('"just a string"')));
    expect(err).toMatchObject({ tag: "ValidationError" });
  });

  it("rejects a JSON number primitive", () => {
    const err = runErr(parseOptionalJson(Option.some("42")));
    expect(err).toMatchObject({ tag: "ValidationError" });
  });

  it("rejects null JSON value", () => {
    const err = runErr(parseOptionalJson(Option.some("null")));
    expect(err).toMatchObject({ tag: "ValidationError" });
  });

  it("rejects an object with a numeric value", () => {
    const err = runErr(parseOptionalJson(Option.some('{"count":7}')));
    expect(err).toMatchObject({ tag: "ValidationError" });
  });

  it("rejects an object with a boolean value", () => {
    const err = runErr(parseOptionalJson(Option.some('{"active":true}')));
    expect(err).toMatchObject({ tag: "ValidationError" });
  });

  it("rejects an object with a nested object value", () => {
    const err = runErr(parseOptionalJson(Option.some('{"nested":{"a":"b"}}')));
    expect(err).toMatchObject({ tag: "ValidationError" });
  });

  it("rejects malformed JSON", () => {
    const err = runErr(parseOptionalJson(Option.some("{not json}")));
    expect(err).toMatchObject({ tag: "ValidationError" });
  });

  it("rejects completely garbled input", () => {
    const err = runErr(parseOptionalJson(Option.some(faker.lorem.sentence())));
    expect(err).toMatchObject({ tag: "ValidationError" });
  });
});

// ---------------------------------------------------------------------------
// parseTags
// ---------------------------------------------------------------------------

describe("parseTags", () => {
  it("returns [] for Option.none()", () => {
    expect(parseTags(Option.none())).toEqual([]);
  });

  it("returns [] for Option.some('')", () => {
    expect(parseTags(Option.some(""))).toEqual([]);
  });

  it("returns [] for whitespace-only input", () => {
    expect(parseTags(Option.some("   "))).toEqual([]);
  });

  it("returns a single-element array for a tag without commas", () => {
    expect(parseTags(Option.some("finance"))).toEqual(["finance"]);
  });

  it("splits on commas and trims each tag", () => {
    expect(parseTags(Option.some(" finance , q1 , report "))).toEqual(["finance", "q1", "report"]);
  });

  it("filters out blank entries between consecutive commas", () => {
    expect(parseTags(Option.some("finance,,q1,"))).toEqual(["finance", "q1"]);
  });

  it("handles a trailing comma", () => {
    expect(parseTags(Option.some("a,b,"))).toEqual(["a", "b"]);
  });

  it("handles a leading comma", () => {
    expect(parseTags(Option.some(",a,b"))).toEqual(["a", "b"]);
  });

  it("returns [] for a string of only commas", () => {
    expect(parseTags(Option.some(",,,"))).toEqual([]);
  });

  it("preserves tags with internal spaces (not trimmed internally)", () => {
    // Only leading/trailing whitespace from each tag is stripped;
    // "multi word" stays as "multi word" if that's what was tagged.
    const result = parseTags(Option.some("multi word, other"));
    expect(result).toEqual(["multi word", "other"]);
  });

  it("handles a realistic comma-separated tag list from faker", () => {
    const words = Array.from({ length: 4 }, () => faker.word.noun());
    const input = words.join(",");
    expect(parseTags(Option.some(input))).toEqual(words);
  });

  it("returns the same tags regardless of extra spaces around commas", () => {
    const clean = parseTags(Option.some("a,b,c"));
    const spaced = parseTags(Option.some(" a , b , c "));
    expect(clean).toEqual(spaced);
  });
});
