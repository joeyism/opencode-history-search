import { test, expect, describe } from "bun:test";
import { searchKeyword } from "./keyword";

const MAIN_PROJECT_ID = "4b0ea68d7af9a6031a7ffda7ad66e0cb83315750";

describe("keyword search (integration - requires real data)", () => {
  test("finds matches in actual history", async () => {
    const projectID = MAIN_PROJECT_ID;
    const results = await searchKeyword(projectID, "storage", { limit: 5 });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty("sessionID");
    expect(results[0]).toHaveProperty("sessionTitle");
    expect(results[0]).toHaveProperty("excerpt");
  });

  test("case insensitive by default", async () => {
    const projectID = MAIN_PROJECT_ID;
    const lower = await searchKeyword(projectID, "storage", { limit: 5 });
    const upper = await searchKeyword(projectID, "STORAGE", { limit: 5 });

    expect(lower.length).toEqual(upper.length);
  });

  test("respects limit parameter", async () => {
    const projectID = MAIN_PROJECT_ID;
    const results = await searchKeyword(projectID, "the", { limit: 10 });

    expect(results.length).toBeLessThanOrEqual(10);
  });
});
