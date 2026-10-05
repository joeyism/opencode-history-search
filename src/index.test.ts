import { test, expect, describe } from "bun:test";
import plugin, { historySearch } from "./index";

describe("historySearch tool", () => {
  test("exports a V2 plugin definition with id and setup", () => {
    expect(plugin).toBeDefined();
    expect(plugin.id).toBe("opencode-history-search");
    expect(typeof plugin.setup).toBe("function");
  });

  test("tool input schema includes terms parameter for multi-term search", () => {
    expect(historySearch).toBeDefined();
    const input = (historySearch as any).input ?? {};
    expect(input.properties).toHaveProperty("terms");
  });
});
