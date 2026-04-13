import { tool } from "@opencode-ai/plugin";
import { getCurrentProjectID } from "./storage-provider";
import { searchKeyword, type SearchMatch } from "./search/keyword";
import { searchFuzzy } from "./search/fuzzy";
import { parseDateFilter, filterByDate } from "./search/date-filter";
import { traceFile, type FileTraceResult } from "./search/file-trace";

function formatResults(matches: SearchMatch[]): string {
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

function formatTraceResults(matches: FileTraceResult[]): string {
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

const historySearch = tool({
  description: `Search through past conversation histories in the current repository. 
Searches session titles, message content, tool invocations, and file paths.
Also supports tracing a specific file to see when it was first seen/touched and what user prompt triggered each touch.
Supports keyword search, regex patterns, fuzzy search (for typos and variations), and date filtering.`,

  args: {
    query: tool.schema
      .string()
      .optional()
      .describe("Search query (keyword, regex pattern, or fuzzy search term). Required unless filePath is provided."),
    filePath: tool.schema
      .string()
      .optional()
      .describe("File path to trace touch history (e.g., 'src/auth.ts'). If provided, query, mode, regex, caseSensitive, fuzzyThreshold, and role are ignored."),
    mode: tool.schema
      .enum(["keyword", "fuzzy"])
      .optional()
      .describe(
        "Search mode: 'keyword' for exact matches, 'fuzzy' for typo-tolerant matching (default: keyword)",
      ),
    regex: tool.schema
      .boolean()
      .optional()
      .describe(
        "Treat query as regex pattern (keyword mode only, default: false)",
      ),
    caseSensitive: tool.schema
      .boolean()
      .optional()
      .describe("Case-sensitive search (keyword mode only, default: false)"),
    fuzzyThreshold: tool.schema
      .number()
      .optional()
      .describe(
        "Fuzzy match threshold 0.0-1.0 (fuzzy mode only, default: 0.4, lower = stricter)",
      ),
    date: tool.schema
      .string()
      .optional()
      .describe(
        "Filter by date: 'today', 'yesterday', 'last N days/weeks/months', 'YYYY-MM-DD', 'YYYY-MM', 'YYYY-MM-DD to YYYY-MM-DD'",
      ),
    limit: tool.schema
      .number()
      .optional()
      .describe("Maximum number of results (default: 50)"),
    role: tool.schema
      .enum(["user", "assistant"])
      .optional()
      .describe(
        "Filter by message role: 'user' for your messages only, 'assistant' for AI responses only. Ignored if filePath is provided.",
      ),
  },

  async execute(args) {
    if (!args.query && !args.filePath) {
      throw new Error("Either 'query' or 'filePath' must be provided.");
    }

    const projectID = await getCurrentProjectID();

    if (args.filePath) {
      let matches = await traceFile(projectID, args.filePath, {
        limit: args.limit,
      });

      if (args.date) {
        const dateRange = parseDateFilter(args.date);
        matches = filterByDate(matches, dateRange);
      }

      return formatTraceResults(matches);
    }

    // Default to query search if filePath is not provided
    if (!args.query) {
      throw new Error("'query' is required when 'filePath' is not provided.");
    }

    let matches =
      args.mode === "fuzzy"
        ? await searchFuzzy(projectID, args.query, {
            threshold: args.fuzzyThreshold,
            limit: args.limit,
            role: args.role,
          })
        : await searchKeyword(projectID, args.query, {
            regex: args.regex,
            caseSensitive: args.caseSensitive,
            limit: args.limit,
            role: args.role,
          });

    if (args.date) {
      const dateRange = parseDateFilter(args.date);
      matches = filterByDate(matches, dateRange);
    }

    return formatResults(matches);
  },
});

const server = async (_input?: unknown, _options?: unknown) => ({
  tool: { "history-search": historySearch },
});

export default { id: "opencode-history-search", server };
