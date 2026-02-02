import { test, expect, describe, mock, beforeAll, afterAll } from "bun:test";
import { searchKeyword } from "./keyword";
import {
  MOCK_PROJECT_ID,
  mockListSessions,
  mockListMessages,
  mockListParts,
} from "../../test/fixtures/mock-data";

describe("keyword search (unit tests with mocks)", () => {
  beforeAll(() => {
    mock.module("../storage", () => ({
      listSessions: mockListSessions,
      listMessages: mockListMessages,
      listParts: mockListParts,
      getStorageDir: async () => "/mock/storage",
      getCurrentProjectID: async () => MOCK_PROJECT_ID,
    }));
  });

  afterAll(() => {
    mock.restore();
  });
  test("finds matches in mock data", async () => {
    const results = await searchKeyword(MOCK_PROJECT_ID, "storage", {
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty("sessionID");
    expect(results[0]).toHaveProperty("sessionTitle");
    expect(results[0]).toHaveProperty("excerpt");
  });

  test("finds title matches", async () => {
    const results = await searchKeyword(MOCK_PROJECT_ID, "storage", {
      limit: 5,
    });

    const titleMatch = results.find((r) => r.matchType === "title");
    expect(titleMatch).toBeDefined();
    expect(titleMatch?.sessionTitle).toContain("storage");
  });

  test("case insensitive by default", async () => {
    const lower = await searchKeyword(MOCK_PROJECT_ID, "storage", { limit: 5 });
    const upper = await searchKeyword(MOCK_PROJECT_ID, "STORAGE", { limit: 5 });

    expect(lower.length).toEqual(upper.length);
  });

  test("case sensitive when specified", async () => {
    const results = await searchKeyword(MOCK_PROJECT_ID, "STORAGE", {
      limit: 5,
      caseSensitive: true,
    });

    expect(results.length).toBe(0); // Should find 0 since mock has lowercase "storage";
  });

  test("respects limit parameter", async () => {
    const results = await searchKeyword(MOCK_PROJECT_ID, "the", { limit: 2 });

    expect(results.length).toBeLessThanOrEqual(2);
  });

  test("regex search works", async () => {
    const results = await searchKeyword(MOCK_PROJECT_ID, "stor.*ge", {
      regex: true,
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);
  });

  test("returns empty array for no matches", async () => {
    const results = await searchKeyword(
      MOCK_PROJECT_ID,
      "nonexistent-xyz-123",
      { limit: 5 },
    );

    expect(results.length).toBe(0); // Should find 0 since mock has lowercase "storage";
  });
});
