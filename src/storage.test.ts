import { test, expect } from "bun:test";
import { getStorageDir, getCurrentProjectID } from "./storage";

test("getStorageDir returns valid path", async () => {
  const dir = await getStorageDir();
  expect(dir).toContain("opencode/storage");
});

test("getCurrentProjectID returns non-empty string", async () => {
  const id = await getCurrentProjectID();
  expect(id.length).toBeGreaterThan(0);
});
