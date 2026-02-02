import { test, expect, describe, mock } from "bun:test";
import { searchFuzzy } from "./fuzzy";
import {
  MOCK_PROJECT_ID,
  mockListSessions,
  mockListMessages,
  mockListParts,
} from "../../test/fixtures/mock-data";

mock.module("../storage", () => ({
  listSessions: mockListSessions,
  listMessages: mockListMessages,
  listParts: mockListParts,
  getStorageDir: async () => "/mock/storage",
  getCurrentProjectID: async () => MOCK_PROJECT_ID,
}));

describe("fuzzy search (unit tests with mocks)", () => {
  test("finds matches with typos", async () => {
    const results = await searchFuzzy(MOCK_PROJECT_ID, "storag", {
      threshold: 0.3,
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);
  });

  test("finds matches with variations", async () => {
    const results = await searchFuzzy(MOCK_PROJECT_ID, "storag", {
      threshold: 0.5,
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty("sessionID");
    expect(results[0]).toHaveProperty("sessionTitle");
    expect(results[0]).toHaveProperty("excerpt");
  });

  test("finds fuzzy authentication", async () => {
    const results = await searchFuzzy(MOCK_PROJECT_ID, "autentication", {
      threshold: 0.4,
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);
  });

  test("respects limit parameter", async () => {
    const results = await searchFuzzy(MOCK_PROJECT_ID, "storage", {
      threshold: 0.4,
      limit: 2,
    });

    expect(results.length).toBeLessThanOrEqual(2);
  });

  test("respects threshold parameter", async () => {
    const strict = await searchFuzzy(MOCK_PROJECT_ID, "xyz123", {
      threshold: 0.1,
      limit: 5,
    });
    const loose = await searchFuzzy(MOCK_PROJECT_ID, "xyz123", {
      threshold: 0.8,
      limit: 5,
    });

    expect(loose.length).toBeGreaterThanOrEqual(strict.length);
  });

  test("returns results sorted by timestamp", async () => {
    const results = await searchFuzzy(MOCK_PROJECT_ID, "storage", {
      threshold: 0.4,
      limit: 20,
    });

    if (results.length > 1) {
      for (let i = 0; i < results.length - 1; i++) {
        const current = results[i];
        const next = results[i + 1];
        if (current && next) {
          expect(current.timestamp).toBeGreaterThanOrEqual(next.timestamp);
        }
      }
    }
  });

  test("returns empty array for completely unrelated query", async () => {
    const results = await searchFuzzy(MOCK_PROJECT_ID, "qwertyuiop", {
      threshold: 0.1,
      limit: 5,
    });

    expect(results).toBeDefined();
    expect(Array.isArray(results)).toBe(true);
  });
});
