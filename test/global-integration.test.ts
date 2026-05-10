import { describe, test, expect } from "bun:test";
import historySearch from "../src/index";
import type { ToolContext } from "@opencode-ai/plugin";

const tool = historySearch;

const ctx: ToolContext = {
  sessionID: "test",
  messageID: "test",
  agent: "test",
  directory: process.cwd(),
  worktree: process.cwd(),
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
};

describe("Global Search Integration Tests", () => {
  test("global search returns results", async () => {
    const result = await tool.execute({
      query: "storage",
      searchAllProjects: true,
      limit: 5,
    }, ctx);
    expect(result).toContain("conversation history");
  });

  test("global search with date filter works", async () => {
    const result = await tool.execute({
      query: "storage",
      searchAllProjects: true,
      date: "today",
      limit: 5,
    }, ctx);
    expect(result).toContain("conversation history");
  });

  test("global file trace works", async () => {
    const result = await tool.execute({
      filePath: "src/storage.ts",
      searchAllProjects: true,
      limit: 5,
    }, ctx);
    expect(result).toContain("conversation history");
  });

  test("scoped search still works (backward compatibility)", async () => {
    const result = await tool.execute({ query: "storage", limit: 5 }, ctx);
    expect(result).toContain("conversation history");
  });
});
