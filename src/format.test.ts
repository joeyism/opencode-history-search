import { test, expect, describe } from "bun:test";
import { formatResults, formatTraceResults } from "./format";
import type { SearchMatch } from "./search/keyword";
import type { FileTraceResult } from "./search/file-trace";

describe("formatResults", () => {
  test("renders a single match with project directory", () => {
    const matches: SearchMatch[] = [
      {
        sessionID: "ses_001",
        sessionTitle: "Implement storage layer",
        timestamp: 1706745600000,
        matchType: "title",
        excerpt: "Implement storage layer",
        context: "Implement storage layer",
        projectDirectory: "/mock/project",
      },
    ];

    const output = formatResults(matches);
    expect(output).toContain("Implement storage layer");
    expect(output).toContain("ses_001");
    expect(output).toContain("/mock/project");
    expect(output).toContain("2024-02-01");
    expect(output).toContain("Found 1 matches");
  });

  test("renders multiple matches with their project directories", () => {
    const matches: SearchMatch[] = [
      {
        sessionID: "ses_001",
        sessionTitle: "First session",
        timestamp: 1000,
        matchType: "title",
        excerpt: "First",
        context: "First",
        projectDirectory: "/project/a",
      },
      {
        sessionID: "ses_002",
        sessionTitle: "Second session",
        timestamp: 2000,
        matchType: "message",
        excerpt: "Second",
        context: "Second",
        projectDirectory: "/project/b",
      },
    ];

    const output = formatResults(matches);
    expect(output).toContain("/project/a");
    expect(output).toContain("/project/b");
    expect(output).toContain("First session");
    expect(output).toContain("Second session");
    expect(output).toContain("Found 2 matches");
  });

  test("returns empty message when no matches", () => {
    const output = formatResults([]);
    expect(output).toBe("No matches found in conversation history.");
  });

  test("includes context when it differs from excerpt", () => {
    const matches: SearchMatch[] = [
      {
        sessionID: "ses_001",
        sessionTitle: "Test",
        timestamp: 1000,
        matchType: "message",
        excerpt: "short",
        context:
          "some longer context that includes the word short in the middle",
        projectDirectory: "/mock/project",
      },
    ];

    const output = formatResults(matches);
    expect(output).toContain("Context");
    expect(output).toContain("short");
  });
});

describe("formatTraceResults", () => {
  test("renders a single file trace match", () => {
    const matches: FileTraceResult[] = [
      {
        sessionID: "ses_001",
        sessionTitle: "Build auth module",
        timestamp: 1706745600000,
        firstTouch: true,
        userPrompt: "build me an auth module",
        toolName: "write",
        filePath: "src/auth.ts",
      },
    ];

    const output = formatTraceResults(matches);
    expect(output).toContain("Build auth module");
    expect(output).toContain("ses_001");
    expect(output).toContain("First seen");
    expect(output).toContain("src/auth.ts");
    expect(output).toContain("write");
    expect(output).toContain('build me an auth module');
    expect(output).toContain("Found 1 file trace matches");
  });

  test("renders later touch status", () => {
    const matches: FileTraceResult[] = [
      {
        sessionID: "ses_002",
        sessionTitle: "Fix bug",
        timestamp: 2000,
        firstTouch: false,
        userPrompt: null,
        toolName: "edit",
        filePath: "src/bug.ts",
      },
    ];

    const output = formatTraceResults(matches);
    expect(output).toContain("Later touch");
    expect(output).not.toContain("Preceding User Prompt");
  });

  test("returns empty message when no matches", () => {
    const output = formatTraceResults([]);
    expect(output).toBe("No file trace matches found in conversation history.");
  });
});
