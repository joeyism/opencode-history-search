import Fuse from "fuse.js";
import type { Session, Message, Part } from "../storage";
import { listSessions, listMessages, listParts } from "../storage";
import type { SearchMatch } from "./keyword";

interface SearchableItem {
  session: Session;
  content: string;
  type: "title" | "message" | "tool" | "filepath";
  messageID?: string;
  partID?: string;
  timestamp: number;
}

export async function searchFuzzy(
  projectID: string,
  query: string,
  options: {
    threshold?: number; // 0.0 = exact, 1.0 = anything (default: 0.4)
    limit?: number;
  } = {},
): Promise<SearchMatch[]> {
  const threshold = options.threshold ?? 0.4;
  const limit = options.limit ?? 50;

  // Build searchable index
  const items: SearchableItem[] = [];

  try {
    for await (const session of listSessions(projectID)) {
      // Index session title
      items.push({
        session,
        content: session.title,
        type: "title",
        timestamp: session.time.updated,
      });

      // Index messages
      try {
        for await (const message of listMessages(session.id)) {
          try {
            for await (const part of listParts(message.id)) {
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

              // Index file paths from tool inputs/outputs
              if (part.type === "tool" && part.state) {
                const inputStr = JSON.stringify(part.state.input || {});
                const outputStr = part.state.output || "";
                const combined = inputStr + " " + outputStr;

                // Extract file path patterns
                const pathMatches = combined.match(/(?:\/[^/\s]+)+/g);
                if (pathMatches) {
                  for (const path of pathMatches) {
                    items.push({
                      session,
                      content: path,
                      type: "filepath",
                      messageID: message.id,
                      partID: part.id,
                      timestamp: message.time.created,
                    });
                  }
                }
              }
            }
          } catch {
            // Skip corrupt part files
            continue;
          }
        }
      } catch {
        // Skip sessions with missing message directory
        continue;
      }
    }
  } catch {
    // Handle missing sessions directory
    return [];
  }

  // Perform fuzzy search
  const fuse = new Fuse(items, {
    keys: ["content"],
    threshold,
    includeScore: true,
    includeMatches: true,
    ignoreLocation: true, // Don't bias toward beginning of string
    minMatchCharLength: 2,
  });

  const results = fuse.search(query, { limit });

  return results
    .map((result) => {
      const matchedText = result.matches?.[0]?.value || result.item.content;
      const matchIndex = result.matches?.[0]?.indices?.[0]?.[0] || 0;

      // Extract context around the match
      const contextStart = Math.max(0, matchIndex - 100);
      const contextEnd = Math.min(matchedText.length, matchIndex + 200);
      const context = matchedText.slice(contextStart, contextEnd);

      // Extract excerpt (the matched portion)
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
      };
    })
    .sort((a, b) => b.timestamp - a.timestamp);
}
