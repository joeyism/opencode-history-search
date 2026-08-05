import Fuse from "fuse.js";
import type { Session, Message, Part } from "../storage-provider";
import { listSessions, listMessages, listParts, withSqlite } from "../storage-provider";
import type { SearchMatch } from "./keyword";
import { listSessionRowsSync, listMessageRowsSync, listPartRowsSync } from "../storage-sqlite";

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
}

export async function searchFuzzy(
  projectID: string | null,
  query: string,
  options: FuzzyOptions = {},
): Promise<SearchMatch[]> {
  // Fast path: single SQLite connection for the corpus build.
  const fast = await withSqlite((db) =>
    searchFuzzySqlite(db, projectID, query, options),
  );
  if (fast !== null) return fast;
  return searchFuzzyGenerators(projectID, query, options);
}

function searchFuzzySqlite(
  db: any,
  projectID: string | null,
  query: string,
  options: FuzzyOptions,
): SearchMatch[] {
  const items: SearchableItem[] = [];

  const sessions = listSessionRowsSync(db, projectID);
  for (const session of sessions) {
    items.push({
      session,
      content: session.title,
      type: "title",
      timestamp: session.time.updated,
    });

    const messages = listMessageRowsSync(db, session.id, options.role);
    for (const message of messages) {
      const parts = listPartRowsSync(db, message.id);
      for (const part of parts) {
        addPartItems(items, session, message, part);
      }
    }
  }

  return runFuse(items, query, options);
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
