import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { Plugin } from "@opencode/plugin";
import type { Info, ToolContext, ToolEditor } from "@opencode/plugin/promise/tool";
import historySearch from "./index";
import * as keyword from "./search/keyword";
import * as fuzzy from "./search/fuzzy";
import * as multiterm from "./search/multiterm-sql";
import * as fileTrace from "./search/file-trace";

async function registerTool(projectID = "plugin-project"): Promise<Info> {
  let registered: Info | undefined;
  const context = {
    location: { project: { id: projectID } },
    tool: {
      async transform(transform: (editor: ToolEditor) => void) {
        transform({
          add(definition: Info) {
            registered = definition;
          },
        } as ToolEditor);
        return { async dispose() {} };
      },
    },
  } as unknown as Plugin.Context;

  await historySearch.setup(context);
  if (!registered) throw new Error("history-search was not registered");
  return registered;
}

const toolContext = {} as ToolContext;

afterEach(() => mock.restore());

describe("historySearch tool", () => {
  test("retains the legacy tool schema", () => {
    expect(historySearch.description).toContain("Search");
    expect(historySearch.args).toHaveProperty("terms");
  });

  test("exports a native OpenCode 2 plugin entrypoint", () => {
    expect(historySearch.id).toBe("opencode-history-search");
    expect(historySearch.setup).toBeFunction();
  });

  test("retains the OpenCode 1 server entrypoint", async () => {
    const search = spyOn(keyword, "searchKeyword").mockResolvedValue([]);
    const { tool } = await historySearch.server();
    const result = await tool["history-search"].execute(
      { query: "authentication", searchAllProjects: true },
      {} as Parameters<typeof historySearch.execute>[1],
    );
    expect(search).toHaveBeenCalledWith(null, "authentication", expect.any(Object));
    expect(result).toBe("No matches found in conversation history.");
  });
});

describe("OpenCode 2 registration", () => {
  test("registers history-search with a JSON Schema", async () => {
    const definition = await registerTool();
    expect(definition.name).toBe("history-search");
    expect(definition.input).toMatchObject({
      type: "object",
      properties: {
        query: { type: "string" },
        terms: { type: "array", items: { type: "string" } },
        searchAllProjects: { type: "boolean" },
      },
    });
  });

  test("uses the plugin project and returns structured text", async () => {
    const search = spyOn(keyword, "searchKeyword").mockResolvedValue([]);
    const definition = await registerTool("session-project");
    const result = await definition.execute(
      { query: "authentication", limit: 5, role: "user", regex: true },
      toolContext,
    );
    expect(search).toHaveBeenCalledWith("session-project", "authentication", {
      regex: true,
      caseSensitive: undefined,
      limit: 5,
      role: "user",
    });
    expect(result).toEqual({ content: "No matches found in conversation history." });
  });

  test("preserves global fuzzy search options", async () => {
    const search = spyOn(fuzzy, "searchFuzzy").mockResolvedValue([]);
    const definition = await registerTool();
    await definition.execute(
      { query: "authentcation", mode: "fuzzy", searchAllProjects: true, fuzzyThreshold: 0.2 },
      toolContext,
    );
    expect(search).toHaveBeenCalledWith(null, "authentcation", {
      threshold: 0.2,
      limit: undefined,
      role: undefined,
    });
  });

  test("preserves multi-term search", async () => {
    const search = spyOn(multiterm, "searchMultiterm").mockResolvedValue([]);
    const definition = await registerTool();
    const result = await definition.execute({ terms: ["auth", "database"] }, toolContext);
    expect(search).toHaveBeenCalledWith("plugin-project", ["auth", "database"], { limit: undefined });
    expect(typeof result.content).toBe("string");
  });

  test("preserves file tracing", async () => {
    const search = spyOn(fileTrace, "traceFile").mockResolvedValue([]);
    const definition = await registerTool();
    const result = await definition.execute({ filePath: "src/auth.ts", limit: 3 }, toolContext);
    expect(search).toHaveBeenCalledWith("plugin-project", "src/auth.ts", { limit: 3 });
    expect(typeof result.content).toBe("string");
  });

  test("validates inputs before searching", async () => {
    const search = spyOn(keyword, "searchKeyword").mockResolvedValue([]);
    const definition = await registerTool();
    await expect(definition.execute({ query: "auth", limit: "five" }, toolContext)).rejects.toThrow();
    await expect(definition.execute({}, toolContext)).rejects.toThrow("must be provided");
    expect(search).not.toHaveBeenCalled();
  });
});
