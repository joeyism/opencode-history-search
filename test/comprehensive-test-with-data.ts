#!/usr/bin/env bun

import { readFileSync } from "fs";

const bundledCode = readFileSync("./dist/history-search.ts", "utf8");

const modifiedCode = bundledCode.replace(
  "async function getCurrentProjectID()",
  `async function getCurrentProjectID() {
		return "4b0ea68d7af9a6031a7ffda7ad66e0cb83315750"
	}
	async function getCurrentProjectID_original()`,
);

const tempFile = Bun.file("/tmp/history-search-test.ts");
await Bun.write(tempFile, modifiedCode);

const tool = (await import("/tmp/history-search-test.ts")).default;

const TESTS_PASSED: string[] = [];
const TESTS_FAILED: string[] = [];

function countMatches(result: string): number {
  return result.split("\n").filter((line) => line.startsWith("## ")).length;
}

function assert(condition: boolean, message: string) {
  if (condition) {
    TESTS_PASSED.push(message);
    console.log(`✅ ${message}`);
  } else {
    TESTS_FAILED.push(message);
    console.error(`❌ ${message}`);
  }
}

console.log("=".repeat(70));
console.log("COMPREHENSIVE TEST SUITE - With Real OpenCode Data");
console.log("=".repeat(70));
console.log();

console.log("TEST 1: Tool Structure Validation");
console.log("-".repeat(70));
assert(typeof tool === "object", "Tool is an object");
assert(typeof tool.description === "string", "Tool has description string");
assert(typeof tool.args === "object", "Tool has args object");
assert(typeof tool.execute === "function", "Tool has execute function");
console.log();

console.log("TEST 2: Keyword Search - Should Find Real Data");
console.log("-".repeat(70));
const keywordResult = await tool.execute({ query: "storage", limit: 5 });
const keywordCount = countMatches(keywordResult);
console.log(`   Found ${keywordCount} matches for "storage"`);
assert(keywordCount > 0, "Keyword search finds actual matches in history");
assert(
  keywordResult.includes("Session ID:"),
  "Result contains session information",
);
console.log();

console.log("TEST 3: Fuzzy Search - Should Find Real Data");
console.log("-".repeat(70));
const fuzzyResult = await tool.execute({
  query: "storage",
  mode: "fuzzy",
  limit: 5,
});
const fuzzyCount = countMatches(fuzzyResult);
console.log(`   Found ${fuzzyCount} matches for "storage" (fuzzy)`);
assert(fuzzyCount > 0, "Fuzzy search finds actual matches");
console.log();

console.log("TEST 4: Fuzzy Search - Typo Tolerance (Critical Test)");
console.log("-".repeat(70));
const typoResult = await tool.execute({
  query: "storag",
  mode: "fuzzy",
  fuzzyThreshold: 0.3,
  limit: 5,
});
const typoCount = countMatches(typoResult);
console.log(`   Found ${typoCount} matches for "storag" (missing 'e')`);
assert(typoCount > 0, "Fuzzy search finds matches even with typo");

const correctResult = await tool.execute({
  query: "storage",
  mode: "fuzzy",
  fuzzyThreshold: 0.3,
  limit: 5,
});
const correctCount = countMatches(correctResult);
console.log(
  `   Found ${correctCount} matches for "storage" (correct spelling)`,
);
assert(
  Math.abs(typoCount - correctCount) <= 2,
  "Typo and correct queries return similar results",
);
console.log();

console.log("TEST 5: Keyword vs Fuzzy Comparison");
console.log("-".repeat(70));
const keywordNonexistent = await tool.execute({ query: "ripgrap", limit: 5 });
const fuzzyNonexistent = await tool.execute({
  query: "ripgrap",
  mode: "fuzzy",
  fuzzyThreshold: 0.4,
  limit: 5,
});
const keywordNonCount = countMatches(keywordNonexistent);
const fuzzyNonCount = countMatches(fuzzyNonexistent);

console.log(`   Keyword "ripgrap" (likely typo): ${keywordNonCount} matches`);
console.log(
  `   Fuzzy "ripgrap" (should find "ripgrep"): ${fuzzyNonCount} matches`,
);
assert(
  fuzzyNonCount >= keywordNonCount,
  "Fuzzy is more tolerant than keyword for unlikely typos",
);
console.log();

