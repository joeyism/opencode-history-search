import type { Session, Message, Part } from "../storage";
import { listSessions, listMessages, listParts } from "../storage";

export interface SearchMatch {
  sessionID: string;
  sessionTitle: string;
  timestamp: number;
  matchType: "title" | "message" | "tool" | "filepath";
  excerpt: string;
  context: string;
  messageID?: string;
  partID?: string;
}

export async function searchKeyword(
  projectID: string,
  query: string,
  options: {
    regex?: boolean;
    caseSensitive?: boolean;
    limit?: number;
  } = {},
): Promise<SearchMatch[]> {
  const results: SearchMatch[] = [];
  const pattern = options.regex
    ? new RegExp(query, options.caseSensitive ? "" : "i")
    : new RegExp(
        query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        options.caseSensitive ? "" : "i",
      );

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
      });
      if (results.length >= limit) break;
    }

    for await (const message of listMessages(session.id)) {
      if (results.length >= limit) break;

      for await (const part of listParts(message.id)) {
        if (results.length >= limit) break;

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
            context: context,
            messageID: message.id,
            partID: part.id,
          });
          if (results.length >= limit) break;
        }

        if (results.length >= limit) break;
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
          });
          if (results.length >= limit) break;
        }

        if (results.length >= limit) break;
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
              });
              if (results.length >= limit) break;
            }
          }
        }
      }
    }
  }

  return results.sort((a, b) => b.timestamp - a.timestamp);
}
