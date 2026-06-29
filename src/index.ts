import { tool } from "@opencode-ai/plugin";
import { getCurrentProjectID, listSessions } from "./storage-provider";
import { searchKeyword } from "./search/keyword";
import { searchFuzzy } from "./search/fuzzy";
import { parseDateFilter, filterByDate } from "./search/date-filter";
import { traceFile } from "./search/file-trace";
import { formatResults, formatTraceResults, formatListResults } from "./format";
import type { Session } from "./storage";

const historySearch = tool({
  description: `Search through past conversation histories. Use searchAllProjects=true to search ALL projects on this machine. Searches session titles, message content, tool invocations, and file paths. Supports keyword search, regex patterns, fuzzy search (for typos and variations), and date filtering. Use list=true to browse all sessions grouped by folder with per-folder counts (ignores query/filePath).`,

  args: {
    query: tool.schema
      .string()
      .optional()
      .describe("Search query (keyword, regex pattern, or fuzzy search term). Required unless filePath or list is provided."),
    list: tool.schema
      .boolean()
      .optional()
      .describe(
        "Set to true to list sessions grouped by folder with per-folder counts, newest-first. Ignores query, filePath, mode, regex, fuzzy, and role. Respects searchAllProjects, date, and limit (default: 50). Counts reflect the returned (possibly limited) sessions.",
      ),
    filePath: tool.schema
      .string()
      .optional()
      .describe("File path to trace touch history (e.g., 'src/auth.ts'). If provided, query, mode, regex, caseSensitive, fuzzyThreshold, and role are ignored."),
    searchAllProjects: tool.schema
      .boolean()
      .optional()
      .describe(
        "Set to true to search ALL projects on your machine across all repositories, not just the current one. Default: false (current repo only). Use when user asks to search globally, across all projects, machine-wide, or everywhere.",
      ),
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
    if (!args.list && !args.query && !args.filePath) {
      throw new Error("Either 'query', 'filePath', or 'list' must be provided.");
    }

    const projectID = args.searchAllProjects ? null : await getCurrentProjectID();

    // List mode: ignore query/filePath/fuzzy/regex and return a folder-grouped
    // overview of sessions. Honors searchAllProjects, date, and limit.
    if (args.list) {
      const sessions: Session[] = [];
      for await (const session of listSessions(projectID)) {
        sessions.push(session);
      }

      let filtered = sessions;
      if (args.date) {
        const dateRange = parseDateFilter(args.date);
        filtered = filterByDate(
          sessions.map((s) => ({ ...s, timestamp: s.time.updated })),
          dateRange,
        );
      }

      // Newest-first, then cap by limit (default 50) to match search behaviour.
      filtered.sort((a, b) => b.time.updated - a.time.updated);
      const limit = args.limit ?? 50;
      const capped = filtered.slice(0, limit);

      return formatListResults(capped);
    }

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
(historySearch as any).id = "opencode-history-search";
(historySearch as any).server = async (_input?: unknown, _options?: unknown) => ({
  tool: { "history-search": historySearch },
});

export default historySearch;
