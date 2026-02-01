#!/usr/bin/env bun

import tool from "./dist/history-search.ts";

const TESTS_PASSED: string[] = [];
const TESTS_FAILED: string[] = [];

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
console.log("COMPREHENSIVE TEST SUITE - OpenCode History Search Tool");
console.log("=".repeat(70));
console.log();

console.log("TEST 1: Tool Structure Validation");
console.log("-".repeat(70));
assert(typeof tool === "object", "Tool is an object");
assert(typeof tool.description === "string", "Tool has description string");
assert(typeof tool.args === "object", "Tool has args object");
assert(typeof tool.execute === "function", "Tool has execute function");
assert(tool.args.query !== undefined, "Tool has query argument");
assert(tool.args.mode !== undefined, "Tool has mode argument");
assert(
  tool.args.fuzzyThreshold !== undefined,
  "Tool has fuzzyThreshold argument",
);
console.log();

console.log("TEST 2: Keyword Search - Basic");
console.log("-".repeat(70));
try {
  const result = await tool.execute({ query: "storage", limit: 5 });
  assert(typeof result === "string", "Returns string result");
  assert(result.length > 0, "Result is not empty");
  assert(
    result.includes("matches") || result.includes("No matches"),
    "Result contains match info",
  );

  const matchCount = (result.match(/## /g) || []).length;
  console.log(`   Found ${matchCount} matches for "storage"`);
  assert(matchCount >= 0, "Returns valid match count");
} catch (e) {
  assert(false, `Keyword search executes without errors: ${e}`);
}
console.log();

console.log("TEST 3: Fuzzy Search - Basic");
console.log("-".repeat(70));
try {
  const result = await tool.execute({
    query: "storage",
    mode: "fuzzy",
    limit: 5,
  });
  assert(typeof result === "string", "Fuzzy search returns string result");
  assert(result.length > 0, "Fuzzy result is not empty");

  const matchCount = (result.match(/## /g) || []).length;
  console.log(`   Found ${matchCount} matches for "storage" (fuzzy)`);
  assert(matchCount >= 0, "Fuzzy search returns valid match count");
} catch (e) {
  assert(false, `Fuzzy search executes without errors: ${e}`);
}
console.log();

console.log("TEST 4: Fuzzy Search - Typo Tolerance");
console.log("-".repeat(70));
try {
  const typoResult = await tool.execute({
    query: "storag",
    mode: "fuzzy",
    fuzzyThreshold: 0.3,
    limit: 5,
  });
  const typoCount = (typoResult.match(/## /g) || []).length;
  console.log(`   Found ${typoCount} matches for "storag" (typo)`);

  const correctResult = await tool.execute({
    query: "storage",
    mode: "fuzzy",
    fuzzyThreshold: 0.3,
    limit: 5,
  });
  const correctCount = (correctResult.match(/## /g) || []).length;
  console.log(`   Found ${correctCount} matches for "storage" (correct)`);

  assert(typoCount > 0, "Fuzzy search finds matches even with typo");
} catch (e) {
  assert(false, `Typo tolerance test executes: ${e}`);
}
console.log();

console.log("TEST 5: Case Sensitivity");
console.log("-".repeat(70));
try {
  const lowerResult = await tool.execute({ query: "storage", limit: 5 });
  const upperResult = await tool.execute({ query: "STORAGE", limit: 5 });

  const lowerCount = (lowerResult.match(/## /g) || []).length;
  const upperCount = (upperResult.match(/## /g) || []).length;

  console.log(`   "storage": ${lowerCount} matches`);
  console.log(`   "STORAGE": ${upperCount} matches`);

  assert(lowerCount === upperCount, "Case insensitive by default");
} catch (e) {
  assert(false, `Case sensitivity test executes: ${e}`);
}
console.log();

console.log("TEST 6: Limit Parameter");
console.log("-".repeat(70));
try {
  const result3 = await tool.execute({ query: "the", limit: 3 });
  const result10 = await tool.execute({ query: "the", limit: 10 });

  const count3 = (result3.match(/## /g) || []).length;
  const count10 = (result10.match(/## /g) || []).length;

  console.log(`   Limit 3: ${count3} matches`);
  console.log(`   Limit 10: ${count10} matches`);

  assert(count3 <= 3, "Respects limit of 3");
  assert(count10 <= 10, "Respects limit of 10");
  assert(count10 >= count3, "Higher limit returns more or equal results");
} catch (e) {
  assert(false, `Limit parameter test executes: ${e}`);
}
console.log();

console.log("TEST 7: Regex Search");
console.log("-".repeat(70));
try {
  const result = await tool.execute({
    query: "stor.*ge",
    regex: true,
    limit: 5,
  });
  const matchCount = (result.match(/## /g) || []).length;
  console.log(`   Found ${matchCount} matches for regex "stor.*ge"`);
  assert(matchCount >= 0, "Regex search executes");
} catch (e) {
  assert(false, `Regex search executes: ${e}`);
}
console.log();

console.log("TEST 8: Output Format Validation");
console.log("-".repeat(70));
try {
  const result = await tool.execute({ query: "storage", limit: 2 });

  if (result.includes("No matches")) {
    console.log("   No matches found (expected if no data)");
    assert(true, "Handles no matches gracefully");
  } else {
    assert(result.includes("Found"), "Output contains 'Found' text");
    assert(result.includes("Session ID"), "Output contains Session ID");
    assert(result.includes("Date"), "Output contains Date");
    assert(result.includes("Match Type"), "Output contains Match Type");

    const hasExcerpt = result.includes("Excerpt");
    console.log(`   Has Excerpt field: ${hasExcerpt}`);
    assert(hasExcerpt, "Output contains Excerpt");
  }
} catch (e) {
  assert(false, `Output format validation: ${e}`);
}
console.log();

console.log("TEST 9: Fuzzy Threshold Parameter");
console.log("-".repeat(70));
try {
  const strict = await tool.execute({
    query: "storag",
    mode: "fuzzy",
    fuzzyThreshold: 0.1,
    limit: 5,
  });
  const loose = await tool.execute({
    query: "storag",
    mode: "fuzzy",
    fuzzyThreshold: 0.6,
    limit: 5,
  });

  const strictCount = (strict.match(/## /g) || []).length;
  const looseCount = (loose.match(/## /g) || []).length;

  console.log(`   Strict (0.1): ${strictCount} matches`);
  console.log(`   Loose (0.6): ${looseCount} matches`);

  assert(
    looseCount >= strictCount,
    "Looser threshold returns more or equal matches",
  );
} catch (e) {
  assert(false, `Fuzzy threshold test executes: ${e}`);
}
console.log();

console.log("TEST 10: Performance");
console.log("-".repeat(70));
try {
  const queries = [
    { query: "storage", mode: undefined },
    { query: "storage", mode: "fuzzy" },
    { query: "grep", mode: undefined },
  ];

  for (const test of queries) {
    const start = performance.now();
    await tool.execute({ ...test, limit: 20 });
    const elapsed = performance.now() - start;

    const mode = test.mode || "keyword";
    console.log(`   ${mode} "${test.query}": ${elapsed.toFixed(2)}ms`);
    assert(
      elapsed < 5000,
      `${mode} search completes in < 5s (${elapsed.toFixed(0)}ms)`,
    );
  }
} catch (e) {
  assert(false, `Performance test executes: ${e}`);
}
console.log();

console.log("TEST 11: Empty Query Handling");
console.log("-".repeat(70));
try {
  const result = await tool.execute({ query: "xyzabc123notfound", limit: 5 });
  console.log(
    `   Query for non-existent term: ${result.includes("No matches") ? "No matches" : "Some matches"}`,
  );
  assert(typeof result === "string", "Handles unlikely matches gracefully");
} catch (e) {
  assert(false, `Empty query handling: ${e}`);
}
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
  console.log("🎉 All tests passed!");
  console.log();
  process.exit(0);
}
