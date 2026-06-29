import { test, expect, describe } from "bun:test";
import { formatResults, formatTraceResults, formatListResults } from "./format";
import type { SearchMatch } from "./search/keyword";
import type { FileTraceResult } from "./search/file-trace";
import type { Session } from "./storage";

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

describe("formatListResults", () => {
  const mkSession = (
    id: string,
    directory: string,
    title: string,
    updated: number,
  ): Session => ({
    id,
    projectID: "proj",
    title,
    directory,
    time: { created: updated, updated },
  });

  test("returns empty message when no sessions", () => {
    expect(formatListResults([])).toBe("No sessions found.");
  });

  test("groups sessions by directory with per-folder counts", () => {
    const sessions: Session[] = [
      mkSession("ses_a", "/projects/alpha", "Alpha one", 3000),
      mkSession("ses_b", "/projects/alpha", "Alpha two", 2000),
      mkSession("ses_c", "/projects/beta", "Beta one", 1000),
    ];

    const output = formatListResults(sessions);
    expect(output).toContain("== /projects/alpha  (2 sessions) ==");
    expect(output).toContain("== /projects/beta  (1 session) ==");
    expect(output).toContain("ses_a");
    expect(output).toContain("ses_b");
    expect(output).toContain("ses_c");
    expect(output).toContain("Alpha one");
  });

  test("sorts folders by most-recently-updated session (newest first)", () => {
    const sessions: Session[] = [
      mkSession("ses_old", "/projects/older", "Older", 1000),
      mkSession("ses_new", "/projects/newer", "Newer", 9000),
    ];

    const output = formatListResults(sessions);
    const newerIdx = output.indexOf("/projects/newer");
    const olderIdx = output.indexOf("/projects/older");
    expect(newerIdx).toBeGreaterThanOrEqual(0);
    expect(olderIdx).toBeGreaterThan(newerIdx);
  });

  test("sorts sessions newest-first within a folder", () => {
    const sessions: Session[] = [
      mkSession("ses_mid", "/projects/x", "Mid", 2000),
      mkSession("ses_new", "/projects/x", "New", 3000),
      mkSession("ses_old", "/projects/x", "Old", 1000),
    ];

    const output = formatListResults(sessions);
    const newIdx = output.indexOf("ses_new");
    const midIdx = output.indexOf("ses_mid");
    const oldIdx = output.indexOf("ses_old");
    expect(newIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(oldIdx);
  });

  test("truncates long titles to ~60 chars", () => {
    const longTitle = "x".repeat(120);
    const sessions: Session[] = [
      mkSession("ses_long", "/projects/x", longTitle, 1000),
    ];

    const output = formatListResults(sessions);
    const titleLine = output
      .split("\n")
      .find((l) => l.includes("ses_long")) as string;
    expect(titleLine).toContain("…");
    expect(titleLine).not.toContain("x".repeat(120));
    // Truncated title body should be at most 60 chars (59 + ellipsis).
    expect(titleLine.includes("x".repeat(61))).toBe(false);
  });

  test("handles missing directory and empty title gracefully", () => {
    const sessions: Session[] = [
      mkSession("ses_nodir", "", "", 1000),
    ];

    const output = formatListResults(sessions);
    expect(output).toContain("(unknown directory)");
    expect(output).toContain("(untitled)");
    expect(output).toContain("ses_nodir");
  });
});
