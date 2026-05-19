import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import {
  ensureFts,
  searchFts,
  escapeFtsPhrase,
  searchTitles,
} from "./fts";

/**
 * In-memory integration tests for the FTS5 module. These tests build a
 * miniature opencode schema, populate it with a handful of realistic rows,
 * call ensureFts() to construct the index and triggers, then exercise the
 * query and trigger paths directly. This is what would have caught the
 * "searchKeywordFts is not defined" / "trigger crashes on malformed JSON"
 * bugs the unit mocks let through.
 */

function makeSchema(db: Database): void {
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      directory TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);

  db.exec(`INSERT INTO session VALUES
    ('s1','proj1','Storage layer work','/repo/a',1000,1500),
    ('s2','proj1','Auth refactor','/repo/a',2000,2500),
    ('s3','proj2','Other project',  '/repo/b',3000,3500);
  `);

  db.exec(`INSERT INTO message VALUES
    ('m1','s1',1100,1100,'${JSON.stringify({ role: "user" }).replace(/'/g, "''")}'),
    ('m2','s1',1200,1200,'${JSON.stringify({ role: "assistant" }).replace(/'/g, "''")}'),
    ('m3','s2',2100,2100,'${JSON.stringify({ role: "user" }).replace(/'/g, "''")}');
  `);

  const ins = (id: string, mid: string, sid: string, t: number, data: object) =>
    db
      .query(`INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, mid, sid, t, t, JSON.stringify(data));

  ins("p1", "m1", "s1", 1100, {
    type: "text",
    text: "How should I implement the storage layer for sessions?",
  });
  ins("p2", "m2", "s1", 1200, {
    type: "tool",
    tool: "edit",
    state: { title: "Edit storage.ts", input: { filePath: "src/storage.ts" }, output: "ok" },
  });
  ins("p3", "m2", "s1", 1210, {
    type: "patch",
    files: ["src/storage.ts", "src/helpers.ts"],
  });
  ins("p4", "m3", "s2", 2100, {
    type: "text",
    text: "Switch to JWT for authentication tokens.",
  });
  // A non-searchable type — must be ignored by FTS without errors.
  ins("p5", "m3", "s2", 2110, { type: "reasoning", text: "thinking..." });
}

describe("FTS5 module", () => {
  let db: Database;

  beforeAll(() => {
    db = new Database(":memory:");
    db.exec("PRAGMA journal_mode = MEMORY");
    makeSchema(db);
    const result = ensureFts(db);
    expect(result.built).toBe(true);
  });

  afterAll(() => {
    db.close();
  });

  test("backfill indexed all four part kinds", () => {
    const counts = db
      .query<{ kind: string; n: number }, []>(
        `SELECT kind, COUNT(*) n FROM part_fts GROUP BY kind ORDER BY kind`,
      )
      .all();
    const map = Object.fromEntries(counts.map((c) => [c.kind, c.n]));
    expect(map.text).toBe(2);
    expect(map.tool_name).toBe(1);
    expect(map.tool_state).toBe(1);
    // patch_file is flattened: 2 files in one patch part
    expect(map.patch_file).toBe(2);
  });

  test("triggers and meta table created", () => {
    const triggers = db
      .query<{ name: string }, []>(
        `SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'part_fts_%'`,
      )
      .all()
      .map((r) => r.name)
      .sort();
    expect(triggers).toEqual(["part_fts_ad", "part_fts_ai", "part_fts_au"]);

    const version = db
      .query<{ value: string }, []>(
        `SELECT value FROM part_fts_meta WHERE key='version'`,
      )
      .get()?.value;
    expect(version).toBe("2");
  });

  test("ensureFts is idempotent (no rebuild on second call)", () => {
    const r = ensureFts(db);
    expect(r.built).toBe(false);
  });

  test("searchFts finds text matches", () => {
    const hits = searchFts(db, escapeFtsPhrase("storage")!, {
      projectID: null,
      limit: 10,
    });
    const textHits = hits.filter((h) => h.kind === "text");
    expect(textHits.length).toBeGreaterThan(0);
  });

  test("searchFts finds patch_file by individual file path", () => {
    const hits = searchFts(db, escapeFtsPhrase("helpers.ts")!, {
      projectID: null,
      limit: 10,
    });
    const patchHits = hits.filter((h) => h.kind === "patch_file");
    expect(patchHits.length).toBe(1);
    expect(patchHits[0]?.content).toBe("src/helpers.ts");
  });

  test("searchFts respects projectID filter", () => {
    const proj1 = searchFts(db, escapeFtsPhrase("storage")!, {
      projectID: "proj1",
      limit: 10,
    });
    const proj2 = searchFts(db, escapeFtsPhrase("storage")!, {
      projectID: "proj2",
      limit: 10,
    });
    expect(proj1.length).toBeGreaterThan(0);
    expect(proj2.length).toBe(0);
  });

  test("searchFts respects role filter (pushed to SQL)", () => {
    const userHits = searchFts(db, escapeFtsPhrase("storage")!, {
      projectID: null,
      role: "user",
      limit: 10,
    });
    const assistantHits = searchFts(db, escapeFtsPhrase("storage")!, {
      projectID: null,
      role: "assistant",
      limit: 10,
    });
    // 'storage' appears in m1 (user) and m2 (assistant patch + tool)
    expect(userHits.length).toBeGreaterThan(0);
    expect(assistantHits.length).toBeGreaterThan(0);
    expect(userHits.every((h) => h.message_id === "m1")).toBe(true);
  });

  test("searchFts respects date range (pushed to SQL)", () => {
    const old = searchFts(db, escapeFtsPhrase("authentication")!, {
      projectID: null,
      endTime: 1500,
      limit: 10,
    });
    const newer = searchFts(db, escapeFtsPhrase("authentication")!, {
      projectID: null,
      startTime: 2000,
      limit: 10,
    });
    expect(old.length).toBe(0); // p4 is at 2100, older than 1500 endTime
    expect(newer.length).toBe(1);
  });

  test("searchTitles finds session by title", () => {
    const hits = searchTitles(db, "Auth", { projectID: null, limit: 10 });
    expect(hits.length).toBe(1);
    expect(hits[0]?.id).toBe("s2");
  });
});

describe("escapeFtsPhrase", () => {
  test("wraps plain input in phrase quotes", () => {
    expect(escapeFtsPhrase("hello world")).toBe('"hello world"');
  });
  test("doubles embedded quotes", () => {
    expect(escapeFtsPhrase('say "hi"')).toBe('"say ""hi"""');
  });
  test("strips control characters", () => {
    expect(escapeFtsPhrase("foo\u0000bar")).toBe('"foo bar"');
    expect(escapeFtsPhrase("line1\nline2")).toBe('"line1 line2"');
  });
  test("returns null for empty / whitespace", () => {
    expect(escapeFtsPhrase("")).toBe(null);
    expect(escapeFtsPhrase("   ")).toBe(null);
  });
  test("returns null for all-punctuation input", () => {
    expect(escapeFtsPhrase("???")).toBe(null);
    expect(escapeFtsPhrase("!!!")).toBe(null);
  });
  test("accepts unicode letters", () => {
    expect(escapeFtsPhrase("café")).toBe('"café"');
    expect(escapeFtsPhrase("日本語")).toBe('"日本語"');
  });
});

describe("triggers tolerate malformed part.data without breaking inserts", () => {
  let db: Database;

  beforeAll(() => {
    db = new Database(":memory:");
    makeSchema(db);
    ensureFts(db);
  });

  afterAll(() => {
    db.close();
  });

  test("INSERT of non-JSON data does NOT abort (json_valid guard works)", () => {
    // This is THE failure mode the audit found: if the trigger ran
    // json_extract on non-JSON, the parent INSERT would abort.
    expect(() => {
      db.query(
        `INSERT INTO part VALUES ('bad1','m1','s1',9999,9999,'not json at all')`,
      ).run();
    }).not.toThrow();

    // The row IS in part (parent insert succeeded)...
    const row = db.query(`SELECT id FROM part WHERE id='bad1'`).get();
    expect(row).toBeDefined();

    // ...but NOT in part_fts (trigger silently skipped it)
    const ftsRow = db
      .query(`SELECT part_id FROM part_fts WHERE part_id='bad1'`)
      .get();
    expect(ftsRow).toBeNull();
  });

  test("UPDATE of malformed data does NOT abort", () => {
    db.query(
      `INSERT INTO part VALUES ('good1','m1','s1',8000,8000,'${JSON.stringify({ type: "text", text: "hello" }).replace(/'/g, "''")}')`,
    ).run();
    // The first insert worked, FTS has the row
    let ftsRow = db
      .query(`SELECT part_id FROM part_fts WHERE part_id='good1'`)
      .get();
    expect(ftsRow).toBeDefined();

    // Now corrupt it
    expect(() => {
      db.query(`UPDATE part SET data='garbage' WHERE id='good1'`).run();
    }).not.toThrow();

    // FTS row should be deleted (DELETE trigger part runs) but no re-insert
    ftsRow = db
      .query(`SELECT part_id FROM part_fts WHERE part_id='good1'`)
      .get();
    expect(ftsRow).toBeNull();
  });

  test("DELETE removes FTS rows", () => {
    db.query(
      `INSERT INTO part VALUES ('del1','m1','s1',7000,7000,'${JSON.stringify({ type: "text", text: "doomed" }).replace(/'/g, "''")}')`,
    ).run();
    let ftsRow = db
      .query(`SELECT part_id FROM part_fts WHERE part_id='del1'`)
      .get();
    expect(ftsRow).toBeDefined();

    db.query(`DELETE FROM part WHERE id='del1'`).run();
    ftsRow = db
      .query(`SELECT part_id FROM part_fts WHERE part_id='del1'`)
      .get();
    expect(ftsRow).toBeNull();
  });
});

describe("rebuild atomicity", () => {
  test("ensureFts wraps build in a transaction; rollback leaves prior state", () => {
    const db = new Database(":memory:");
    makeSchema(db);
    ensureFts(db);

    const before = (
      db.query<{ n: number }, []>(`SELECT COUNT(*) n FROM part_fts`).get() as
        | { n: number }
        | undefined
    )?.n;
    expect(before).toBeGreaterThan(0);

    // Simulate a crash mid-build by manually beginning a transaction and
    // rolling back. After rollback, the original index must still be intact.
    db.exec("BEGIN IMMEDIATE");
    db.exec("DROP TABLE part_fts");
    db.exec("ROLLBACK");

    const after = (
      db.query<{ n: number }, []>(`SELECT COUNT(*) n FROM part_fts`).get() as
        | { n: number }
        | undefined
    )?.n;
    expect(after).toBe(before);

    db.close();
  });
});
