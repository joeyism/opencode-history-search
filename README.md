# opencode-history-search

[![npm version](https://img.shields.io/npm/v/opencode-history-search.svg)](https://www.npmjs.com/package/opencode-history-search)
[![npm downloads](https://img.shields.io/npm/dm/opencode-history-search.svg)](https://www.npmjs.com/package/opencode-history-search)
[![Tests](https://github.com/joeyism/opencode-history-search/workflows/Tests/badge.svg)](https://github.com/joeyism/opencode-history-search/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Search through your OpenCode conversation history across ALL projects or within the current repository. Supports keyword, regex, fuzzy, and global search.

<video src="https://github.com/user-attachments/assets/f492da67-3f54-4989-abb3-2d40c3a8fe7c" autoplay loop muted playsinline width="100%"></video>

## Features

- **Keyword Search** - Find exact matches in your conversation history
- **Regex Search** - Use regular expressions for advanced pattern matching
- **Fuzzy Search** - Typo-tolerant search that finds matches even with spelling errors
- **Date Filtering** - Filter by "today", "last 7 days", "2024-01", date ranges, and more
- **Role Filtering** - Search only your messages (`user`) or only AI responses (`assistant`)
- **File Modification Tracking** - Find which sessions modified specific files
- **Multiple Match Types** - Search across session titles, messages, tool invocations, and file paths
- **Global Search** - Search across ALL projects on your machine with `searchAllProjects: true`
- **Project-Aware Results** - See which project directory each result came from
- **Fast** - SQLite FTS5 full-text index. Sub-50ms on small histories, sub-100ms on most queries even at hundreds of thousands of parts. See [Performance](#performance) for benchmark details.
- **SQLite + JSON Support** - Works with OpenCode v1.2+ (SQLite) and v1.1.x (JSON files)

## Installation

### OpenCode Config (Recommended)

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

### Find something you worked on but forgot which project

> "Search across all my projects for conversations about auth code"

> "Find sessions globally where you wrote a database migration"

> "Which project did we discuss the rate limiting implementation?"

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
| `searchAllProjects` | boolean                   | `false`     | Search ALL projects on this machine (set to `true` for global search) |
| `query`          | string                    | _required_  | Search query (keyword, regex, or fuzzy term)           |
| `mode`           | `"keyword"` \| `"fuzzy"`  | `"keyword"` | Search mode                                            |
| `regex`          | boolean                   | `false`     | Treat query as regex (keyword mode only)               |
| `caseSensitive`  | boolean                   | `false`     | Enable case-sensitive search (keyword mode only)       |
| `fuzzyThreshold` | number                    | `0.4`       | Fuzzy match strictness 0.0-1.0. Only applies to the JSON-storage backend (Fuse.js). Ignored on SQLite, which uses an FTS5 trigram index with its own match semantics. |
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

Tolerates typos and substrings. On SQLite (v1.2+) this uses an FTS5 trigram
index, so it stays fast as your history grows. The legacy JSON backend uses
Fuse.js Levenshtein matching.

```typescript
{ query: "storag", mode: "fuzzy" }
// Finds: "storage" (missing letter)

{ query: "authent", mode: "fuzzy" }
// Finds: "authentication" (substring)
```

Trigram matching catches most typos and partial words. It's stricter than
Levenshtein on transpositions (e.g. `"ripgrap"` won't always reach
`"ripgrep"`). When in doubt, try keyword search first; it's faster and more
predictable.

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
- Project: /home/user/projects/my-app
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

| Type        | What it matches                                                            |
| ----------- | -------------------------------------------------------------------------- |
| `title`     | Session title                                                              |
| `message`   | Text content of a user or assistant message                                |
| `tool`      | Tool name, title, or content of the tool's input/output (e.g. arguments)   |
| `filepath`  | File paths in patch parts (`write`/`edit` operations)                      |

## How It Works

1. **Storage**: Auto-detects SQLite (v1.2+) or JSON files (v1.1.x). SQLite is preferred when present.
2. **Project Scoping**: By default, scopes searches to current repository via git root commit hash. Set `searchAllProjects: true` to search across all projects.
3. **Indexing**: On first run against a SQLite DB, the plugin builds an FTS5 full-text index over part content (text, tool names + state, patch file paths). Triggers keep the index in sync as OpenCode writes new messages. See [FTS5 Index](#fts5-index) below.
4. **Matching**: Applies chosen search algorithm. Keyword and fuzzy modes use the FTS5 index. Regex mode falls back to a row scan.
5. **Sorting**: Returns results sorted by timestamp (newest first).

## Performance

Real-world benchmark against a 3.9 GB OpenCode DB (932 sessions, 63,640 messages, 209,505 parts):

| Query                        | Project-scoped | Global  |
| ---------------------------- | -------------: | ------: |
| `storage` (common term)      |           60ms |    60ms |
| `kubernetes` (rare term)     |           29ms |    29ms |
| `webhook` (rare term)        |           39ms |    38ms |
| `authentication`             |           39ms |    43ms |
| `the` (worst-case common)    |          378ms |   360ms |
| `the` + `last 7 days` filter |              — |   273ms |
| `the` + `role=user` filter   |              — |    76ms |
| `storag` fuzzy (typo)        |           30ms |    29ms |
| `authent` fuzzy (substring)  |           39ms |    38ms |

For comparison, the same queries before the FTS5 index took 1-13+ seconds for keyword search and 15+ seconds for fuzzy. The biggest wins are on rare-term, fuzzy, and global searches, which previously had to scan every part row in the DB.

## FTS5 Index

When the plugin first runs against a SQLite DB, it adds the following to OpenCode's `opencode.db`:

- **`part_fts`** — FTS5 virtual table with the default `unicode61` tokenizer (plus its FTS5 shadow tables: `part_fts_data`, `part_fts_idx`, `part_fts_content`, `part_fts_docsize`, `part_fts_config`). Powers keyword search. One row per searchable piece of part content: message text, tool name + title, tool input/output blob, and one row per file path in a patch.
- **`part_fts_tri`** — FTS5 virtual table with the `trigram` tokenizer (plus shadow tables). Powers fuzzy and substring search. Indexes only `text` and `tool_name` kinds (tool_state and patch_file aren't useful for fuzzy matching).
- **`part_fts_meta`** — A two-row table tracking the FTS schema version and the highest indexed `part.rowid`. Used to detect when an incremental backfill is needed.
- **Three `AFTER` triggers on `part`** (`part_fts_ai`, `part_fts_au`, `part_fts_ad`) that mirror inserts, updates, and deletes into both FTS tables.

**The plugin never reads or writes rows in OpenCode-owned tables.** It only adds the auxiliary tables and triggers above.

**Storage overhead:** roughly 12-15% of total DB size on a typical install (the unicode61 index is ~10%, the trigram index adds another ~3%). On a 3.9 GB DB, the combined indexes plus shadow tables consume about 550 MB. The index grows proportionally to OpenCode's message volume.

**Index build:** On first run the plugin builds both indexes in a single transaction. On a 200k-part DB this takes about 10-15 seconds with no concurrent writers, up to ~30 seconds if OpenCode is actively writing to the DB at the same time. The log message `[history-search] Built FTS5 search index in Nms (one-time setup, see README "Rollback" to remove).` confirms when this happens.

**Schema drift defense:** On every search the plugin samples the most recent text, tool, and patch row from `part` and verifies the JSON keys it depends on (`$.text`, `$.tool`, `$.files`) still exist. If OpenCode ever renames these keys in a future release, the plugin logs a warning and forces a rebuild. The rebuild itself won't fix the drift — you'd need a plugin update — but you'll see the warning instead of silently degraded search.

**Trigger safety:** The triggers cannot abort an OpenCode write. Every `json_extract` is guarded by `json_valid(NEW.data)`, and the `json_each` over `$.files` is wrapped in a `CASE WHEN json_type(...,'$.files')='array'` check. A future OpenCode bug that writes non-JSON or non-array data to `part.data` will be silently skipped by the trigger instead of crashing the host INSERT. Verified by tests.

### Rollback

If you uninstall the plugin and want to remove the FTS index and triggers:

```sql
-- Safe to run while OpenCode is running.
-- BEGIN IMMEDIATE waits politely for any in-flight writer.
PRAGMA busy_timeout = 15000;
BEGIN IMMEDIATE;
  -- Drop triggers FIRST so no in-flight INSERT/UPDATE/DELETE
  -- writes to a table that's about to disappear.
  DROP TRIGGER IF EXISTS part_fts_ai;
  DROP TRIGGER IF EXISTS part_fts_au;
  DROP TRIGGER IF EXISTS part_fts_ad;
  -- Drop the virtual tables (cascades the FTS5 shadow tables).
  DROP TABLE IF EXISTS part_fts;
  DROP TABLE IF EXISTS part_fts_tri;
  DROP TABLE IF EXISTS part_fts_meta;
COMMIT;

-- Optional: reclaim ~550 MB on a 3.9 GB DB. Slow (single-threaded,
-- rewrites the entire DB) and takes an EXCLUSIVE lock. Only run
-- while OpenCode is stopped.
-- VACUUM;
```

OpenCode never sees that the plugin was there.

### Verification

After the plugin has run at least once, you can confirm the index is healthy with:

```sql
-- 1) Both FTS tables and meta table exist
SELECT name FROM sqlite_master
WHERE type='table' AND name IN ('part_fts','part_fts_tri','part_fts_meta');
-- expect: part_fts, part_fts_meta, part_fts_tri

-- 2) All three triggers installed
SELECT name FROM sqlite_master
WHERE type='trigger' AND name LIKE 'part_fts_%'
ORDER BY name;
-- expect: part_fts_ad, part_fts_ai, part_fts_au

-- 3) Schema version and watermark
SELECT key, value FROM part_fts_meta;
-- expect a `version` row and a `last_rowid` row

-- 4) Index covers most of `part`. The watermark vs MAX(rowid)
--    gap will close on the next ensureFts() call.
SELECT
  (SELECT value FROM part_fts_meta WHERE key='last_rowid') AS watermark,
  (SELECT MAX(rowid)              FROM part)               AS max_rowid;

-- 5) FTS5 internal integrity check on both indexes (no output = healthy).
INSERT INTO part_fts(part_fts) VALUES('integrity-check');
INSERT INTO part_fts_tri(part_fts_tri) VALUES('integrity-check');

-- 6) Quick functional smoke tests (keyword + fuzzy substring).
SELECT COUNT(*) FROM part_fts     WHERE content MATCH '"the"';
SELECT COUNT(*) FROM part_fts_tri WHERE content MATCH '"the"';
```

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
├── format.ts                 # Output formatting
├── storage.ts                # JSON storage backend (v1.1.x)
├── storage-sqlite.ts         # SQLite storage backend (v1.2+) + shared sync helpers
├── storage-provider.ts       # Auto-detects backend, unified API, ensureFtsOnce()
└── search/
    ├── fts.ts                # FTS5 index, triggers, watermark, drift defense
    ├── keyword.ts            # Keyword & regex search (uses FTS5 when available)
    ├── fuzzy.ts              # Fuzzy search
    ├── file-trace.ts         # File modification tracking
    └── date-filter.ts        # Date filtering
```

## License

MIT

## Acknowledgments

- Built for [OpenCode](https://opencode.ai)
- Uses SQLite [FTS5](https://www.sqlite.org/fts5.html) (unicode61 + trigram tokenizers) for keyword and fuzzy search on SQLite-backed installs
- Uses [Fuse.js](https://fusejs.io/) for fuzzy search on the legacy JSON storage backend
- Powered by [Bun](https://bun.sh)
