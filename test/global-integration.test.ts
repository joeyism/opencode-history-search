import { describe, test, expect } from "bun:test";
import historySearch from "../src/index";

const tool = historySearch;

describe("Global Search Integration Tests", () => {
  test("global search returns results", async () => {
    const result = await tool.execute({
      query: "storage",
      searchAllProjects: true,
      limit: 5,
    });
    expect(result).toContain("conversation history");
  });

  test("global search with date filter works", async () => {
    const result = await tool.execute({
      query: "storage",
      searchAllProjects: true,
      date: "today",
      limit: 5,
    });
    expect(result).toContain("conversation history");
  });

  test("global file trace works", async () => {
    const result = await tool.execute({
      filePath: "src/storage.ts",
      searchAllProjects: true,
      limit: 5,
    });
    expect(result).toContain("conversation history");
  });

  test("scoped search still works (backward compatibility)", async () => {
    const result = await tool.execute({ query: "storage", limit: 5 });
    expect(result).toContain("conversation history");
  });
});
