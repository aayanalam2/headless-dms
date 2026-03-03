import { describe, expect, it } from "bun:test";
import { faker } from "@faker-js/faker";
import {
  toDocumentDTO,
  toVersionDTO,
  toPaginatedDocumentsDTO,
} from "../../src/dto/document.dto.ts";
import { toUserDTO } from "../../src/dto/user.dto.ts";
import { ISODateString } from "../../src/types/branded.ts";
import { Role } from "../../src/types/enums.ts";
import { makeUserRow, makeDocumentRow, makeVersionRow } from "../helpers/factories.ts";

// ---------------------------------------------------------------------------
// toUserDTO
// ---------------------------------------------------------------------------

describe("toUserDTO", () => {
  it("maps id, email, and role from the row", () => {
    const row = makeUserRow();
    const dto = toUserDTO(row);
    expect(dto.id).toBe(row.id);
    expect(dto.email).toBe(row.email);
    expect(dto.role).toBe(row.role);
  });

  it("omits the passwordHash from the DTO", () => {
    const row = makeUserRow();
    const dto = toUserDTO(row) as Record<string, unknown>;
    expect(Object.keys(dto)).not.toContain("passwordHash");
    expect(Object.keys(dto)).not.toContain("password_hash");
  });

  it("converts createdAt to an ISODateString", () => {
    const date = faker.date.past();
    const row = makeUserRow({ createdAt: date });
    const dto = toUserDTO(row);
    expect(dto.createdAt).toBe(date.toISOString());
  });

  it("correctly maps the admin role", () => {
    const row = makeUserRow({ role: Role.Admin });
    expect(toUserDTO(row).role).toBe(Role.Admin);
  });

  it("correctly maps the user role", () => {
    const row = makeUserRow({ role: Role.User });
    expect(toUserDTO(row).role).toBe(Role.User);
  });

  it("produces ISODateString that satisfies the branded type validator", () => {
    const row = makeUserRow();
    const dto = toUserDTO(row);
    // ISODateString.create validates — should succeed for .toISOString() output
    const result = ISODateString.create(dto.createdAt);
    expect(result.isOk()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// toDocumentDTO
// ---------------------------------------------------------------------------

describe("toDocumentDTO", () => {
  it("maps all scalar fields correctly", () => {
    const row = makeDocumentRow();
    const dto = toDocumentDTO(row);
    expect(dto.id).toBe(row.id);
    expect(dto.ownerId).toBe(row.ownerId);
    expect(dto.name).toBe(row.name);
    expect(dto.contentType).toBe(row.contentType);
    expect(dto.tags).toEqual(row.tags);
    expect(dto.metadata).toEqual(row.metadata);
  });

  it("converts createdAt and updatedAt to ISODateString", () => {
    const now = new Date();
    const row = makeDocumentRow({ createdAt: now, updatedAt: now });
    const dto = toDocumentDTO(row);
    expect(dto.createdAt).toBe(now.toISOString());
    expect(dto.updatedAt).toBe(now.toISOString());
  });

  it("maps a null currentVersionId to null (not undefined)", () => {
    const row = makeDocumentRow({ currentVersionId: null });
    expect(toDocumentDTO(row).currentVersionId).toBeNull();
  });

  it("maps a non-null currentVersionId correctly", () => {
    const versionId = faker.string.uuid();
    const row = makeDocumentRow({ currentVersionId: versionId });
    expect(toDocumentDTO(row).currentVersionId).toBe(versionId);
  });

  it("maps an empty tags array", () => {
    const row = makeDocumentRow({ tags: [] });
    expect(toDocumentDTO(row).tags).toEqual([]);
  });

  it("maps an empty metadata object", () => {
    const row = makeDocumentRow({ metadata: {} });
    expect(toDocumentDTO(row).metadata).toEqual({});
  });

  it("maps rich metadata correctly", () => {
    const meta = {
      author: faker.person.fullName(),
      department: faker.commerce.department(),
      year: faker.date.past().getFullYear().toString(),
    };
    const row = makeDocumentRow({ metadata: meta });
    expect(toDocumentDTO(row).metadata).toEqual(meta);
  });

  it("produces ISODateStrings that pass validation", () => {
    const row = makeDocumentRow();
    const dto = toDocumentDTO(row);
    expect(ISODateString.create(dto.createdAt).isOk()).toBe(true);
    expect(ISODateString.create(dto.updatedAt).isOk()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// toVersionDTO
// ---------------------------------------------------------------------------

describe("toVersionDTO", () => {
  it("maps all fields from the version row", () => {
    const doc = makeDocumentRow();
    const row = makeVersionRow(doc.id);
    const dto = toVersionDTO(row);
    expect(dto.id).toBe(row.id);
    expect(dto.documentId).toBe(row.documentId);
    expect(dto.versionNumber).toBe(row.versionNumber);
    expect(dto.bucketKey).toBe(row.bucketKey);
    expect(dto.sizeBytes).toBe(row.sizeBytes);
    expect(dto.uploadedBy).toBe(row.uploadedBy);
    expect(dto.checksum).toBe(row.checksum);
  });

  it("converts createdAt to an ISODateString", () => {
    const date = faker.date.recent();
    const row = makeVersionRow(faker.string.uuid(), { createdAt: date });
    expect(toVersionDTO(row).createdAt).toBe(date.toISOString());
  });

  it("produces an ISODateString that passes validation", () => {
    const row = makeVersionRow(faker.string.uuid());
    const dto = toVersionDTO(row);
    expect(ISODateString.create(dto.createdAt).isOk()).toBe(true);
  });

  it("preserves the exact checksum value", () => {
    const checksum = faker.string.hexadecimal({ length: 64, casing: "lower", prefix: "" });
    const row = makeVersionRow(faker.string.uuid(), { checksum });
    expect(toVersionDTO(row).checksum).toBe(checksum);
  });

  it("preserves large sizeBytes values", () => {
    const sizeBytes = 1_500_000_000;
    const row = makeVersionRow(faker.string.uuid(), { sizeBytes });
    expect(toVersionDTO(row).sizeBytes).toBe(sizeBytes);
  });
});

// ---------------------------------------------------------------------------
// toPaginatedDocumentsDTO
// ---------------------------------------------------------------------------

describe("toPaginatedDocumentsDTO", () => {
  it("maps all document rows to DTOs", () => {
    const rows = Array.from({ length: 5 }, () => makeDocumentRow());
    const result = toPaginatedDocumentsDTO(rows, 25, 1, 10);
    expect(result.items).toHaveLength(5);
  });

  it("calculates totalPages correctly for an exact multiple", () => {
    const rows = Array.from({ length: 10 }, () => makeDocumentRow());
    const result = toPaginatedDocumentsDTO(rows, 30, 1, 10);
    expect(result.pagination.totalPages).toBe(3);
  });

  it("rounds totalPages up for a remainder (ceiling division)", () => {
    const rows = Array.from({ length: 10 }, () => makeDocumentRow());
    const result = toPaginatedDocumentsDTO(rows, 31, 1, 10);
    expect(result.pagination.totalPages).toBe(4);
  });

  it("returns totalPages = 1 when all items fit on a single page", () => {
    const rows = Array.from({ length: 5 }, () => makeDocumentRow());
    const result = toPaginatedDocumentsDTO(rows, 5, 1, 20);
    expect(result.pagination.totalPages).toBe(1);
  });

  it("returns totalPages = 0 when total is 0", () => {
    const result = toPaginatedDocumentsDTO([], 0, 1, 20);
    expect(result.pagination.totalPages).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it("passes through the page and limit unchanged", () => {
    const rows = Array.from({ length: 10 }, () => makeDocumentRow());
    const result = toPaginatedDocumentsDTO(rows, 50, 3, 10);
    expect(result.pagination.page).toBe(3);
    expect(result.pagination.limit).toBe(10);
  });

  it("passes through the total count unchanged", () => {
    const total = faker.number.int({ min: 50, max: 500 });
    const rows = Array.from({ length: 20 }, () => makeDocumentRow());
    const result = toPaginatedDocumentsDTO(rows, total, 1, 20);
    expect(result.pagination.total).toBe(total);
  });

  it("converts each row's dates to ISODateStrings", () => {
    const rows = Array.from({ length: 3 }, () => makeDocumentRow());
    const result = toPaginatedDocumentsDTO(rows, 3, 1, 20);
    result.items.forEach((dto) => {
      expect(ISODateString.create(dto.createdAt).isOk()).toBe(true);
      expect(ISODateString.create(dto.updatedAt).isOk()).toBe(true);
    });
  });
});
