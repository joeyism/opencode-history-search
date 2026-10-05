import { describe, test, expect } from "bun:test";
import { historySearch } from "../src/index";

const tool = historySearch;

describe("Date Filtering Integration Tests", () => {
  test("filters results by 'today' (may have no matches)", async () => {
    const { content } = await tool.execute({ query: "storage", date: "today" });
    expect(content).toContain("conversation history");
  });

  test("filters results by 'yesterday'", async () => {
    const { content } = await tool.execute({ query: "storage", date: "yesterday" });
    expect(content).toContain("conversation history");
  });

  test("filters results by 'last 7 days'", async () => {
    const { content } = await tool.execute({ query: "storage", date: "last 7 days" });
    expect(content).toContain("conversation history");
  });

  test("filters results by 'last 30 days'", async () => {
    const { content } = await tool.execute({ query: "storage", date: "last 30 days", limit: 5 });
    expect(content).toContain("conversation history");
  });

  test("filters results by specific month YYYY-MM", async () => {
    const { content } = await tool.execute({ query: "storage", date: "2026-01" });
    expect(content).toContain("conversation history");
    if (!content.includes("No matches")) {
      expect(content).toContain("2026-01");
    }
  });

  test("filters results by specific date YYYY-MM-DD", async () => {
    const { content } = await tool.execute({ query: "storage", date: "2026-02-01" });
    expect(content).toContain("conversation history");
    if (!content.includes("No matches")) {
      expect(content).toContain("2026-02-01");
    }
  });

  test("filters results by date range", async () => {
    const { content } = await tool.execute({ query: "storage", date: "2026-01-01 to 2026-02-01" });
    expect(content).toContain("conversation history");
  });

  test("handles date filter with fuzzy search", async () => {
    const { content } = await tool.execute({
      query: "storag",
      mode: "fuzzy",
      date: "last 30 days",
      limit: 5,
    });
    expect(content).toContain("conversation history");
  });

  test("returns no matches for future dates", async () => {
    const { content } = await tool.execute({ query: "storage", date: "2030-01-01" });
    expect(content).toContain("No matches found");
  });

  test("throws error for invalid date format", async () => {
    await expect(
      tool.execute({ query: "storage", date: "invalid date" }),
    ).rejects.toThrow(/Unrecognized date filter format/);
  });

  test("works without date filter (backward compatibility)", async () => {
    const { content } = await tool.execute({ query: "storage", limit: 5 });
    expect(content).toContain("conversation history");
  });
});
