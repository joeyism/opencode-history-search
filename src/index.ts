import { tool } from "@opencode-ai/plugin";
import { getCurrentProjectID } from "./storage-provider";
import { searchKeyword } from "./search/keyword";
import { searchFuzzy } from "./search/fuzzy";
import { parseDateFilter, filterByDate } from "./search/date-filter";
import { traceFile } from "./search/file-trace";
import { searchMultiterm } from "./search/multiterm-sql";
import { formatResults, formatTraceResults, formatMultitermResults } from "./format";

const historySearch = tool({
  description: `Search through past conversation histories. Use searchAllProjects=true to search ALL projects on this machine. Searches session titles, message content, tool invocations, and file paths.

THREE SEARCH MODES:
1. SINGLE-TERM (query): Pass query for one search term. Returns per-part matches. Use mode: "fuzzy" for typos, regex: true for patterns.
2. MULTI-TERM AND (terms): Pass terms: ["term1", "term2", ...] to find sessions containing ALL terms anywhere in the session (across title, messages, tools, file paths). Returns one result per session with per-term excerpts. Use when the user remembers multiple concepts (e.g., "find sessions about truck, vertex, and gemini"). Requires 2+ terms. SQLite-only.
3. FILE TRACE (filePath): Pass filePath to find which sessions created or modified a specific file.

Supports keyword search, regex patterns, fuzzy search, multi-term AND search, date filtering, and role filtering.`,

  args: {
    query: tool.schema
      .string()
      .optional()
      .describe("Search query (keyword, regex pattern, or fuzzy search term). Required unless filePath or terms is provided."),
    terms: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Array of terms for multi-term AND search. Returns sessions containing ALL terms anywhere in the session (title, messages, tools, file paths). Use when the user wants sessions matching multiple concepts (e.g., [\"truck\", \"vertex\", \"gemini\"]). Requires 2+ terms for multi-term path; 1 term falls back to single-term query. SQLite-only. Case-insensitive substring matching."),
    filePath: tool.schema
      .string()
      .optional()
      .describe("File path to trace touch history (e.g., 'src/auth.ts'). If provided, query, mode, regex, caseSensitive, fuzzyThreshold, and role are ignored."),
    searchAllProjects: tool.schema
      .boolean()
      .optional()
      .describe(
        "Set to true to search ALL projects on this machine across all repositories, not just the current one. Default: false (current repo only). Use when user asks to search globally, across all projects, machine-wide, or everywhere.",
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
        return formatMultitermResults(matches);
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

      return formatTraceResults(matches);
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

    return formatResults(matches);
  },
});
(historySearch as any).id = "opencode-history-search";
(historySearch as any).server = async (_input?: unknown, _options?: unknown) => ({
  tool: { "history-search": historySearch },
});

// --- OpenCode V2 plugin support -----------------------------------------
//
// OpenCode V2 validates a plugin module's default export against a schema
// that requires `{ id, setup }` (or `{ id, effect }`). The legacy tool fields
// above (`description`, `args`, `execute`, `server`) are kept on the same
// object so older V1 loaders keep working; V2 ignores unknown keys and only
// requires `setup` to exist.
//
// The structural types below mirror `@opencode/plugin` (promise variant) so
// the package does not need a runtime dependency on it.

interface V2ToolEditor {
  add(tool: {
    name: string;
    description: string;
    input: unknown;
    execute: (
      input: any,
      context: { signal: AbortSignal },
    ) => Promise<{ content?: string; metadata?: Record<string, unknown> }>;
  }): void;
}

interface V2PluginContext {
  tool?: {
    transform(callback: (editor: V2ToolEditor) => void): Promise<unknown>;
  };
}

(historySearch as any).setup = async (ctx: V2PluginContext) => {
  // Defensive: skip registration if this OpenCode build has no tool domain.
  if (!ctx?.tool?.transform) return;

  await ctx.tool.transform((editor) => {
    editor.add({
      name: "history-search",
      description: historySearch.description,
      // zod v4 shapes implement StandardSchemaV1, which V2 accepts directly
      // as a tool input schema — no JSON-Schema conversion needed.
      input: tool.schema.object(historySearch.args),
      execute: async (input, context) => {
        const result = await historySearch.execute(input, {
          sessionID: "",
          messageID: "",
          agent: "",
          directory: "",
          worktree: "",
          abort: context.signal,
          metadata: () => {},
          ask: async () => {},
        });
        // V1 ToolResult is `string | { output, metadata?, ... }`;
        // V2 expects `{ content, metadata? }` where content is a string.
        if (typeof result === "string") return { content: result };
        return { content: result.output, metadata: result.metadata };
      },
    });
  });
};

export default historySearch;
