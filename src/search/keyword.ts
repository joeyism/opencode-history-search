import type { Database } from "bun:sqlite";
import type { Session, Message, Part } from "../storage-provider";
import { listSessions, listMessages, listParts, withSqlite } from "../storage-provider";
import { listSessionRowsSync, listMessageRowsSync, listPartRowsSync } from "../storage-sqlite";
import { searchFts, searchTitles, escapeFtsPhrase, type FtsHit, type FtsKind } from "./fts";

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
  /** ms epoch, inclusive. Pushed into SQL when on the SQLite fast paths. */
  startTime?: number;
  /** ms epoch, inclusive. Pushed into SQL when on the SQLite fast paths. */
  endTime?: number;
}

export async function searchKeyword(
  projectID: string | null,
  query: string,
  options: KeywordOptions = {},
): Promise<SearchMatch[]> {
  // FTS5 fast path: keyword (non-regex) + SQLite => indexed MATCH.
  // Regex falls back to Phase 1 single-connection row scan.
  const fast = await withSqlite((db) => {
    if (options.regex) {
      return searchKeywordSqlite(db, projectID, query, options);
    }
    return searchKeywordFts(db, projectID, query, options);
  });
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
// FTS5 fast path. Uses the indexed part_fts table for content matches and a
// LIKE query on `session.title` for title matches. Falls back to the Phase 1
// row scan if the query has no tokenizable content (FTS5 would syntax-error).
// ---------------------------------------------------------------------------
function searchKeywordFts(
  db: Database,
  projectID: string | null,
  query: string,
  options: KeywordOptions,
): SearchMatch[] {
  const limit = options.limit || 50;
  const phrase = escapeFtsPhrase(query);

  // No tokenizable content (empty, whitespace, all punctuation). FTS5 would
  // syntax-error. Fall back to the row scan which uses RegExp semantics.
  if (phrase === null) {
    return searchKeywordSqlite(db, projectID, query, options);
  }

  const out: SearchMatch[] = [];

  // 1) Title matches via LIKE on session.title.
  //    Skipped when a role filter is set — titles aren't role-specific.
  if (!options.role) {
    const titles = searchTitles(db, query, { projectID, limit });
    for (const t of titles) {
      if (out.length >= limit) break;
      out.push({
        sessionID: t.id,
        sessionTitle: t.title,
        timestamp: t.time_updated,
        matchType: "title",
        excerpt: t.title,
        context: t.title,
        projectDirectory: t.directory,
      });
    }
  }

  // 2) Content matches via FTS5.
  // Over-fetch a bit because we'll dedupe by (partID, matchType).
  const overfetch = Math.min(limit * 3, 500);
  const hits = searchFts(db, phrase, {
    projectID,
    role: options.role,
    startTime: options.startTime,
    endTime: options.endTime,
    limit: overfetch,
  });

  const pattern = buildPattern(query, options);
  const seen = new Set<string>(); // partID|matchType to dedupe

  for (const hit of hits) {
    if (out.length >= limit) break;
    const m = ftsHitToSearchMatch(hit, query, pattern);
    if (!m) continue;
    const key = `${hit.part_id}|${m.matchType}|${m.excerpt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }

  return out.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Convert one FtsHit into a SearchMatch entry. We use the FTS-indexed `content`
 * column directly instead of re-fetching and re-decoding the raw part.data
 * blob. For text hits this is the message text; for patch_file hits it's the
 * file path; for tool hits it's the tool name + title. This avoids dragging
 * 16KB+ data blobs across the FFI per result.
 *
 * The pattern is the same RegExp the row-scan path uses, so the excerpt /
 * context extraction logic is identical when both paths return the same hit.
 */
function ftsHitToSearchMatch(
  hit: FtsHit,
  query: string,
  pattern: RegExp,
): SearchMatch | null {
  const base = {
    sessionID: hit.session_id,
    sessionTitle: hit.session_title,
    timestamp: hit.time_created,
    messageID: hit.message_id,
    partID: hit.part_id,
    projectDirectory: hit.session_directory,
  };

  const content = hit.content;
  const m = content.match(pattern);
  const idx = m ? content.indexOf(m[0]) : 0;
  const contextStart = Math.max(0, idx - 100);
  const contextEnd = Math.min(
    content.length,
    idx + (m?.[0].length ?? query.length) + 100,
  );
  const excerpt = m?.[0] ?? query;
  const context = content.slice(contextStart, contextEnd);

  switch (hit.kind as FtsKind) {
    case "text":
      return { ...base, matchType: "message", excerpt, context };
    case "tool_name":
      return { ...base, matchType: "tool", excerpt, context };
    case "tool_state":
      return { ...base, matchType: "filepath", excerpt, context };
    case "patch_file":
      // For patches, the entire content IS the file path. Surface it whole.
      return {
        ...base,
        matchType: "filepath",
        excerpt: content,
        context: `Modified file: ${content}`,
      };
  }
  return null;
}

// ---------------------------------------------------------------------------
// SQLite Phase-1 fast path (regex mode, or FTS fallback for empty queries).
// One Database, plain for-loops, no async overhead per row.
// ---------------------------------------------------------------------------
function searchKeywordSqlite(
  db: Database,
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
      // Apply date filter here too, since regex path doesn't have SQL pushdown.
      if (options.startTime !== undefined && message.time.created < options.startTime) continue;
      if (options.endTime !== undefined && message.time.created > options.endTime) continue;
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
// Shared per-part matcher. Identical logic for both row-scan paths.
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
