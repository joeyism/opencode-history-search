import { test, expect, describe } from "bun:test";
import historySearch from "./index";
import { runSearchInProcess } from "./search-process";

describe("historySearch tool", () => {
  test("exports a tool with a description", () => {
    expect(historySearch).toBeDefined();
    expect(typeof historySearch).toBe("object");
  });

  test("tool schema includes terms parameter for multi-term search", () => {
    const description = (historySearch as any).description ?? "";
    const args = (historySearch as any).args ?? {};
    expect(args).toHaveProperty("terms");
  });

  test("search process does not block the calling event loop", async () => {
    const startedAt = performance.now();
    const search = runSearchInProcess(
      { query: "400" },
      new URL("./test-fixtures/blocking-search-process.ts", import.meta.url),
    );

    await Bun.sleep(20);

    expect(performance.now() - startedAt).toBeLessThan(250);
    expect(await search).toBe("completed");
  });

  test("search process errors are returned to the caller", async () => {
    await expect((historySearch as any).execute({})).rejects.toThrow(
      "Either 'query', 'terms', or 'filePath' must be provided.",
    );
  });

  test("search process is terminated when a request cannot be encoded", async () => {
    await expect(
      runSearchInProcess(
        { query: 1n as unknown as string },
        new URL("./test-fixtures/blocking-search-process.ts", import.meta.url),
      ),
    ).rejects.toThrow();
  });

  test("aborting a search terminates its child process", async () => {
    const controller = new AbortController();
    const search = runSearchInProcess(
      { query: "10000" },
      new URL("./test-fixtures/blocking-search-process.ts", import.meta.url),
      controller.signal,
    );

    await Bun.sleep(20);
    controller.abort(new Error("Search cancelled"));

    await expect(search).rejects.toThrow("Search cancelled");
  });

  test("bundled tool executes through its child process", async () => {
    const bundleUrl = new URL("../dist/history-search.ts", import.meta.url).href;
    const bundled = await import(bundleUrl);
    const result = await (bundled.default as any).execute({
      query: "history-search",
      searchAllProjects: true,
      limit: 1,
    });

    expect(result).toContain("conversation history");
  });
});
