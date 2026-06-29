import type { SearchMatch } from "./search/keyword";
import type { FileTraceResult } from "./search/file-trace";
import type { Session } from "./storage";

const LIST_TITLE_MAX = 60;

function truncateTitle(title: string): string {
  const clean = (title || "(untitled)").trim() || "(untitled)";
  if (clean.length <= LIST_TITLE_MAX) return clean;
  return clean.slice(0, LIST_TITLE_MAX - 1).trimEnd() + "…";
}

function formatLocalTimestamp(millis: number): string {
  const d = new Date(millis);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `${date} ${time}`;
}

/**
 * Render a folder-grouped listing of sessions.
 * - Folders are sorted by their most-recently-updated session (newest first).
 * - Sessions within a folder are sorted newest-first.
 */
export function formatListResults(sessions: Session[]): string {
  if (sessions.length === 0) {
    return "No sessions found.";
  }

  // Group by directory.
  const groups = new Map<string, Session[]>();
  for (const session of sessions) {
    const dir = session.directory || "(unknown directory)";
    const existing = groups.get(dir);
    if (existing) {
      existing.push(session);
    } else {
      groups.set(dir, [session]);
    }
  }

  // Sort sessions within each folder newest-first and capture each folder's
  // most-recent timestamp for folder ordering.
  const folders = Array.from(groups.entries()).map(([directory, items]) => {
    items.sort((a, b) => b.time.updated - a.time.updated);
    const mostRecent = items[0]?.time.updated ?? 0;
    return { directory, items, mostRecent };
  });

  // Folders sorted by most-recently-updated session (newest first).
  folders.sort((a, b) => b.mostRecent - a.mostRecent);

  const lines: string[] = [];
  for (const folder of folders) {
    const count = folder.items.length;
    const plural = count === 1 ? "session" : "sessions";
    lines.push(`== ${folder.directory}  (${count} ${plural}) ==`);
    for (const session of folder.items) {
      const ts = formatLocalTimestamp(session.time.updated);
      const title = truncateTitle(session.title);
      lines.push(`  ${ts}    ${title}  ${session.id}`);
    }
  }

  return lines.join("\n");
}

export function formatResults(matches: SearchMatch[]): string {
  if (matches.length === 0) {
    return "No matches found in conversation history.";
  }

  const lines: string[] = [
    `Found ${matches.length} matches in conversation history:\n`,
  ];

  for (const match of matches) {
    const date = new Date(match.timestamp).toISOString().split("T")[0];
    const time = new Date(match.timestamp).toTimeString().split(" ")[0];

    lines.push(`## ${match.sessionTitle}`);
    lines.push(`- Session ID: ${match.sessionID}`);
    lines.push(`- Project: ${match.projectDirectory}`);
    lines.push(`- Date: ${date} ${time}`);
    lines.push(`- Match Type: ${match.matchType}`);
    lines.push(`- Excerpt: "${match.excerpt}"`);

    if (match.context && match.context !== match.excerpt) {
      lines.push(`- Context: ...${match.context}...`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

export function formatTraceResults(matches: FileTraceResult[]): string {
  if (matches.length === 0) {
    return "No file trace matches found in conversation history.";
  }

  const lines: string[] = [
    `Found ${matches.length} file trace matches in conversation history:\n`,
  ];

  for (const match of matches) {
    const date = new Date(match.timestamp).toISOString().split("T")[0];
    const time = new Date(match.timestamp).toTimeString().split(" ")[0];

    lines.push(`## ${match.sessionTitle}`);
    lines.push(`- Session ID: ${match.sessionID}`);
    lines.push(`- Date: ${date} ${time}`);
    lines.push(`- Status: ${match.firstTouch ? "First seen" : "Later touch"}`);
    lines.push(`- File: ${match.filePath}`);
    if (match.toolName) {
      lines.push(`- Tool: ${match.toolName}`);
    }

    if (match.userPrompt) {
      lines.push(`- Preceding User Prompt: "${match.userPrompt}"`);
    }

    lines.push("");
  }

  return lines.join("\n");
}
