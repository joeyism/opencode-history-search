import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { traceFileSqlite } from "./file-trace";

describe("file-trace search", () => {
  let db: Database;

  beforeAll(() => {
    db = new Database(":memory:");

    // Schema
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

    // Projects
    db.run(`INSERT INTO project VALUES ('proj_main', '/mock/main', 'git', 'main', 1774346300000, 1775296802200, '[]')`);
    db.run(`INSERT INTO project VALUES ('proj_other', '/mock/other', 'git', 'other', 1774346300000, 1775383202200, '[]')`);

    // Sessions
    db.run(`INSERT INTO session VALUES ('ses_a', 'proj_main', 'build-auth-module', '/mock/main', 'build auth module', 'v1', 1774346400000, 1774346401200)`);
    db.run(`INSERT INTO session VALUES ('ses_b', 'proj_main', 'add-rate-limiting', '/mock/main', 'add rate limiting', 'v1', 1774951200000, 1774951201200)`);
    db.run(`INSERT INTO session VALUES ('ses_c', 'proj_main', 'review-auth-code', '/mock/main', 'review auth code', 'v1', 1774954800000, 1774954801200)`);
    db.run(`INSERT INTO session VALUES ('ses_d', 'proj_main', 'fix-login-bug', '/mock/main', 'fix login bug', 'v1', 1775296800000, 1775296801200)`);
    db.run(`INSERT INTO session VALUES ('ses_f', 'proj_main', 'bootstrap-config', '/mock/main', 'bootstrap config', 'v1', 1775124000000, 1775124000200)`);
    db.run(`INSERT INTO session VALUES ('ses_e', 'proj_other', 'other-project-auth-change', '/mock/other', 'other project auth change', 'v1', 1775383200000, 1775383201200)`);

    // Messages
    db.run(`INSERT INTO message VALUES ('msg_a1', 'ses_a', 1774346400000, 1774346400000, '{"role":"user","agent":"user"}')`);
    db.run(`INSERT INTO message VALUES ('msg_a2', 'ses_a', 1774346401000, 1774346401000, '{"role":"assistant","agent":"build"}')`);

    db.run(`INSERT INTO message VALUES ('msg_b1', 'ses_b', 1774951200000, 1774951200000, '{"role":"user","agent":"user"}')`);
    db.run(`INSERT INTO message VALUES ('msg_b2', 'ses_b', 1774951201000, 1774951201000, '{"role":"assistant","agent":"build"}')`);

    db.run(`INSERT INTO message VALUES ('msg_c1', 'ses_c', 1774954800000, 1774954800000, '{"role":"user","agent":"user"}')`);
    db.run(`INSERT INTO message VALUES ('msg_c2', 'ses_c', 1774954801000, 1774954801000, '{"role":"assistant","agent":"build"}')`);

    db.run(`INSERT INTO message VALUES ('msg_d1', 'ses_d', 1775296800000, 1775296800000, '{"role":"user","agent":"user"}')`);
    db.run(`INSERT INTO message VALUES ('msg_d2', 'ses_d', 1775296800500, 1775296800500, '{"role":"user","agent":"user"}')`);
    db.run(`INSERT INTO message VALUES ('msg_d3', 'ses_d', 1775296801000, 1775296801000, '{"role":"assistant","agent":"build"}')`);

    db.run(`INSERT INTO message VALUES ('msg_f1', 'ses_f', 1775124000000, 1775124000000, '{"role":"assistant","agent":"build"}')`);

    db.run(`INSERT INTO message VALUES ('msg_e1', 'ses_e', 1775383200000, 1775383200000, '{"role":"user","agent":"user"}')`);
    db.run(`INSERT INTO message VALUES ('msg_e2', 'ses_e', 1775383201000, 1775383201000, '{"role":"assistant","agent":"build"}')`);

    // Parts
    db.run(`INSERT INTO part VALUES ('part_a1_text', 'msg_a1', 'ses_a', 1774346400000, 1774346400000, '{"type":"text","text":"build me an auth module"}')`);
    db.run(`INSERT INTO part VALUES ('part_a2_tool', 'msg_a2', 'ses_a', 1774346401100, 1774346401100, '{"type":"tool","tool":"write","state":{"status":"completed","input":{"filePath":"src/auth.ts"},"output":"Wrote src/auth.ts","title":"Write auth module"}}')`);
    db.run(`INSERT INTO part VALUES ('part_a2_patch', 'msg_a2', 'ses_a', 1774346401200, 1774346401200, '{"type":"patch","files":["src/auth.ts"]}')`);

    db.run(`INSERT INTO part VALUES ('part_b1_text', 'msg_b1', 'ses_b', 1774951200000, 1774951200000, '{"type":"text","text":"add rate limiting to auth"}')`);
    db.run(`INSERT INTO part VALUES ('part_b2_tool', 'msg_b2', 'ses_b', 1774951201100, 1774951201100, '{"type":"tool","tool":"edit","state":{"status":"completed","input":{"filePath":"src/auth.ts"},"output":"Updated src/auth.ts","title":"Add rate limiting"}}')`);
    db.run(`INSERT INTO part VALUES ('part_b2_patch', 'msg_b2', 'ses_b', 1774951201200, 1774951201200, '{"type":"patch","files":["src/auth.ts","src/rate-limit.ts"]}')`);

    db.run(`INSERT INTO part VALUES ('part_c1_text', 'msg_c1', 'ses_c', 1774954800000, 1774954800000, '{"type":"text","text":"find all usages of auth"}')`);
    db.run(`INSERT INTO part VALUES ('part_c2_tool', 'msg_c2', 'ses_c', 1774954801100, 1774954801100, '{"type":"tool","tool":"grep","state":{"status":"completed","input":{"pattern":"auth"},"output":"src/grep-only.ts; src/auth.ts","title":"Search auth references"}}')`);
    db.run(`INSERT INTO part VALUES ('part_c2_text', 'msg_c2', 'ses_c', 1774954801200, 1774954801200, '{"type":"text","text":"I found references to src/text-only.ts and src/auth.ts in the codebase."}')`);

    db.run(`INSERT INTO part VALUES ('part_d1_text', 'msg_d1', 'ses_d', 1775296800000, 1775296800000, '{"type":"text","text":"fix the login bug"}')`);
    db.run(`INSERT INTO part VALUES ('part_d2_text', 'msg_d2', 'ses_d', 1775296800500, 1775296800500, '{"type":"text","text":"specifically in auth.ts"}')`);
    db.run(`INSERT INTO part VALUES ('part_d3_tool', 'msg_d3', 'ses_d', 1775296801100, 1775296801100, '{"type":"tool","tool":"edit","state":{"status":"completed","input":{"filePath":"src/auth.ts"},"output":"Fixed login bug","title":"Edit auth login flow"}}')`);
    db.run(`INSERT INTO part VALUES ('part_d3_patch', 'msg_d3', 'ses_d', 1775296801200, 1775296801200, '{"type":"patch","files":["src/auth.ts"]}')`);

    db.run(`INSERT INTO part VALUES ('part_f1_tool', 'msg_f1', 'ses_f', 1775124000100, 1775124000100, '{"type":"tool","tool":"write","state":{"status":"completed","input":{"filePath":"src/config.ts"},"output":"Wrote src/config.ts","title":"Write config file"}}')`);
    db.run(`INSERT INTO part VALUES ('part_f1_patch', 'msg_f1', 'ses_f', 1775124000200, 1775124000200, '{"type":"patch","files":["src/config.ts"]}')`);

    db.run(`INSERT INTO part VALUES ('part_e1_text', 'msg_e1', 'ses_e', 1775383200000, 1775383200000, '{"type":"text","text":"touch auth in other project"}')`);
    db.run(`INSERT INTO part VALUES ('part_e2_tool', 'msg_e2', 'ses_e', 1775383201100, 1775383201100, '{"type":"tool","tool":"write","state":{"status":"completed","input":{"filePath":"src/auth.ts"},"output":"Wrote src/auth.ts","title":"Write auth file"}}')`);
    db.run(`INSERT INTO part VALUES ('part_e2_patch', 'msg_e2', 'ses_e', 1775383201200, 1775383201200, '{"type":"patch","files":["src/auth.ts"]}')`);

    db.run(`INSERT INTO session VALUES ('ses_g', 'proj_main', 'malformed-patch', '/mock/main', 'malformed patch', 'v1', 1775386800000, 1775386801200)`);
    db.run(`INSERT INTO message VALUES ('msg_g1', 'ses_g', 1775386800000, 1775386800000, '{"role":"assistant","agent":"build"}')`);
    db.run(`INSERT INTO part VALUES ('part_g1_patch', 'msg_g1', 'ses_g', 1775386800100, 1775386800100, '{"type":"patch","files":oops}')`);
  });

  afterAll(() => {
    db.close();
  });

  describe("Group 1: Core lookup", () => {
    test("finds file touches from patch.files", () => {
      const results = traceFileSqlite(db, "proj_main", "src/rate-limit.ts");
      expect(results).toHaveLength(1);
      expect(results[0]?.sessionID).toBe("ses_b");
      expect(results[0]?.filePath).toBe("src/rate-limit.ts");
    });

    test("finds file touches from write tool input.filePath", () => {
      const results = traceFileSqlite(db, "proj_main", "src/auth.ts");
      const sesA = results.find((r) => r.sessionID === "ses_a");
      expect(sesA).toBeDefined();
      expect(sesA?.toolName).toBe("write");
    });

    test("finds file touches from edit tool input.filePath", () => {
      const results = traceFileSqlite(db, "proj_main", "src/auth.ts");
      const sesB = results.find((r) => r.sessionID === "ses_b");
      const sesD = results.find((r) => r.sessionID === "ses_d");
      expect(sesB?.toolName).toBe("edit");
      expect(sesD?.toolName).toBe("edit");
    });

    test("does not match grep tool references", () => {
      const results = traceFileSqlite(db, "proj_main", "src/grep-only.ts");
      expect(results).toHaveLength(0);
    });

    test("does not match plain text mentions", () => {
      const results = traceFileSqlite(db, "proj_main", "src/text-only.ts");
      expect(results).toHaveLength(0);
    });

    test("returns empty array for unknown file", () => {
      const results = traceFileSqlite(db, "proj_main", "src/unknown.ts");
      expect(results).toHaveLength(0);
    });

    test("deduplicates tool and patch matches within the same assistant message", () => {
      const results = traceFileSqlite(db, "proj_main", "src/auth.ts");
      expect(results).toHaveLength(3);
      expect(results.map((r) => r.sessionID)).toEqual(["ses_d", "ses_b", "ses_a"]);
    });
  });

  describe("Group 2: firstTouch logic", () => {
    test("marks the earliest touch as firstTouch and later touches as false", () => {
      const results = traceFileSqlite(db, "proj_main", "src/auth.ts");
      const sesA = results.find((r) => r.sessionID === "ses_a");
      const sesB = results.find((r) => r.sessionID === "ses_b");
      const sesD = results.find((r) => r.sessionID === "ses_d");
      
      expect(sesA?.firstTouch).toBe(true);
      expect(sesB?.firstTouch).toBe(false);
      expect(sesD?.firstTouch).toBe(false);
    });

    test("marks a single touch as firstTouch", () => {
      const results = traceFileSqlite(db, "proj_main", "src/rate-limit.ts");
      expect(results).toHaveLength(1);
      expect(results[0]?.firstTouch).toBe(true);
    });

    test("computes firstTouch from chronology not output order", () => {
      const results = traceFileSqlite(db, "proj_main", "src/auth.ts");
      expect(results[0]?.sessionID).toBe("ses_d");
      expect(results[0]?.firstTouch).toBe(false);
      
      expect(results[results.length - 1]?.sessionID).toBe("ses_a");
      expect(results[results.length - 1]?.firstTouch).toBe(true);
    });
  });

  describe("Group 3: user prompt retrieval", () => {
    test("returns the preceding user message text", () => {
      const results = traceFileSqlite(db, "proj_main", "src/rate-limit.ts");
      expect(results[0]?.userPrompt).toBe("add rate limiting to auth");
    });

    test("returns the immediately preceding user message when multiple user messages exist", () => {
      const results = traceFileSqlite(db, "proj_main", "src/auth.ts");
      const sesD = results.find((r) => r.sessionID === "ses_d");
      expect(sesD?.userPrompt).toBe("specifically in auth.ts");
    });

    test("returns null when no preceding user message exists", () => {
      const results = traceFileSqlite(db, "proj_main", "src/config.ts");
      expect(results[0]?.userPrompt).toBe(null);
    });
  });

  describe("Group 4: result shape and ordering", () => {
    test("returns results sorted newest first", () => {
      const results = traceFileSqlite(db, "proj_main", "src/auth.ts");
      expect(results.map((r) => r.timestamp)).toEqual([1775296801000, 1774951201000, 1774346401000]);
      expect(results.map((r) => r.sessionID)).toEqual(["ses_d", "ses_b", "ses_a"]);
    });

    test("includes toolName", () => {
      const results = traceFileSqlite(db, "proj_main", "src/auth.ts");
      expect(results.map((r) => r.toolName)).toEqual(["edit", "edit", "write"]);
    });

    test("includes the matched filePath", () => {
      const results = traceFileSqlite(db, "proj_main", "auth.ts");
      for (const result of results) {
        expect(result.filePath).toBe("src/auth.ts");
      }
    });

    test("respects the limit parameter", () => {
      const results = traceFileSqlite(db, "proj_main", "auth.ts", { limit: 2 });
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.sessionID)).toEqual(["ses_d", "ses_b"]);
    });
  });

  describe("Group 5: project scoping", () => {
    test("only returns touches from the specified project", () => {
      const mainResults = traceFileSqlite(db, "proj_main", "src/auth.ts");
      const otherResults = traceFileSqlite(db, "proj_other", "src/auth.ts");
      
      expect(mainResults.map((r) => r.sessionID)).toEqual(["ses_d", "ses_b", "ses_a"]);
      expect(otherResults.map((r) => r.sessionID)).toEqual(["ses_e"]);
    });
  });

  describe("Group 6: path matching", () => {
    test("matches exact file paths", () => {
      const results = traceFileSqlite(db, "proj_main", "src/auth.ts");
      expect(results).toHaveLength(3);
    });

    test("matches basename queries against full stored paths", () => {
      const exactResults = traceFileSqlite(db, "proj_main", "src/auth.ts");
      const basenameResults = traceFileSqlite(db, "proj_main", "auth.ts");
      
      expect(basenameResults).toEqual(exactResults);
    });

    test("normalizes backslash paths before exact matching", () => {
      const forwardSlashResults = traceFileSqlite(db, "proj_main", "src/auth.ts");
      const backslashResults = traceFileSqlite(db, "proj_main", "src\\auth.ts");

      expect(backslashResults).toEqual(forwardSlashResults);
    });

    test("skips malformed patch rows without crashing", () => {
      const results = traceFileSqlite(db, "proj_main", "src/auth.ts");
      expect(results.map((r) => r.sessionID)).toEqual(["ses_d", "ses_b", "ses_a"]);
    });
  });
});
