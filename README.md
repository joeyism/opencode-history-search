# opencode-history-search

[![npm version](https://img.shields.io/npm/v/opencode-history-search.svg)](https://www.npmjs.com/package/opencode-history-search)
[![npm downloads](https://img.shields.io/npm/dm/opencode-history-search.svg)](https://www.npmjs.com/package/opencode-history-search)
[![Tests](https://github.com/joeyism/opencode-history-search/workflows/Tests/badge.svg)](https://github.com/joeyism/opencode-history-search/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Search through your OpenCode conversation history with keyword, regex, and fuzzy search.

<video src="https://github.com/user-attachments/assets/f492da67-3f54-4989-abb3-2d40c3a8fe7c" autoplay loop muted playsinline width="100%"></video>

## Features

- **Keyword Search** - Find exact matches in your conversation history
- **Regex Search** - Use regular expressions for advanced pattern matching
- **Fuzzy Search** - Typo-tolerant search that finds matches even with spelling errors
- **Date Filtering** - Filter by "today", "last 7 days", "2024-01", date ranges, and more
- **Role Filtering** - Search only your messages (`user`) or only AI responses (`assistant`)
- **File Modification Tracking** - Find which sessions modified specific files
- **Multiple Match Types** - Search across session titles, messages, tool invocations, and file paths
- **Fast** - Queries complete in < 50ms even with thousands of messages
- **SQLite + JSON Support** - Works with OpenCode v1.2+ (SQLite) and v1.1.x (JSON files)

## Installation

### OpenCode Install (Recommended)

Add to your OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-history-search"
  ]
}
```

Then restart OpenCode.

### Quick Install

```bash
# Using npx (npm)
npx opencode-history-search

# Using bunx (bun)
bunx opencode-history-search

# From GitHub directly
npx github:joeyism/opencode-history-search
```

The installer copies the tool to `~/.opencode/tool/` and creates the description file. Then restart OpenCode.

### Manual Installation

```bash
git clone https://github.com/joeyism/opencode-history-search.git
cd opencode-history-search
bun install
bun run build
bun run install:tool
```

## Use Cases

Things you can ask OpenCode once this tool is installed:

### Find sessions where a file was created or modified

> "Find me sessions where you created or modified `src/install.ts`"

> "Which sessions touched anything under `src/utils/`?"

> "Show me every time you edited the auth module"

### Find something you worked on recently

> "Find sessions from the last 7 days where we talked about storage"

> "What did we work on yesterday?"

> "Show me sessions from January where we discussed authentication"

### Recall something the AI said or implemented

> "Find sessions where you explained how fuzzy search works"

> "Search my history for where you wrote a Bun SQLite query"

> "Find sessions where you mentioned ripgrep"

### Recall something you asked

> "Find sessions where I asked about rate limiting" _(role: user)_

> "Search only my messages for 'how do I'"

### Find sessions by topic when you can't remember the exact wording

> "Find sessions related to 'autentication'" _(fuzzy — catches typos)_

> "Search for 'databse connection'" _(fuzzy — finds "database connection")_

### Find sessions where a specific tool was used

> "Find sessions where you ran grep on the codebase"

> "Show me sessions where you used the bash tool"

### Search with a pattern

> "Find all sessions that touched any `.test.ts` file"

> "Find sessions mentioning any `stor*.ts` file"

## Parameters

| Parameter        | Type                      | Default     | Description                                            |
| ---------------- | ------------------------- | ----------- | ------------------------------------------------------ |
| `query`          | string                    | _required_  | Search query (keyword, regex, or fuzzy term)           |
| `mode`           | `"keyword"` \| `"fuzzy"`  | `"keyword"` | Search mode                                            |
| `regex`          | boolean                   | `false`     | Treat query as regex (keyword mode only)               |
| `caseSensitive`  | boolean                   | `false`     | Enable case-sensitive search (keyword mode only)       |
| `fuzzyThreshold` | number                    | `0.4`       | Fuzzy match strictness 0.0-1.0 (fuzzy mode only)       |
| `date`           | string                    | _none_      | Filter by date (see [Date Filtering](#date-filtering)) |
| `limit`          | number                    | `50`        | Maximum number of results                              |
| `role`           | `"user"` \| `"assistant"` | _none_      | Filter by message role (omit to search both)           |

## Search Modes

### Keyword Search

Finds exact matches (case-insensitive by default).

```typescript
{ query: "storage", mode: "keyword" }
// Finds: "storage", "Storage", "STORAGE"
// Does not find: "storag", "storing"
```

### Regex Search

Uses regular expressions for pattern matching.

```typescript
{ query: "stor.*ge", regex: true }
// Finds: "storage", "storeage"
```

### Fuzzy Search

Tolerates typos and variations using Levenshtein distance.

```typescript
{ query: "storag", mode: "fuzzy", fuzzyThreshold: 0.3 }
// Finds: "storage" (missing letter)

{ query: "ripgrap", mode: "fuzzy", fuzzyThreshold: 0.4 }
// Finds: "ripgrep" (transposition)
```

## Date Filtering

| Format                       | Example                            | Description                      |
| ---------------------------- | ---------------------------------- | -------------------------------- |
| `"today"`                    | `date: "today"`                    | Today (00:00:00 - 23:59:59)      |
| `"yesterday"`                | `date: "yesterday"`                | Yesterday                        |
| `"last N days"`              | `date: "last 7 days"`              | Last N days from now             |
| `"last N weeks"`             | `date: "last 2 weeks"`             | Last N weeks from now            |
| `"last N months"`            | `date: "last 3 months"`            | Last N months from now           |
| `"YYYY-MM-DD"`               | `date: "2024-01-15"`               | Specific day                     |
| `"YYYY-MM"`                  | `date: "2024-01"`                  | Entire month                     |
| `"YYYY-MM-DD to YYYY-MM-DD"` | `date: "2024-01-01 to 2024-01-31"` | Date range (inclusive)           |

## Output Format

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

### Match Types

| Type        | What it matches                                           |
| ----------- | --------------------------------------------------------- |
| `title`     | Session title                                             |
| `message`   | Text content of a user or assistant message               |
| `tool`      | Tool name (grep, edit, bash, read, etc.)                  |
| `filepath`  | File paths in tool inputs/outputs or patch parts          |

## How It Works

1. **Storage**: Auto-detects SQLite (v1.2+) or JSON files (v1.1.x) — SQLite preferred when present
2. **Project Scoping**: Uses git root commit hash to scope searches to current repository
3. **Indexing**: For fuzzy search, builds a searchable index of all content
4. **Matching**: Applies chosen search algorithm (keyword, regex, or fuzzy)
5. **Sorting**: Returns results sorted by timestamp (newest first)

## Storage Structure

### OpenCode v1.2+ (SQLite)

```
~/.local/share/opencode/opencode.db
```

### OpenCode v1.1.x (Legacy JSON)

```
~/.local/share/opencode/storage/
├── session/{projectID}/ses_*.json
├── message/{sessionID}/msg_*.json
└── part/{messageID}/part_*.json
```

SQLite is used when `opencode.db` is present, otherwise falls back to JSON files.

## Development

```bash
# Run unit tests
bun run test

# Run integration tests (requires real OpenCode data)
bun run test:integration

# Build
bun run build
```

### Project Structure

```
src/
├── index.ts                  # Tool definition & main entry
├── storage.ts                # JSON storage backend (v1.1.x)
├── storage-sqlite.ts         # SQLite storage backend (v1.2+)
├── storage-provider.ts       # Auto-detects backend, unified API
└── search/
    ├── keyword.ts            # Keyword & regex search
    ├── fuzzy.ts              # Fuzzy search
    └── date-filter.ts        # Date filtering
```

## License

MIT

## Acknowledgments

- Built for [OpenCode](https://opencode.ai)
- Uses [Fuse.js](https://fusejs.io/) for fuzzy search
- Powered by [Bun](https://bun.sh)
