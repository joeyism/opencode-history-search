const result = await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  minify: false,
  splitting: false,
  external: ["@opencode-ai/plugin", "bun"],
  naming: {
    entry: "history-search.ts",
  },
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

const output = result.outputs[0];
if (!output) {
  console.error("Build failed: No outputs generated");
  process.exit(1);
}

console.log("✓ Bundled to dist/history-search.ts");
console.log(`  Size: ${(output.size / 1024).toFixed(1)} KB`);
