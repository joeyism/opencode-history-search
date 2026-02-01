# opencode-history-search

[![Tests](https://github.com/yourusername/opencode-history-search/workflows/Tests/badge.svg)](https://github.com/yourusername/opencode-history-search/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Search through your OpenCode conversation history with powerful keyword, regex, and fuzzy search capabilities.

## Features

- 🔍 **Keyword Search** - Find exact matches in your conversation history
- 🎯 **Regex Search** - Use regular expressions for advanced pattern matching
- ✨ **Fuzzy Search** - Typo-tolerant search that finds matches even with spelling errors
- 📅 **Date Filtering** - Filter by "today", "last 7 days", "2024-01", date ranges, and more
- 📊 **Multiple Match Types** - Search across session titles, messages, tool invocations, and file paths
- ⚡ **Fast Performance** - Queries complete in < 50ms even with thousands of messages
- 🎛️ **Configurable** - Adjust search strictness, limits, and case sensitivity

## Installation

### Quick Install (Recommended)

Install directly from npm/GitHub using npx or bunx:

```bash
# Using npx (works with npm)
npx opencode-history-search

# Or using bunx (works with bun)
bunx opencode-history-search

# Or from GitHub (after publishing)
npx github:yourusername/opencode-history-search
```

That's it! The installer will:

- ✅ Copy the tool to `~/.opencode/tool/`
- ✅ Create the description file automatically
- ✅ Show you usage examples

Then restart OpenCode and the tool is ready to use!

### Manual Installation

If you prefer to install manually or from a local clone:

```bash
# Clone and build
git clone https://github.com/yourusername/opencode-history-search.git
cd opencode-history-search
bun install
bun run build

# Run the installer
bun run install:tool

# Or install manually
cp dist/history-search.ts ~/.opencode/tool/history-search.ts
```

### Development Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/opencode-history-search.git
cd opencode-history-search

# Install dependencies
bun install

# Run tests
bun test

# Build the bundled version
bun run build
```

### Installing via AI Agent

If you're using OpenCode or another AI coding assistant, you can ask the agent to install this tool for you. Here are example prompts:

**Simplest approach** (after publishing to npm):

```
Install the opencode-history-search tool using npx
```

**From a local repository**:

```
Install the history search tool from ~/Programming/node/opencode-history-search
```

**Full installation request**:

```
Please install the opencode-history-search tool:
1. Navigate to ~/Programming/node/opencode-history-search
2. Run bun install
3. Run bun run build
4. Run bun run install:tool
```

**What the agent will do**:

- ✅ Install dependencies
- ✅ Build the bundled tool
- ✅ Copy to `~/.opencode/tool/history-search.ts`
- ✅ Create the tool description file
- ✅ Verify installation

After the agent confirms installation, restart OpenCode and the tool will be available.

## Usage

### In OpenCode

Once installed, you can use natural language to search your history:

```
You: Search my conversation history for "storage"
AI: <uses history-search tool and returns results>

You: Search for "storag" with fuzzy mode
AI: <finds "storage" matches despite typo>

You: Find all conversations where I used grep
AI: <searches for "grep" in tool invocations>

You: Search for "authentication" from last 7 days
AI: <finds matches from the past week>

You: Find "storage" discussions from January 2024
AI: <searches with date filter "2024-01">
```

### Programmatic Usage

```typescript
import tool from "./dist/history-search.ts";

// Keyword search
const result = await tool.execute({
  query: "storage",
  limit: 10,
});

// Fuzzy search (typo-tolerant)
const fuzzyResult = await tool.execute({
  query: "storag", // typo: missing 'e'
  mode: "fuzzy",
  fuzzyThreshold: 0.4, // 0.0 = strict, 1.0 = loose
  limit: 10,
});

// Regex search
const regexResult = await tool.execute({
  query: "storage.*\\.ts",
  regex: true,
  limit: 10,
});

// Case-sensitive search
const caseSensitive = await tool.execute({
  query: "Storage",
  caseSensitive: true,
  limit: 10,
});

// Date filtering
const recent = await tool.execute({
  query: "storage",
  date: "last 7 days",
  limit: 10,
});

// Specific month
const january = await tool.execute({
  query: "authentication",
  date: "2024-01",
});

// Date range
const range = await tool.execute({
  query: "bug",
  date: "2024-01-15 to 2024-01-31",
});
```

## Parameters

| Parameter        | Type                     | Default     | Description                                            |
| ---------------- | ------------------------ | ----------- | ------------------------------------------------------ |
| `query`          | string                   | _required_  | Search query (keyword, regex, or fuzzy)                |
| `mode`           | `"keyword"` \| `"fuzzy"` | `"keyword"` | Search mode                                            |
| `regex`          | boolean                  | `false`     | Treat query as regex (keyword mode only)               |
| `caseSensitive`  | boolean                  | `false`     | Enable case-sensitive search (keyword mode only)       |
| `fuzzyThreshold` | number                   | `0.4`       | Fuzzy match strictness 0.0-1.0 (fuzzy mode only)       |
| `date`           | string                   | _none_      | Filter by date (see [Date Filtering](#date-filtering)) |
| `limit`          | number                   | `50`        | Maximum number of results                              |

## Search Modes

### Keyword Search

Finds exact matches (case-insensitive by default).

```typescript
{ query: "storage", mode: "keyword" }
// Finds: "storage", "Storage", "STORAGE"
// Doesn't find: "storag", "storing"
```

### Regex Search

Uses regular expressions for pattern matching.

```typescript
{ query: "stor.*ge", regex: true }
// Finds: "storage", "storeage", "storing"
```

### Fuzzy Search

Tolerates typos and variations using Levenshtein distance.

```typescript
{ query: "storag", mode: "fuzzy", fuzzyThreshold: 0.3 }
// Finds: "storage" (even with missing letter)

{ query: "ripgrap", mode: "fuzzy", fuzzyThreshold: 0.4 }
// Finds: "ripgrep" (despite typo)
```

## Date Filtering

Filter search results by date using natural language or ISO dates.

### Supported Formats

| Format                       | Example                            | Description                                    |
| ---------------------------- | ---------------------------------- | ---------------------------------------------- |
| `"today"`                    | `date: "today"`                    | Conversations from today (00:00:00 - 23:59:59) |
| `"yesterday"`                | `date: "yesterday"`                | Conversations from yesterday                   |
| `"last N days"`              | `date: "last 7 days"`              | Last N days from now                           |
| `"last N weeks"`             | `date: "last 2 weeks"`             | Last N weeks from now                          |
| `"last N months"`            | `date: "last 3 months"`            | Last N months from now                         |
| `"YYYY-MM-DD"`               | `date: "2024-01-15"`               | Specific day                                   |
| `"YYYY-MM"`                  | `date: "2024-01"`                  | Entire month                                   |
| `"YYYY-MM-DD to YYYY-MM-DD"` | `date: "2024-01-01 to 2024-01-31"` | Date range (inclusive)                         |

### Examples

```typescript
// Recent conversations
{ query: "storage", date: "last 7 days" }

// Specific month
{ query: "authentication", date: "2024-01" }

// Specific day
{ query: "bug fix", date: "2024-01-15" }

// Date range
{ query: "refactor", date: "2024-01-01 to 2024-01-31" }

// Combined with fuzzy search
{ query: "storag", mode: "fuzzy", date: "last 30 days" }
```

## Output Format

Results are returned as formatted markdown:

```
Found 3 matches in conversation history:

## Implement storage layer
- Session ID: ses_abc123...
- Date: 2026-02-01 10:30:00
- Match Type: title
- Excerpt: "Implement storage layer"

## Fix storage bug
- Session ID: ses_def456...
- Date: 2026-01-31 14:20:15
- Match Type: message
- Excerpt: "The storage module has a bug..."
- Context: ...need to fix the storage module has a bug in the...
```

## Match Types

The tool searches across multiple content types:

- **`title`** - Session titles
- **`message`** - User and assistant message content
- **`tool`** - Tool invocations (grep, edit, bash, etc.)
- **`filepath`** - File paths in tool inputs/outputs

## Performance

- **Keyword search**: ~7-10ms per query
- **Fuzzy search**: ~40-50ms per query
- **Memory efficient**: Async iteration, no full dataset loading
- **Scales well**: Tested with 6,883+ messages

## Development

### Running Tests

```bash
# Run unit tests
bun test

# Run unit tests only
bun run test:unit

# Run integration tests
bun run test:integration

# Run all tests
bun run test:all
```

### Building

```bash
# Build the bundled version
bun run build

# Output: dist/history-search.ts
```

### Project Structure

```
opencode-history-search/
├── src/
│   ├── index.ts              # Tool definition & main entry
│   ├── storage.ts            # OpenCode storage access
│   ├── storage.test.ts       # Storage unit tests
│   └── search/
│       ├── keyword.ts        # Keyword & regex search
│       ├── keyword.test.ts   # Keyword search tests
│       ├── fuzzy.ts          # Fuzzy search implementation
│       ├── fuzzy.test.ts     # Fuzzy search tests
│       ├── date-filter.ts    # Date filtering logic
│       └── date-filter.test.ts # Date filter tests
├── test/
│   ├── comprehensive-test.ts              # Basic integration tests
│   ├── comprehensive-test-with-data.ts    # Real data tests
│   └── date-filter-integration.test.ts    # Date filtering integration tests
├── dist/
│   └── history-search.ts     # Bundled single-file version
├── build.ts                  # Build script
├── package.json
├── tsconfig.json
└── README.md
```

## How It Works

1. **Storage Access**: Reads OpenCode conversation data from `~/.local/share/opencode/storage/`
2. **Project Scoping**: Uses git root commit hash to scope searches to current repository
3. **Indexing**: For fuzzy search, builds a searchable index of all content
4. **Matching**: Applies chosen search algorithm (keyword, regex, or fuzzy)
5. **Sorting**: Returns results sorted by timestamp (newest first)
6. **Formatting**: Presents results in readable markdown format

## Storage Structure

OpenCode stores conversations in JSON files:

```
~/.local/share/opencode/storage/
├── session/{projectID}/ses_*.json   # Session metadata
├── message/{sessionID}/msg_*.json   # Messages
└── part/{messageID}/part_*.json     # Message parts (text, tool, file)
```

The tool reads these files to search your history.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

### Guidelines

- Follow existing code style
- Add tests for new features
- Update documentation
- Ensure all tests pass before submitting

## License

MIT

## Acknowledgments

- Built for [OpenCode](https://opencode.ai) - The open source AI coding agent
- Uses [Fuse.js](https://fusejs.io/) for fuzzy search
- Powered by [Bun](https://bun.sh)
