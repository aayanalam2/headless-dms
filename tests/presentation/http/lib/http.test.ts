import { describe, expect, it } from "bun:test";
import { faker } from "@faker-js/faker";
import { mapErrorToResponse } from "../../../../src/presentation/http/lib/http.ts";
import { AppError } from "../../../../src/infra/errors.ts";

// ---------------------------------------------------------------------------
// mapErrorToResponse — every branch of the discriminated union
// ---------------------------------------------------------------------------

describe("mapErrorToResponse", () => {
  // ── NotFound ──────────────────────────────────────────────────────────────

  describe("NotFound", () => {
    it("returns status 404", () => {
      const err = AppError.notFound(`Document(${faker.string.uuid()})`);
      expect(mapErrorToResponse(err).status).toBe(404);
    });

    it("includes 'Not Found' in the error body", () => {
      const err = AppError.notFound("User(xyz)");
      expect(mapErrorToResponse(err).body.error).toBe("Not Found");
    });

    it("includes the resource name as detail", () => {
      const resource = `Document(${faker.string.uuid()})`;
      const resp = mapErrorToResponse(AppError.notFound(resource));
      expect(resp.body.detail).toBe(resource);
    });
  });

  // ── AccessDenied ──────────────────────────────────────────────────────────

  describe("AccessDenied", () => {
    it("returns status 403", () => {
      const err = AppError.accessDenied(faker.lorem.sentence());
      expect(mapErrorToResponse(err).status).toBe(403);
    });

    it("includes 'Forbidden' in the error body", () => {
      const err = AppError.accessDenied("not your document");
      expect(mapErrorToResponse(err).body.error).toBe("Forbidden");
    });

    it("includes the access-denied reason as detail", () => {
      const reason = faker.lorem.sentence();
      const resp = mapErrorToResponse(AppError.accessDenied(reason));
      expect(resp.body.detail).toBe(reason);
    });
  });

  // ── Conflict ──────────────────────────────────────────────────────────────

  describe("Conflict", () => {
    it("returns status 409", () => {
      const err = AppError.conflict("Email already in use");
      expect(mapErrorToResponse(err).status).toBe(409);
    });

    it("includes 'Conflict' in the error body", () => {
      const err = AppError.conflict(faker.lorem.sentence());
      expect(mapErrorToResponse(err).body.error).toBe("Conflict");
    });

    it("includes the conflict message as detail", () => {
      const message = faker.lorem.words(5);
      const resp = mapErrorToResponse(AppError.conflict(message));
      expect(resp.body.detail).toBe(message);
    });
  });

  // ── ValidationError ───────────────────────────────────────────────────────

  describe("ValidationError", () => {
    it("returns status 422", () => {
      const err = AppError.validation("page must be a positive integer");
      expect(mapErrorToResponse(err).status).toBe(422);
    });

    it("includes 'Unprocessable Entity' in the error body", () => {
      const err = AppError.validation(faker.lorem.sentence());
      expect(mapErrorToResponse(err).body.error).toBe("Unprocessable Entity");
    });

    it("includes the validation message as detail", () => {
      const message = faker.lorem.sentence();
      const resp = mapErrorToResponse(AppError.validation(message));
      expect(resp.body.detail).toBe(message);
    });
  });

  // ── StorageError ──────────────────────────────────────────────────────────

  describe("StorageError", () => {
    it("returns status 502", () => {
      const err = AppError.storage(new Error("S3 unreachable"));
      expect(mapErrorToResponse(err).status).toBe(502);
    });

    it("includes 'Storage Error' in the error body", () => {
      const err = AppError.storage(new Error("timeout"));
      expect(mapErrorToResponse(err).body.error).toBe("Storage Error");
    });

    it("never exposes the cause message in the response body", () => {
      const cause = new Error(faker.lorem.sentence());
      const resp = mapErrorToResponse(AppError.storage(cause));
      expect(resp.body.detail).toBeUndefined();
    });

    it("returns no detail when cause is not an Error", () => {
      const resp = mapErrorToResponse(AppError.storage("raw string error"));
      expect(resp.body.detail).toBeUndefined();
    });

    it("returns no detail when cause is null", () => {
      const resp = mapErrorToResponse(AppError.storage(null));
      expect(resp.body.detail).toBeUndefined();
    });

    it("returns no detail when cause is a plain object", () => {
      const resp = mapErrorToResponse(AppError.storage({ code: "S3_ERR" }));
      expect(resp.body.detail).toBeUndefined();
    });
  });

  // ── DatabaseError ─────────────────────────────────────────────────────────

  describe("DatabaseError", () => {
    it("returns status 500", () => {
      const err = AppError.database(new Error("connection refused"));
      expect(mapErrorToResponse(err).status).toBe(500);
    });

    it("includes 'Internal Server Error' in the error body", () => {
      const err = AppError.database(new Error("query failed"));
      expect(mapErrorToResponse(err).body.error).toBe("Internal Server Error");
    });

    it("never exposes the cause message in the response body", () => {
      const cause = new Error(faker.lorem.sentence());
      const resp = mapErrorToResponse(AppError.database(cause));
      expect(resp.body.detail).toBeUndefined();
    });

    it("returns no detail when cause is not an Error", () => {
      const resp = mapErrorToResponse(AppError.database(42));
      expect(resp.body.detail).toBeUndefined();
    });

    it("returns no detail when cause is undefined", () => {
      const resp = mapErrorToResponse(AppError.database(undefined));
      expect(resp.body.detail).toBeUndefined();
    });
  });

  // ── Body shape invariants ─────────────────────────────────────────────────

  describe("response body shape", () => {
    const allErrors: AppError[] = [
      AppError.notFound("X"),
      AppError.accessDenied("X"),
      AppError.conflict("X"),
      AppError.validation("X"),
      AppError.storage(new Error("X")),
      AppError.database(new Error("X")),
    ];

    it("always returns an object with a string 'error' field", () => {
      allErrors.forEach((err) => {
        const { body } = mapErrorToResponse(err);
        expect(typeof body.error).toBe("string");
      });
    });

    it("always returns a numeric status code", () => {
      allErrors.forEach((err) => {
        expect(typeof mapErrorToResponse(err).status).toBe("number");
      });
    });

    it("returns status codes in the 4xx–5xx range only", () => {
      allErrors.forEach((err) => {
        const { status } = mapErrorToResponse(err);
        expect(status).toBeGreaterThanOrEqual(400);
        expect(status).toBeLessThan(600);
      });
    });
  });
});
