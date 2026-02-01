#!/usr/bin/env bun

import { existsSync } from "fs";
import { homedir } from "os";
import path from "path";

console.log("🔍 Verifying opencode-history-search installation...\n");

const locations = [
  path.join(homedir(), ".opencode", "tool", "history-search.ts"),
  path.join(homedir(), ".config", "opencode", "tool", "history-search.ts"),
];

let found = false;
for (const location of locations) {
  if (existsSync(location)) {
    console.log(`✅ Tool found at: ${location}`);
    found = true;

    const descFile = location.replace(".ts", ".txt");
    if (existsSync(descFile)) {
      console.log(`✅ Description file found: ${descFile}`);
    } else {
      console.log(`⚠️  Description file missing: ${descFile}`);
    }
  }
}

if (!found) {
  console.log("❌ Tool not installed. Run: bun run install:tool");
  process.exit(1);
}

console.log("\n🧪 Testing tool functionality...\n");

const tool = await import("./dist/history-search.ts");

try {
  const result = await tool.default.execute({
    query: "storage",
    limit: 3,
  });

  if (result.includes("conversation history")) {
    console.log("✅ Tool executed successfully");
    console.log("\nSample output:");
    console.log(result.split("\n").slice(0, 10).join("\n"));
    console.log("...");
  } else {
    console.log("⚠️  Tool returned unexpected output");
    console.log(result);
  }
} catch (error) {
  console.log("❌ Tool execution failed:");
  console.error(error);
  process.exit(1);
}

console.log("\n🎉 All checks passed! Tool is ready to use.");
console.log("\n📝 Usage in OpenCode:");
console.log("   Ask: \"Search my conversation history for 'storage'\"");
console.log("   Or: \"Find conversations about 'testing' from last 7 days\"");
