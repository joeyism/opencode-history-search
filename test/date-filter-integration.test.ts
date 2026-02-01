import { describe, test, expect } from "bun:test";
import tool from "../src/index";

const MAIN_PROJECT_ID = "4b0ea68d7af9a6031a7ffda7ad66e0cb83315750";

describe("Date Filtering Integration Tests", () => {
  test("filters results by 'today' (may have no matches)", async () => {
    const result = await tool.execute({
      query: "storage",
      date: "today",
    });

    expect(result).toContain("conversation history");
  });

  test("filters results by 'yesterday'", async () => {
    const result = await tool.execute({
      query: "storage",
      date: "yesterday",
    });

    expect(result).toContain("conversation history");
  });

  test("filters results by 'last 7 days'", async () => {
    const result = await tool.execute({
      query: "storage",
      date: "last 7 days",
    });

    expect(result).toContain("conversation history");
  });

  test("filters results by 'last 30 days'", async () => {
    const result = await tool.execute({
      query: "storage",
      date: "last 30 days",
      limit: 5,
    });

    expect(result).toContain("conversation history");
  });

  test("filters results by specific month YYYY-MM", async () => {
    const result = await tool.execute({
      query: "storage",
      date: "2026-01",
    });

    expect(result).toContain("conversation history");
    if (!result.includes("No matches")) {
      expect(result).toContain("2026-01");
    }
  });

  test("filters results by specific date YYYY-MM-DD", async () => {
    const result = await tool.execute({
      query: "storage",
      date: "2026-02-01",
    });

    expect(result).toContain("conversation history");
    if (!result.includes("No matches")) {
      expect(result).toContain("2026-02-01");
    }
  });

  test("filters results by date range", async () => {
    const result = await tool.execute({
      query: "storage",
      date: "2026-01-01 to 2026-02-01",
    });

    expect(result).toContain("conversation history");
  });

  test("handles date filter with fuzzy search", async () => {
    const result = await tool.execute({
      query: "storag",
      mode: "fuzzy",
      date: "last 30 days",
      limit: 5,
    });

    expect(result).toContain("conversation history");
  });

  test("returns no matches for future dates", async () => {
    const result = await tool.execute({
      query: "storage",
      date: "2030-01-01",
    });

    expect(result).toContain("No matches found");
  });

  test("throws error for invalid date format", async () => {
    await expect(
      tool.execute({
        query: "storage",
        date: "invalid date",
      }),
    ).rejects.toThrow(/Unrecognized date filter format/);
  });

  test("works without date filter (backward compatibility)", async () => {
    const result = await tool.execute({
      query: "storage",
      limit: 5,
    });

    expect(result).toContain("conversation history");
  });
});
