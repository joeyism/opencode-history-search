# Using opencode-history-search in OpenCode

This guide explains how to install and use the opencode-history-search tool within OpenCode.

## Installation

### Method 1: Quick Install with npx/bunx (Recommended)

The easiest way to install:

```bash
# Using npx (npm)
npx opencode-history-search

# Or using bunx (bun)
bunx opencode-history-search

# Or directly from GitHub
bunx github:yourusername/opencode-history-search
```

The installer automatically:

- Copies the tool to `~/.opencode/tool/history-search.ts`
- Creates the description file at `~/.opencode/tool/history-search.txt`
- Shows you usage examples

Then just restart OpenCode and you're ready!

### Method 2: Manual Installation

1. **Clone or copy the repository:**

   ```bash
   cd /path/to/your/projects
   git clone https://github.com/yourusername/opencode-history-search.git
   cd opencode-history-search
   ```

2. **Install dependencies:**

   ```bash
   bun install
   ```

3. **Build the tool:**

   ```bash
   bun run build
   ```

4. **Copy to OpenCode tools directory:**

   ```bash
   # Copy the bundled tool
   cp dist/history-search.ts ~/.opencode/tool/history-search.ts

   # Create description file (helps AI understand what the tool does)
   cp .opencode/tool-description.txt ~/.opencode/tool/history-search.txt
   ```

   Or if the description file doesn't exist yet:

   ```bash
   cat > ~/.opencode/tool/history-search.txt << 'EOF'
   Search through past conversation histories in the current repository.

   Searches:
   - Session titles
   - Message content (user and assistant messages)
   - Tool invocations (grep, edit, bash, read, etc.)
   - File paths mentioned or edited

   Features:
   - Keyword search (exact matches)
   - Regex search (advanced patterns)
   - Fuzzy search (typo-tolerant matching)
   - Case-sensitive option
   - Configurable result limit (default: 50)
   - Fuzzy threshold control (strictness)
   - Results sorted by most recent first

   Examples:
   - "Search my history for 'ripgrep'"
   - "Search history for 'storage.*\.ts' with regex"
   - "Search history for 'storag' using fuzzy mode" (finds "storage")
   - "Find conversations about authentication"
   - "Search for 'grap' with fuzzy search" (finds "grep")
   EOF
   ```

5. **Restart OpenCode** or reload tools

### Method 3: Let OpenCode Install It

The easiest way! Just ask your OpenCode AI agent to install it:

**Simple approach**:

```
Install the opencode-history-search tool
```

**From local repository**:

```
Install the history search tool from ~/Programming/node/opencode-history-search
```

**Detailed request**:

```
Please install the opencode-history-search tool:
1. Go to ~/Programming/node/opencode-history-search
2. Run bun install
3. Run bun run build
4. Run bun run install:tool
5. Verify it works
```

The AI will handle the entire installation process for you. Once it confirms installation, restart OpenCode and you're ready!

## Verification

To verify the tool is installed correctly:

1. Start OpenCode in any project
2. Ask the AI: "Do you have a history search tool?"
3. The AI should confirm it has access to the history-search tool

## Usage Examples

### Basic Keyword Search

```
You: Search my conversation history for "storage"
```

The AI will use the tool and return matches like:

```
Found 5 matches in conversation history:

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
```

### Fuzzy Search (Typo-Tolerant)

```
You: Search for "storag" with fuzzy mode
```

This will find "storage" matches even though the query has a typo (missing 'e').

```
You: Find conversations where I mentioned "grap" using fuzzy search
```

This will find "grep" matches despite the typo.

### Regex Search

```
You: Search history for "storage.*\.ts" with regex
```

This will find matches like:

- `storage.ts`
- `storage.service.ts`
- `storage.test.ts`

### Case-Sensitive Search

```
You: Search for "Storage" case-sensitively
```

This will only match "Storage" (capitalized), not "storage" or "STORAGE".

### Limit Results

```
You: Search history for "the" but limit to 5 results
```

Returns only the 5 most recent matches.

### Advanced Queries

```
You: Search my history for conversations about authentication using fuzzy search

You: Find all times I used the grep tool

You: Search for files with "component" in the path

You: Look through my history for discussions about testing
```

## How It Works

### Storage Location

OpenCode stores conversation history in:

```
~/.local/share/opencode/storage/
├── session/{projectID}/ses_*.json   # Session metadata
├── message/{sessionID}/msg_*.json   # Messages
└── part/{messageID}/part_*.json     # Message parts
```

### Project Scoping

The tool automatically scopes searches to your current repository using the git root commit hash. This means:

- When you're in project A, you only search project A's history
- When you're in project B, you only search project B's history
- Conversations are isolated by project

### Match Types

The tool searches across:

1. **Session titles** - "Fix storage bug", "Implement auth", etc.
2. **Message content** - Your questions and AI's responses
3. **Tool invocations** - grep, edit, bash, read commands used
4. **File paths** - Files mentioned or edited in conversations

## Parameters Reference

When the AI uses the tool, it can specify:

| Parameter        | Description      | Default     | Example     |
| ---------------- | ---------------- | ----------- | ----------- |
| `query`          | Search term      | _required_  | `"storage"` |
| `mode`           | Search mode      | `"keyword"` | `"fuzzy"`   |
| `regex`          | Use regex        | `false`     | `true`      |
| `caseSensitive`  | Case sensitive   | `false`     | `true`      |
| `fuzzyThreshold` | Fuzzy strictness | `0.4`       | `0.3`       |
| `limit`          | Max results      | `50`        | `10`        |

## Common Use Cases

### Finding Past Solutions

```
You: I remember we fixed a similar bug before. Search history for "null pointer"
```

### Reviewing Tool Usage

```
You: Show me all times we used the bash tool
```

### Finding File References

```
You: Search for conversations where we edited config.ts
```

### Exploring Topics

```
You: Find all conversations about testing using fuzzy search
```

### Quick Recalls

```
You: What did we discuss about authentication?
```

## Troubleshooting

### Tool Not Found

If OpenCode says it doesn't have the tool:

1. Check installation:

   ```bash
   ls -la ~/.opencode/tool/history-search.ts
   ```

2. Verify the file is valid:

   ```bash
   bun check ~/.opencode/tool/history-search.ts
   ```

3. Restart OpenCode

### No Results Found

If searches return no results:

1. Verify you're in the correct project directory
2. Check that you have conversation history in this project
3. Try a broader search term
4. Use fuzzy mode for typo tolerance

### Slow Performance

If searches are slow:

1. Reduce the limit parameter
2. Use more specific search terms
3. The tool is optimized and should be fast (<50ms), but very broad terms like "the" will take longer

## Updating the Tool

To update to a newer version:

```bash
cd /path/to/opencode-history-search
git pull
bun install
bun run build
cp dist/history-search.ts ~/.opencode/tool/history-search.ts
```

Restart OpenCode to use the new version.

## Tips for Best Results

1. **Be specific**: "storage module" is better than "storage"
2. **Use fuzzy for typos**: If you're not sure of exact spelling
3. **Use regex for patterns**: Great for file extensions or date patterns
4. **Limit results**: If you just want recent matches, use a small limit
5. **Try different terms**: If one search doesn't work, rephrase

## Integration with Workflows

The tool integrates naturally with OpenCode workflows:

```
You: Search for the last time we implemented authentication
AI: <uses history-search>
AI: I found 3 conversations about authentication. The most recent was...

You: Show me that implementation
AI: <references the found session and provides details>
```

## Privacy Note

The tool only searches conversations in the current project and only on your local machine. No data is sent anywhere.
