interface SearchRequest {
  type: "search";
  args: { query?: string };
}

const request = JSON.parse(await Bun.stdin.text()) as SearchRequest;
const blockForMs = Number(request.args.query);
const end = performance.now() + blockForMs;

while (performance.now() < end) {
  // Simulate a synchronous search over a large history database.
}

await Bun.write(
  Bun.stdout,
  JSON.stringify({ type: "result", value: "completed" }),
);
