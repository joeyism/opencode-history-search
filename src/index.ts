import { Plugin } from "@opencode/plugin";
import { getCurrentProjectID } from "./storage-provider";
import { searchKeyword } from "./search/keyword";
import { searchFuzzy } from "./search/fuzzy";
import { parseDateFilter, filterByDate } from "./search/date-filter";
import { traceFile } from "./search/file-trace";
import { searchMultiterm } from "./search/multiterm-sql";
import { formatResults, formatTraceResults, formatMultitermResults } from "./format";

interface HistorySearchArgs {
  query?: string;
  terms?: string[];
  filePath?: string;
  searchAllProjects?: boolean;
  mode?: "keyword" | "fuzzy";
  regex?: boolean;
  caseSensitive?: boolean;
  fuzzyThreshold?: number;
  date?: string;
  limit?: number;
  role?: "user" | "assistant";
}

const historySearch = {
  name: "history-search",
  description: `Search through past conversation histories. Use searchAllProjects=true to search ALL projects on this machine. Searches session titles, message content, tool invocations, and file paths.

THREE SEARCH MODES:
1. SINGLE-TERM (query): Pass query for one search term. Returns per-part matches. Use mode: "fuzzy" for typos, regex: true for patterns.
2. MULTI-TERM AND (terms): Pass terms: ["term1", "term2", ...] to find sessions containing ALL terms anywhere in the session (across title, messages, tools, file paths). Returns one result per session with per-term excerpts. Use when the user remembers multiple concepts (e.g., "find sessions about truck, vertex, and gemini"). Requires 2+ terms. SQLite-only.
3. FILE TRACE (filePath): Pass filePath to find which sessions created or modified a specific file.

Supports keyword search, regex patterns, fuzzy search, multi-term AND search, date filtering, and role filtering.`,
  input: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Search query (keyword, regex pattern, or fuzzy search term). Required unless filePath or terms is provided.",
      },
      terms: {
        type: "array",
        items: { type: "string" },
        description:
          'Array of terms for multi-term AND search. Returns sessions containing ALL terms anywhere in the session (title, messages, tools, file paths). Use when the user wants sessions matching multiple concepts (e.g., ["truck", "vertex", "gemini"]). Requires 2+ terms for multi-term path; 1 term falls back to single-term query. SQLite-only. Case-insensitive substring matching.',
      },
      filePath: {
        type: "string",
        description:
          "File path to trace touch history (e.g., 'src/auth.ts'). If provided, query, mode, regex, caseSensitive, fuzzyThreshold, and role are ignored.",
      },
      searchAllProjects: {
        type: "boolean",
        description:
          "Set to true to search ALL projects on this machine across all repositories, not just the current one. Default: false (current repo only). Use when user asks to search globally, across all projects, machine-wide, or everywhere.",
      },
      mode: {
        type: "string",
        enum: ["keyword", "fuzzy"],
        description:
          "Search mode: 'keyword' for exact matches, 'fuzzy' for typo-tolerant matching (default: keyword)",
      },
      regex: {
        type: "boolean",
        description: "Treat query as regex pattern (keyword mode only, default: false)",
      },
      caseSensitive: {
        type: "boolean",
        description: "Case-sensitive search (keyword mode only, default: false)",
      },
      fuzzyThreshold: {
        type: "number",
        description:
          "Fuzzy match threshold 0.0-1.0 (fuzzy mode only, default: 0.4, lower = stricter)",
      },
      date: {
        type: "string",
        description:
          "Filter by date: 'today', 'yesterday', 'last N days/weeks/months', 'YYYY-MM-DD', 'YYYY-MM', 'YYYY-MM-DD to YYYY-MM-DD'",
      },
      limit: {
        type: "number",
        description: "Maximum number of results (default: 50)",
      },
      role: {
        type: "string",
        enum: ["user", "assistant"],
        description:
          "Filter by message role: 'user' for your messages only, 'assistant' for AI responses only. Ignored if filePath is provided.",
      },
    },
    additionalProperties: false,
  },

  async execute(raw: unknown, _context?: unknown) {
    const args = (raw ?? {}) as HistorySearchArgs;
    if (!args.query && !args.filePath && !args.terms) {
      throw new Error("Either 'query', 'terms', or 'filePath' must be provided.");
    }

    if (args.terms !== undefined) {
      if (!Array.isArray(args.terms) || args.terms.length === 0) {
        throw new Error("'terms' must be a non-empty array of strings.");
      }
      if (args.terms.length === 1) {
        args.query = args.terms[0];
      } else {
        const projectID = args.searchAllProjects ? null : await getCurrentProjectID();
        let matches = await searchMultiterm(projectID, args.terms, {
          limit: args.limit,
        });
        if (args.date) {
          const dateRange = parseDateFilter(args.date);
          matches = filterByDate(matches, dateRange);
        }
        return { content: formatMultitermResults(matches) };
      }
    }

    const projectID = args.searchAllProjects ? null : await getCurrentProjectID();

    if (args.filePath) {
      let matches = await traceFile(projectID, args.filePath, {
        limit: args.limit,
      });

      if (args.date) {
        const dateRange = parseDateFilter(args.date);
        matches = filterByDate(matches, dateRange);
      }

      return { content: formatTraceResults(matches) };
    }

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

    return { content: formatResults(matches) };
  },
};

export default Plugin.define({
  id: "opencode-history-search",
  async setup(ctx) {
    ctx.tool.transform((editor) => {
      editor.add(historySearch);
    });
  },
});

export { historySearch };
