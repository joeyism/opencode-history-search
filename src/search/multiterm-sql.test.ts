import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { searchMultitermSqlite, searchMultiterm } from "./multiterm-sql";

describe("searchMultitermSqlite (in-memory SQLite, real schema)", () => {
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

    db.run(`INSERT INTO project VALUES ('proj_main', '/mock/main', 'git', 'main', 1774000000000, 1775000000000, '[]')`);
    db.run(`INSERT INTO project VALUES ('proj_other', '/mock/other', 'git', 'other', 1774000000000, 1776000000000, '[]')`);

    // ses_a: text with "truck" only — should NOT match [truck, vertex, gemini]
    db.run(`INSERT INTO session VALUES ('ses_a', 'proj_main', 'a', '/mock/main', 'Truck overview', 'v1', 1774100000000, 1774100000000)`);
    db.run(`INSERT INTO message VALUES ('msg_a1', 'ses_a', 1774100000000, 1774100000000, '{"role":"assistant","agent":"build"}')`);
    db.run(`INSERT INTO part VALUES ('part_a1', 'msg_a1', 'ses_a', 1774100000000, 1774100000000, '{"type":"text","text":"we trained truck model on data"}')`);

    // ses_b: cross-part match — all 3 terms across 3 different parts
    db.run(`INSERT INTO session VALUES ('ses_b', 'proj_main', 'b', '/mock/main', 'Vertex Gemini fine-tune', 'v1', 1774200000000, 1774200000000)`);
    db.run(`INSERT INTO message VALUES ('msg_b1', 'ses_b', 1774200000000, 1774200000000, '{"role":"user","agent":"user"}')`);
    db.run(`INSERT INTO part VALUES ('part_b1', 'msg_b1', 'ses_b', 1774200000000, 1774200000000, '{"type":"text","text":"please use vertex ai"}')`);
    db.run(`INSERT INTO message VALUES ('msg_b2', 'ses_b', 1774200001000, 1774200001000, '{"role":"assistant","agent":"build"}')`);
    db.run(`INSERT INTO part VALUES ('part_b2', 'msg_b2', 'ses_b', 1774200001000, 1774200001000, '{"type":"tool","tool":"bash","state":{"input":{"cmd":"tune"},"output":"gemini-2.5-flash ready"}}')`);
    db.run(`INSERT INTO part VALUES ('part_b3', 'msg_b2', 'ses_b', 1774200002000, 1774200002000, '{"type":"patch","files":["src/NonTruckExamples/x.ts","src/Other.ts"]}')`);

    // ses_c: title has "Truck Vertex" but no part has "gemini"
    db.run(`INSERT INTO session VALUES ('ses_c', 'proj_main', 'c', '/mock/main', 'Truck Vertex plan', 'v1', 1774300000000, 1774300000000)`);
    db.run(`INSERT INTO message VALUES ('msg_c1', 'ses_c', 1774300000000, 1774300000000, '{"role":"user","agent":"user"}')`);
    db.run(`INSERT INTO part VALUES ('part_c1', 'msg_c1', 'ses_c', 1774300000000, 1774300000000, '{"type":"text","text":"some notes"}')`);

    // ses_d: one part with all 3 terms
    db.run(`INSERT INTO session VALUES ('ses_d', 'proj_main', 'd', '/mock/main', 'Seed data', 'v1', 1774400000000, 1774400000000)`);
    db.run(`INSERT INTO message VALUES ('msg_d1', 'ses_d', 1774400000000, 1774400000000, '{"role":"assistant","agent":"build"}')`);
    db.run(`INSERT INTO part VALUES ('part_d1', 'msg_d1', 'ses_d', 1774400000000, 1774400000000, '{"type":"tool","tool":"write","state":{"output":"TRUCK Vertex GEMINI all in one"}}')`);

    // ses_e: different project, has "truck" — used for project scoping tests
    db.run(`INSERT INTO session VALUES ('ses_e', 'proj_other', 'e', '/mock/other', 'Other proj truck', 'v1', 1774500000000, 1774500000000)`);
    db.run(`INSERT INTO message VALUES ('msg_e1', 'ses_e', 1774500000000, 1774500000000, '{"role":"user","agent":"user"}')`);
    db.run(`INSERT INTO part VALUES ('part_e1', 'msg_e1', 'ses_e', 1774500000000, 1774500000000, '{"type":"text","text":"truck reference here"}')`);

    // ses_f: empty session — no messages
    db.run(`INSERT INTO session VALUES ('ses_f', 'proj_main', 'f', '/mock/main', 'Empty session', 'v1', 1774600000000, 1774600000000)`);

    // ses_g: session with a malformed part
    db.run(`INSERT INTO session VALUES ('ses_g', 'proj_main', 'g', '/mock/main', 'Malformed test', 'v1', 1774700000000, 1774700000000)`);
    db.run(`INSERT INTO message VALUES ('msg_g1', 'ses_g', 1774700000000, 1774700000000, '{"role":"assistant","agent":"build"}')`);
    db.run(`INSERT INTO part VALUES ('part_g1', 'msg_g1', 'ses_g', 1774700000000, 1774700000000, '{not valid json truck}')`);
    db.run(`INSERT INTO part VALUES ('part_g2', 'msg_g1', 'ses_g', 1774700001000, 1774700001000, '{"type":"text","text":"valid truck here"}')`);
  });

  afterAll(() => {
    db.close();
  });

  test("finds session containing all terms across multiple parts", () => {
    const results = searchMultitermSqlite(db, "proj_main", ["truck", "vertex", "gemini"]);
    expect(results.map((r) => r.sessionID)).toContain("ses_b");
  });

  test("matches session where one part contains all terms", () => {
    const results = searchMultitermSqlite(db, "proj_main", ["truck", "vertex", "gemini"]);
    expect(results.map((r) => r.sessionID)).toContain("ses_d");
  });

  test("excludes session missing one term", () => {
    const results = searchMultitermSqlite(db, "proj_main", ["truck", "vertex", "gemini"]);
    expect(results.map((r) => r.sessionID)).not.toContain("ses_a");
  });

  test("substring matches inside camelCase filename in tool input", () => {
    const results = searchMultitermSqlite(db, "proj_main", ["NonTruck"]);
    expect(results.map((r) => r.sessionID)).toContain("ses_b");
  });

  test("case-insensitive: 'TRUCK' finds 'truck' and 'Truck'", () => {
    const results = searchMultitermSqlite(db, "proj_main", ["TRUCK"]);
    const ids = results.map((r) => r.sessionID);
    expect(ids).toContain("ses_a");
    expect(ids).toContain("ses_b");
    expect(ids).toContain("ses_d");
  });

  test("a term in session.title counts toward match", () => {
    const results = searchMultitermSqlite(db, "proj_main", ["truck", "vertex"]);
    expect(results.map((r) => r.sessionID)).toContain("ses_c");
  });

  test("session with no messages is safely excluded", () => {
    const results = searchMultitermSqlite(db, "proj_main", ["truck", "vertex", "gemini"]);
    expect(results.map((r) => r.sessionID)).not.toContain("ses_f");
  });

  test("malformed JSON in part.data is skipped without error", () => {
    expect(() =>
      searchMultitermSqlite(db, "proj_main", ["truck"]),
    ).not.toThrow();
    const results = searchMultitermSqlite(db, "proj_main", ["truck"]);
    expect(results).toBeDefined();
  });

  test("only returns sessions in specified project", () => {
    const main = searchMultitermSqlite(db, "proj_main", ["truck"]);
    const other = searchMultitermSqlite(db, "proj_other", ["truck"]);

    expect(main.every((r) => r.projectDirectory === "/mock/main")).toBe(true);
    expect(other.every((r) => r.projectDirectory === "/mock/other")).toBe(true);
    expect(other.map((r) => r.sessionID)).toContain("ses_e");
  });

  test("projectID = null searches across all projects", () => {
    const results = searchMultitermSqlite(db, null, ["truck"]);
    const ids = results.map((r) => r.sessionID);
    expect(ids).toContain("ses_a");
    expect(ids).toContain("ses_e");
  });

  test("results sorted by session time_updated descending", () => {
    const results = searchMultitermSqlite(db, "proj_main", ["truck"]);
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i]!.timestamp).toBeGreaterThanOrEqual(
        results[i + 1]!.timestamp,
      );
    }
  });

  test("respects limit parameter", () => {
    const results = searchMultitermSqlite(db, "proj_main", ["truck"], {
      limit: 2,
    });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test("each result includes termHits showing which parts matched which terms", () => {
    const results = searchMultitermSqlite(db, "proj_main", [
      "truck",
      "vertex",
      "gemini",
    ]);
    const sesB = results.find((r) => r.sessionID === "ses_b");
    expect(sesB).toBeDefined();
    expect(sesB!.termHits).toBeDefined();
    expect(sesB!.termHits.size).toBe(3);
    expect(sesB!.termHits.has("truck")).toBe(true);
    expect(sesB!.termHits.has("vertex")).toBe(true);
    expect(sesB!.termHits.has("gemini")).toBe(true);
  });

  test("excerpt is the matching text fragment", () => {
    const results = searchMultitermSqlite(db, "proj_main", ["vertex"]);
    const sesB = results.find((r) => r.sessionID === "ses_b");
    expect(sesB).toBeDefined();
    const vertexHit = sesB!.termHits.get("vertex");
    expect(vertexHit).toBeDefined();
    expect(vertexHit!.excerpt.length).toBeGreaterThan(0);
    expect(vertexHit!.excerpt.toLowerCase()).toContain("vertex");
  });

  test("each result has required fields", () => {
    const results = searchMultitermSqlite(db, "proj_main", ["truck"]);
    const r = results[0]!;
    expect(r).toHaveProperty("sessionID");
    expect(r).toHaveProperty("sessionTitle");
    expect(r).toHaveProperty("timestamp");
    expect(r).toHaveProperty("projectDirectory");
    expect(r).toHaveProperty("termHits");
  });

  test("async wrapper searchMultiterm is exported", () => {
    expect(typeof searchMultiterm).toBe("function");
  });

  test("leaves out a calling session that wasn't compacted", () => {
    const results = searchMultitermSqlite(db, "proj_main", ["truck", "vertex", "gemini"], {
      inContext: { sessionID: "ses_b" },
    });
    const ids = results.map((r) => r.sessionID);
    expect(ids).not.toContain("ses_b");
    expect(ids).toContain("ses_d");
  });

  test("searches only what a compaction took out of context", () => {
    const inContext = {
      sessionID: "ses_b",
      since: { id: "msg_b2", time: 1774200001000 },
    };

    // "truck" and "gemini" are only in msg_b2, which is still in context.
    const all = searchMultitermSqlite(db, "proj_main", ["truck", "vertex", "gemini"], { inContext });
    expect(all.map((r) => r.sessionID)).not.toContain("ses_b");

    const early = searchMultitermSqlite(db, "proj_main", ["vertex", "please"], { inContext });
    const sesB = early.find((r) => r.sessionID === "ses_b");
    expect(sesB).toBeDefined();
    expect(sesB!.termHits.get("vertex")?.partID).toBe("part_b1");
  });

  test("the calling session's title doesn't count toward a match", () => {
    // ses_b's title is "Vertex Gemini fine-tune"; only "vertex" is in msg_b1.
    const results = searchMultitermSqlite(db, "proj_main", ["vertex", "gemini"], {
      inContext: { sessionID: "ses_b", since: { id: "msg_b2", time: 1774200001000 } },
    });
    expect(results.map((r) => r.sessionID)).not.toContain("ses_b");
  });
});
