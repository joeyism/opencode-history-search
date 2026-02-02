import { test, expect, describe } from "bun:test";
import { searchFuzzy } from "./fuzzy";

const MAIN_PROJECT_ID = "4b0ea68d7af9a6031a7ffda7ad66e0cb83315750";

describe("fuzzy search (integration - requires real data)", () => {
  test("finds matches with typos", async () => {
    const projectID = MAIN_PROJECT_ID;
    const results = await searchFuzzy(projectID, "storag", {
      threshold: 0.3,
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);
  });

  test("finds matches with variations", async () => {
    const projectID = MAIN_PROJECT_ID;
    const results = await searchFuzzy(projectID, "storag search", {
      threshold: 0.5,
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty("sessionID");
    expect(results[0]).toHaveProperty("sessionTitle");
    expect(results[0]).toHaveProperty("excerpt");
  });

  test("respects limit parameter", async () => {
    const projectID = MAIN_PROJECT_ID;
    const results = await searchFuzzy(projectID, "storage", {
      threshold: 0.4,
      limit: 10,
    });

    expect(results.length).toBeLessThanOrEqual(10);
  });

  test("respects threshold parameter", async () => {
    const projectID = MAIN_PROJECT_ID;

    const strict = await searchFuzzy(projectID, "xyz123", {
      threshold: 0.1,
      limit: 5,
    });
    const loose = await searchFuzzy(projectID, "xyz123", {
      threshold: 0.8,
      limit: 5,
    });

    expect(loose.length).toBeGreaterThanOrEqual(strict.length);
  });

  test("returns results sorted by timestamp", async () => {
    const projectID = MAIN_PROJECT_ID;
    const results = await searchFuzzy(projectID, "storage", {
      threshold: 0.4,
      limit: 20,
    });

    if (results.length > 1) {
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].timestamp).toBeGreaterThanOrEqual(
          results[i + 1].timestamp,
        );
      }
    }
  });
});
