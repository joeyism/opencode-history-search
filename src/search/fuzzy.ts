import Fuse from "fuse.js";
import type { Database } from "bun:sqlite";
import type { Session, Message, Part } from "../storage-provider";
import { listSessions, listMessages, listParts, withSqlite } from "../storage-provider";
import type { SearchMatch } from "./keyword";
import { searchFtsTrigram, searchTitles, escapeFtsPhrase, type FtsHit } from "./fts";

interface SearchableItem {
  session: Session;
  content: string;
  type: "title" | "message" | "tool" | "filepath";
  messageID?: string;
  partID?: string;
  timestamp: number;
}

export interface FuzzyOptions {
  threshold?: number;
  limit?: number;
  role?: "user" | "assistant";
  startTime?: number;
  endTime?: number;
}

export async function searchFuzzy(
  projectID: string | null,
  query: string,
  options: FuzzyOptions = {},
): Promise<SearchMatch[]> {
  // SQLite fast path: trigram FTS index. Sub-second on hundreds of thousands
  // of parts. Replaces the prior O(n) in-memory Fuse.js corpus rebuild.
  const fast = await withSqlite((db) =>
    searchFuzzyTrigram(db, projectID, query, options),
  );
  if (fast !== null) return fast;
  // JSON storage fallback (or tests that mock storage-provider).
  return searchFuzzyGenerators(projectID, query, options);
}

/**
 * Trigram-tokenized FTS5 search. Handles typos and substrings natively
 * because trigrams split words into overlapping 3-char chunks: "storage"
 * indexes "sto", "tor", "ora", "rag", "age" — so "storag" (missing letter)
 * matches via "sto", "tor", "ora". "Authentication" vs "autentication"
 * (typo) shares "aut", "ute", "ten", "ent" trigrams and matches.
 *
 * The trigram index only covers text + tool_name. Title matches and
 * everything else falls through to direct title LIKE.
 */
function searchFuzzyTrigram(
  db: Database,
  projectID: string | null,
  query: string,
  options: FuzzyOptions,
): SearchMatch[] {
  const limit = options.limit ?? 50;
  const phrase = escapeFtsPhrase(query);
  if (phrase === null) return [];

  const out: SearchMatch[] = [];

  // 1) Titles via LIKE (substring matching is already fuzzy-ish on short text).
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

  // 2) Content via trigram MATCH.
  const overfetch = Math.min(limit * 3, 500);
  const hits = searchFtsTrigram(db, phrase, {
    projectID,
    role: options.role,
    startTime: options.startTime,
    endTime: options.endTime,
    limit: overfetch,
  });

  const seen = new Set<string>();
  for (const hit of hits) {
    if (out.length >= limit) break;
    const m = ftsHitToFuzzyMatch(hit, query);
    const key = `${hit.part_id}|${m.matchType}|${m.excerpt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }

  return out.sort((a, b) => b.timestamp - a.timestamp);
}

function ftsHitToFuzzyMatch(hit: FtsHit, query: string): SearchMatch {
  // Trigram tokenization makes it hard to point at a single "best" match
  // offset, so we just slice a window from the start of the content for the
  // excerpt and a longer window for context. This matches the prior Fuse.js
  // behavior closely enough that result display looks the same.
  const content = hit.content;
  const excerpt = content.slice(0, 100) || query;
  const context = content.slice(0, 300) || excerpt;

  const matchType: SearchMatch["matchType"] =
    hit.kind === "text" ? "message" : "tool";

  return {
    sessionID: hit.session_id,
    sessionTitle: hit.session_title,
    timestamp: hit.time_created,
    matchType,
    excerpt,
    context,
    messageID: hit.message_id,
    partID: hit.part_id,
    projectDirectory: hit.session_directory,
  };
}

async function searchFuzzyGenerators(
  projectID: string | null,
  query: string,
  options: FuzzyOptions,
): Promise<SearchMatch[]> {
  const items: SearchableItem[] = [];

  try {
    for await (const session of listSessions(projectID)) {
      items.push({
        session,
        content: session.title,
        type: "title",
        timestamp: session.time.updated,
      });

      try {
        for await (const message of listMessages(session.id, options.role)) {
          try {
            for await (const part of listParts(message.id)) {
              addPartItems(items, session, message, part);
            }
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }
    }
  } catch {
    return [];
  }

  return runFuse(items, query, options);
}

function addPartItems(
  items: SearchableItem[],
  session: Session,
  message: Message,
  part: Part,
): void {
  if (part.type === "text" && part.text) {
    items.push({
      session,
      content: part.text,
      type: "message",
      messageID: message.id,
      partID: part.id,
      timestamp: message.time.created,
    });
  }

  if (part.type === "tool" && part.tool) {
    items.push({
      session,
      content: part.tool + " " + (part.state?.title || ""),
      type: "tool",
      messageID: message.id,
      partID: part.id,
      timestamp: message.time.created,
    });
  }

  if (part.type === "tool" && part.state) {
    const inputStr = JSON.stringify(part.state.input || {});
    const outputStr = part.state.output || "";
    const combined = inputStr + " " + outputStr;
    const pathMatches = combined.match(/(?:\/[^/\s]+)+/g);
    if (pathMatches) {
      for (const p of pathMatches) {
        items.push({
          session,
          content: p,
          type: "filepath",
          messageID: message.id,
          partID: part.id,
          timestamp: message.time.created,
        });
      }
    }
  }

  if (part.type === "patch" && part.files) {
    for (const filePath of part.files) {
      items.push({
        session,
        content: filePath,
        type: "filepath",
        messageID: message.id,
        partID: part.id,
        timestamp: message.time.created,
      });
    }
  }
}

function runFuse(
  items: SearchableItem[],
  query: string,
  options: FuzzyOptions,
): SearchMatch[] {
  const threshold = options.threshold ?? 0.4;
  const limit = options.limit ?? 50;

  const fuse = new Fuse(items, {
    keys: ["content"],
    threshold,
    includeScore: true,
    includeMatches: true,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });

  const results = fuse.search(query, { limit });

  return results
    .map((result) => {
      const matchedText = result.matches?.[0]?.value || result.item.content;
      const matchIndex = result.matches?.[0]?.indices?.[0]?.[0] || 0;

      const contextStart = Math.max(0, matchIndex - 100);
      const contextEnd = Math.min(matchedText.length, matchIndex + 200);
      const context = matchedText.slice(contextStart, contextEnd);

      const excerptStart = Math.max(0, matchIndex - 20);
      const excerptEnd = Math.min(matchedText.length, matchIndex + 80);
      const excerpt = matchedText.slice(excerptStart, excerptEnd);

      return {
        sessionID: result.item.session.id,
        sessionTitle: result.item.session.title,
        timestamp: result.item.timestamp,
        matchType: result.item.type,
        excerpt: excerpt || query,
        context: context || excerpt,
        messageID: result.item.messageID,
        partID: result.item.partID,
        projectDirectory: result.item.session.directory,
      };
    })
    .sort((a, b) => b.timestamp - a.timestamp);
}
