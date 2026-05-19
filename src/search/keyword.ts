import type { Session, Message, Part } from "../storage-provider";
import { listSessions, listMessages, listParts, withSqlite } from "../storage-provider";
import { listSessionRowsSync, listMessageRowsSync, listPartRowsSync } from "../storage-sqlite";

export interface SearchMatch {
  sessionID: string;
  sessionTitle: string;
  timestamp: number;
  matchType: "title" | "message" | "tool" | "filepath";
  excerpt: string;
  context: string;
  messageID?: string;
  partID?: string;
  projectDirectory: string;
}

export interface KeywordOptions {
  regex?: boolean;
  caseSensitive?: boolean;
  limit?: number;
  role?: "user" | "assistant";
}

export async function searchKeyword(
  projectID: string | null,
  query: string,
  options: KeywordOptions = {},
): Promise<SearchMatch[]> {
  // Fast path: SQLite available => single shared connection, sync iteration.
  const fast = await withSqlite((db) =>
    searchKeywordSqlite(db, projectID, query, options),
  );
  if (fast !== null) return fast;
  // Legacy JSON path (or tests that mock storage-provider)
  return searchKeywordGenerators(projectID, query, options);
}

function buildPattern(query: string, options: KeywordOptions): RegExp {
  return options.regex
    ? new RegExp(query, options.caseSensitive ? "" : "i")
    : new RegExp(
        query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        options.caseSensitive ? "" : "i",
      );
}

// ---------------------------------------------------------------------------
// SQLite fast path. One Database, plain for-loops, no async overhead per row.
// ---------------------------------------------------------------------------
function searchKeywordSqlite(
  db: any,
  projectID: string | null,
  query: string,
  options: KeywordOptions,
): SearchMatch[] {
  const pattern = buildPattern(query, options);
  const limit = options.limit || 50;
  const results: SearchMatch[] = [];

  const sessions = listSessionRowsSync(db, projectID);
  for (const session of sessions) {
    if (results.length >= limit) break;

    if (pattern.test(session.title)) {
      results.push({
        sessionID: session.id,
        sessionTitle: session.title,
        timestamp: session.time.updated,
        matchType: "title",
        excerpt: session.title,
        context: session.title,
        projectDirectory: session.directory,
      });
      if (results.length >= limit) break;
    }

    const messages = listMessageRowsSync(db, session.id, options.role);
    for (const message of messages) {
      if (results.length >= limit) break;
      const parts = listPartRowsSync(db, message.id);
      for (const part of parts) {
        if (results.length >= limit) break;
        matchPart(results, pattern, query, session, message, part, limit);
      }
    }
  }

  return results.sort((a, b) => b.timestamp - a.timestamp);
}

// ---------------------------------------------------------------------------
// Legacy generator path (JSON storage). Unchanged behavior.
// ---------------------------------------------------------------------------
async function searchKeywordGenerators(
  projectID: string | null,
  query: string,
  options: KeywordOptions,
): Promise<SearchMatch[]> {
  const results: SearchMatch[] = [];
  const pattern = buildPattern(query, options);
  const limit = options.limit || 50;

  for await (const session of listSessions(projectID)) {
    if (results.length >= limit) break;

    if (pattern.test(session.title)) {
      results.push({
        sessionID: session.id,
        sessionTitle: session.title,
        timestamp: session.time.updated,
        matchType: "title",
        excerpt: session.title,
        context: session.title,
        projectDirectory: session.directory,
      });
      if (results.length >= limit) break;
    }

    for await (const message of listMessages(session.id, options.role)) {
      if (results.length >= limit) break;
      for await (const part of listParts(message.id)) {
        if (results.length >= limit) break;
        matchPart(results, pattern, query, session, message, part, limit);
      }
    }
  }

  return results.sort((a, b) => b.timestamp - a.timestamp);
}

// ---------------------------------------------------------------------------
// Shared per-part matcher. Identical logic for both paths.
// ---------------------------------------------------------------------------
function matchPart(
  results: SearchMatch[],
  pattern: RegExp,
  query: string,
  session: Session,
  message: Message,
  part: Part,
  limit: number,
): void {
  if (results.length >= limit) return;

  if (part.type === "text" && part.text && pattern.test(part.text)) {
    const match = part.text.match(pattern);
    const matchIndex = match ? part.text.indexOf(match[0]) : 0;
    const contextStart = Math.max(0, matchIndex - 100);
    const contextEnd = Math.min(
      part.text.length,
      matchIndex + match![0].length + 100,
    );
    const context = part.text.slice(contextStart, contextEnd);

    results.push({
      sessionID: session.id,
      sessionTitle: session.title,
      timestamp: message.time.created,
      matchType: "message",
      excerpt: match ? match[0] : query,
      context,
      messageID: message.id,
      partID: part.id,
      projectDirectory: session.directory,
    });
    if (results.length >= limit) return;
  }

  if (part.type === "tool" && part.tool && pattern.test(part.tool)) {
    results.push({
      sessionID: session.id,
      sessionTitle: session.title,
      timestamp: message.time.created,
      matchType: "tool",
      excerpt: part.tool,
      context: part.state?.title || part.tool,
      messageID: message.id,
      partID: part.id,
      projectDirectory: session.directory,
    });
    if (results.length >= limit) return;
  }

  if (part.type === "tool" && part.state) {
    const inputStr = JSON.stringify(part.state.input || {});
    const outputStr = part.state.output || "";
    if (pattern.test(inputStr) || pattern.test(outputStr)) {
      const matched = pattern.exec(inputStr) || pattern.exec(outputStr);
      if (matched) {
        results.push({
          sessionID: session.id,
          sessionTitle: session.title,
          timestamp: message.time.created,
          matchType: "filepath",
          excerpt: matched[0],
          context: part.state.title || part.tool || "",
          messageID: message.id,
          partID: part.id,
          projectDirectory: session.directory,
        });
        if (results.length >= limit) return;
      }
    }
  }

  if (part.type === "patch" && part.files) {
    for (const filePath of part.files) {
      if (results.length >= limit) return;
      if (pattern.test(filePath)) {
        results.push({
          sessionID: session.id,
          sessionTitle: session.title,
          timestamp: message.time.created,
          matchType: "filepath",
          excerpt: filePath,
          context: `Modified file: ${filePath}`,
          messageID: message.id,
          partID: part.id,
          projectDirectory: session.directory,
        });
      }
    }
  }
}
