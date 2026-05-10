#!/usr/bin/env bun

import { existsSync, mkdirSync, copyFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const TOOL_DESCRIPTION = `Search through past conversation histories.

Parameters:
- query: Search term (keyword, regex, or fuzzy). Required unless filePath provided.
- searchAllProjects: boolean — set to true to search ALL projects on this machine. Default: false (current repo only).
- filePath: Trace which sessions modified a specific file path.
- mode: "keyword" (default) or "fuzzy" search.
- regex: Treat query as regex pattern (keyword mode only).
- caseSensitive: Case-sensitive search (keyword mode only).
- fuzzyThreshold: Fuzzy match strictness 0.0-1.0 (default 0.4).
- date: Filter by date (e.g., "today", "last 7 days", "YYYY-MM-DD", "YYYY-MM-DD to YYYY-MM-DD").
- limit: Maximum number of results (default: 50).
- role: Filter by "user" or "assistant" messages.

Searches:
- Session titles
- Message content (user and assistant messages)
- Tool invocations (grep, edit, bash, read, etc.)
- File paths mentioned or edited
- Files modified in patch parts (find which sessions changed a file)

Examples:
- "Search across all my projects for auth code" (uses searchAllProjects: true)
- "Search my history for 'storage' in this repo" (uses searchAllProjects: false, default)
- "Search for 'storag' using fuzzy mode" (uses mode: "fuzzy")
- "Find conversations about authentication globally" (uses searchAllProjects: true)
- "Which sessions modified src/storage.ts?" (uses filePath)

Works with OpenCode v1.2+ (SQLite) and v1.1.x (JSON files).`;

function getOpenCodeToolDir(): string {
  const home = homedir();

  const possiblePaths = [
    join(home, ".opencode", "tool"),
    join(home, ".config", "opencode", "tool"),
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  const defaultPath = join(home, ".opencode", "tool");
  console.log(`📁 Creating OpenCode tool directory: ${defaultPath}`);
  mkdirSync(defaultPath, { recursive: true });
  return defaultPath;
}

function install() {
  console.log("🔍 OpenCode History Search Installer\n");

  try {
    const toolDir = getOpenCodeToolDir();
    const scriptDir = import.meta.dir;

    const sourcePath = join(scriptDir, "dist", "history-search.ts");
    const targetPath = join(toolDir, "history-search.ts");
    const descPath = join(toolDir, "history-search.txt");

    if (!existsSync(sourcePath)) {
      console.error("❌ Error: dist/history-search.ts not found");
      console.error("   Please run: bun run build");
      process.exit(1);
    }

    console.log(`📦 Installing to: ${toolDir}`);

    copyFileSync(sourcePath, targetPath);
    console.log("✅ Copied history-search.ts");

    writeFileSync(descPath, TOOL_DESCRIPTION);
    console.log("✅ Created history-search.txt (tool description)");

    console.log("\n🎉 Installation complete!");
    console.log("\n📝 Usage:");
    console.log(
      "   Ask OpenCode: \"Search my conversation history for 'storage'\"",
    );
    console.log("   Or: \"Search for 'storag' using fuzzy mode\"");
    console.log("\n💡 Restart OpenCode if it's currently running");
  } catch (error) {
    console.error("\n❌ Installation failed:", error);
    process.exit(1);
  }
}

install();
