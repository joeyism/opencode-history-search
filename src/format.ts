import type { SearchMatch } from "./search/keyword";
import type { FileTraceResult } from "./search/file-trace";

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
