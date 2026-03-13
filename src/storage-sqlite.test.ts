import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";

describe("SQLite storage schema compatibility", () => {
  let db: Database;

  beforeAll(() => {
    db = new Database(":memory:");

    db.run(`CREATE TABLE project (
      id TEXT PRIMARY KEY, worktree TEXT NOT NULL, vcs TEXT, name TEXT,
      time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, sandboxes TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE session (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, slug TEXT NOT NULL,
      directory TEXT NOT NULL, title TEXT NOT NULL, version TEXT NOT NULL,
      time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES project(id)
    )`);
    db.run(`CREATE TABLE message (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES session(id)
    )`);
    db.run(`CREATE TABLE part (
      id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL,
      FOREIGN KEY (message_id) REFERENCES message(id)
    )`);

    db.run(`INSERT INTO project VALUES ('proj1', '/mock', 'git', 'test', 1706745600000, 1706745600000, '[]')`);
    db.run(`INSERT INTO session VALUES ('ses_001', 'proj1', 'slug1', '/mock', 'Implement storage layer', 'v1', 1706745600000, 1706745600000)`);

    const userMsg = JSON.stringify({ role: "user", agent: "user" }).replace(/'/g, "''");
    const assistantMsg = JSON.stringify({ role: "assistant", agent: "build" }).replace(/'/g, "''");
    db.run(`INSERT INTO message VALUES ('msg_001', 'ses_001', 1706745600000, 1706745600000, '${userMsg}')`);
    db.run(`INSERT INTO message VALUES ('msg_002', 'ses_001', 1706745601000, 1706745601000, '${assistantMsg}')`);

    const textPart = JSON.stringify({ type: "text", text: "Help me implement storage" }).replace(/'/g, "''");
    const toolPart = JSON.stringify({ type: "tool", tool: "edit", state: { status: "completed", input: { filePath: "src/storage.ts" }, output: "Created", title: "Create storage" } }).replace(/'/g, "''");
    const patchPart = JSON.stringify({ type: "patch", files: ["src/storage.ts", "src/index.ts"] }).replace(/'/g, "''");
    const reasoningPart = JSON.stringify({ type: "reasoning", text: "thinking..." }).replace(/'/g, "''");

    db.run(`INSERT INTO part VALUES ('part_001', 'msg_001', 'ses_001', 1706745600000, 1706745600000, '${textPart}')`);
    db.run(`INSERT INTO part VALUES ('part_002', 'msg_002', 'ses_001', 1706745601000, 1706745601000, '${toolPart}')`);
    db.run(`INSERT INTO part VALUES ('part_003', 'msg_002', 'ses_001', 1706745602000, 1706745602000, '${patchPart}')`);
    db.run(`INSERT INTO part VALUES ('part_004', 'msg_002', 'ses_001', 1706745603000, 1706745603000, '${reasoningPart}')`);
  });

  afterAll(() => {
    db.close();
  });

  test("queries sessions by project_id", () => {
    const rows = db.query("SELECT id, title FROM session WHERE project_id = ?").all("proj1");
    expect(rows).toHaveLength(1);
  });

  test("queries messages by session_id", () => {
    const rows = db.query("SELECT id, data FROM message WHERE session_id = ?").all("ses_001");
    expect(rows).toHaveLength(2);
  });

  test("filters messages by role via JSON parse", () => {
    const rows = db.query("SELECT id, data FROM message WHERE session_id = ?").all("ses_001") as Array<{ id: string; data: string }>;
    const userOnly = rows.filter((r) => JSON.parse(r.data).role === "user");
    expect(userOnly).toHaveLength(1);
  });

  test("parses text part correctly", () => {
    const rows = db.query("SELECT data FROM part WHERE id = ?").all("part_001") as Array<{ data: string }>;
    const data = JSON.parse(rows[0]!.data);
    expect(data.type).toBe("text");
    expect(data.text).toContain("storage");
  });

  test("parses tool part correctly", () => {
    const rows = db.query("SELECT data FROM part WHERE id = ?").all("part_002") as Array<{ data: string }>;
    const data = JSON.parse(rows[0]!.data);
    expect(data.type).toBe("tool");
    expect(data.tool).toBe("edit");
    expect(data.state.input.filePath).toBe("src/storage.ts");
  });

  test("parses patch part with files array", () => {
    const rows = db.query("SELECT data FROM part WHERE id = ?").all("part_003") as Array<{ data: string }>;
    const data = JSON.parse(rows[0]!.data);
    expect(data.type).toBe("patch");
    expect(data.files).toEqual(["src/storage.ts", "src/index.ts"]);
  });

  test("non-searchable types are present but skippable", () => {
    const rows = db.query("SELECT data FROM part WHERE id = ?").all("part_004") as Array<{ data: string }>;
    const data = JSON.parse(rows[0]!.data);
    expect(data.type).toBe("reasoning");
    // Our code would skip this — not in the "text" | "tool" | "file" | "patch" set
  });
});