console.log("TEST 6: Output Format with Real Data");
console.log("-".repeat(70));
const formatResult = await tool.execute({ query: "storage", limit: 1 });
console.log("   Sample output:");
const lines = formatResult.split("\n").slice(0, 8);
for (const line of lines) {
  console.log(`   ${line}`);
}
assert(formatResult.includes("## "), "Output has session title headers");
assert(formatResult.includes("Session ID: ses_"), "Output has session IDs");
assert(formatResult.includes("Date: "), "Output has dates");
assert(formatResult.includes("Match Type: "), "Output has match types");
assert(formatResult.includes("Excerpt: "), "Output has excerpts");
console.log();

console.log("TEST 7: Case Insensitive Search");
console.log("-".repeat(70));
const lowerResult = await tool.execute({ query: "storage", limit: 5 });
const upperResult = await tool.execute({ query: "STORAGE", limit: 5 });
const lowerCount = countMatches(lowerResult);
const upperCount = countMatches(upperResult);
console.log(`   "storage": ${lowerCount} matches`);
console.log(`   "STORAGE": ${upperCount} matches`);
assert(lowerCount === upperCount, "Case insensitive by default");
console.log();

console.log("TEST 8: Limit Parameter Works");
console.log("-".repeat(70));
const limit3 = await tool.execute({ query: "the", limit: 3 });
const limit10 = await tool.execute({ query: "the", limit: 10 });
const count3 = limit3
  .split("\n")
  .filter((line) => line.startsWith("## ")).length;
const count10 = limit10
  .split("\n")
  .filter((line) => line.startsWith("## ")).length;
console.log(`   Limit 3: ${count3} results`);
console.log(`   Limit 10: ${count10} results`);

assert(count3 <= 3, "Limit 3 respected");
assert(count10 <= 10, "Limit 10 respected");
assert(count10 >= count3, "Higher limit returns more results");
console.log();

console.log("TEST 9: Fuzzy Threshold Control");
console.log("-".repeat(70));
const strict = await tool.execute({
  query: "storag",
  mode: "fuzzy",
  fuzzyThreshold: 0.1,
  limit: 10,
});
const loose = await tool.execute({
  query: "storag",
  mode: "fuzzy",
  fuzzyThreshold: 0.6,
  limit: 10,
});
const strictCount = countMatches(strict);
const looseCount = countMatches(loose);
console.log(`   Strict (0.1): ${strictCount} matches`);
console.log(`   Loose (0.6): ${looseCount} matches`);
assert(looseCount >= strictCount, "Looser threshold returns more matches");
console.log();

console.log("TEST 10: Performance with Real Data");
console.log("-".repeat(70));
const perfTests = [
  { query: "storage", mode: undefined, name: "keyword" },
  { query: "storage", mode: "fuzzy", name: "fuzzy" },
  { query: "session", mode: undefined, name: "keyword" },
];

for (const test of perfTests) {
  const start = performance.now();
  await tool.execute({ ...test, limit: 50 });
  const elapsed = performance.now() - start;
  console.log(`   ${test.name} "${test.query}": ${elapsed.toFixed(2)}ms`);
  assert(elapsed < 5000, `${test.name} completes in < 5s`);
}
console.log();

console.log("TEST 11: Multiple Match Types");
console.log("-".repeat(70));
const multiResult = await tool.execute({ query: "grep", limit: 10 });
const hasTitle = multiResult.includes("Match Type: title");
const hasMessage = multiResult.includes("Match Type: message");
const hasTool = multiResult.includes("Match Type: tool");
console.log(`   Has title matches: ${hasTitle}`);
console.log(`   Has message matches: ${hasMessage}`);
console.log(`   Has tool matches: ${hasTool}`);
assert(hasMessage || hasTool || hasTitle, "Finds at least one type of match");
console.log();

console.log("=".repeat(70));
console.log("TEST SUMMARY");
console.log("=".repeat(70));
console.log(`✅ Passed: ${TESTS_PASSED.length}`);
console.log(`❌ Failed: ${TESTS_FAILED.length}`);
console.log();

if (TESTS_FAILED.length > 0) {
  console.log("Failed tests:");
  for (const test of TESTS_FAILED) {
    console.log(`  - ${test}`);
  }
  console.log();
  process.exit(1);
} else {
  console.log("🎉 ALL TESTS PASSED! Tool is production-ready.");
  console.log();
  process.exit(0);
}
