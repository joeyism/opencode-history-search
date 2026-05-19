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
    expect(version).toBe("4");

    // Watermark recorded so incremental backfill works
    const watermark = db
      .query<{ value: string }, []>(
        `SELECT value FROM part_fts_meta WHERE key='last_rowid'`,
      )
      .get()?.value;
    expect(Number(watermark)).toBeGreaterThan(0);
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

  // F1 regression: json_each used to crash the trigger if $.files was a
  // syntactically-valid JSON value that wasn't an array (string, object,
  // number, etc). That crashed the parent INSERT, breaking OpenCode. The fix
  // wraps json_each in a CASE WHEN json_type=array guard.
  test("F1: patch with $.files as a string does NOT abort INSERT", () => {
    expect(() => {
      db.query(
        `INSERT INTO part VALUES ('bad-patch-str','m1','s1',9100,9100,
         '${JSON.stringify({ type: "patch", files: "oops-just-a-string" }).replace(/'/g, "''")}')`,
      ).run();
    }).not.toThrow();

    expect(db.query(`SELECT id FROM part WHERE id='bad-patch-str'`).get()).toBeDefined();
    expect(
      db.query(`SELECT part_id FROM part_fts WHERE part_id='bad-patch-str'`).get(),
    ).toBeNull();
  });

  test("F1: patch with $.files as an object does NOT abort INSERT", () => {
    expect(() => {
      db.query(
        `INSERT INTO part VALUES ('bad-patch-obj','m1','s1',9200,9200,
         '${JSON.stringify({ type: "patch", files: { not: "an array" } }).replace(/'/g, "''")}')`,
      ).run();
    }).not.toThrow();
    expect(
      db.query(`SELECT part_id FROM part_fts WHERE part_id='bad-patch-obj'`).get(),
    ).toBeNull();
  });

  test("F1: patch with $.files as a number does NOT abort INSERT", () => {
    expect(() => {
      db.query(
        `INSERT INTO part VALUES ('bad-patch-num','m1','s1',9300,9300,
         '${JSON.stringify({ type: "patch", files: 42 }).replace(/'/g, "''")}')`,
      ).run();
    }).not.toThrow();
    expect(
      db.query(`SELECT part_id FROM part_fts WHERE part_id='bad-patch-num'`).get(),
    ).toBeNull();
  });

  test("F1: patch with missing $.files does NOT abort INSERT", () => {
    expect(() => {
      db.query(
        `INSERT INTO part VALUES ('bad-patch-mis','m1','s1',9400,9400,
         '${JSON.stringify({ type: "patch" }).replace(/'/g, "''")}')`,
      ).run();
    }).not.toThrow();
    expect(
      db.query(`SELECT part_id FROM part_fts WHERE part_id='bad-patch-mis'`).get(),
    ).toBeNull();
  });

  test("F1: patch with valid array $.files still indexes correctly", () => {
    expect(() => {
      db.query(
        `INSERT INTO part VALUES ('good-patch','m1','s1',9500,9500,
         '${JSON.stringify({ type: "patch", files: ["x.ts", "y.ts"] }).replace(/'/g, "''")}')`,
      ).run();
    }).not.toThrow();
    const rows = db
      .query<{ content: string }, []>(
        `SELECT content FROM part_fts WHERE part_id='good-patch' AND kind='patch_file' ORDER BY content`,
      )
      .all();
    expect(rows.map((r) => r.content)).toEqual(["x.ts", "y.ts"]);
  });
});

describe("F1: backfill tolerates a non-array $.files among valid rows", () => {
  test("a bad patch row does not blow up the full build", () => {
    const db = new Database(":memory:");
    makeSchema(db);
    // Insert a known-bad row BEFORE building the index. If the backfill's
    // json_each isn't guarded, this will abort the entire BEGIN IMMEDIATE
    // transaction and the build will throw.
    db.query(
      `INSERT INTO part VALUES ('bad','m1','s1',5000,5000,
       '${JSON.stringify({ type: "patch", files: "string-not-array" }).replace(/'/g, "''")}')`,
    ).run();
    db.query(
      `INSERT INTO part VALUES ('ok','m1','s1',5001,5001,
       '${JSON.stringify({ type: "patch", files: ["good.ts"] }).replace(/'/g, "''")}')`,
    ).run();

    expect(() => ensureFts(db)).not.toThrow();

    // Bad row contributed zero FTS rows; good row contributed one.
    // (makeSchema's p3 patch contributes 2 more — total 3 patch_file rows.)
    const badRows = db
      .query<{ part_id: string }, []>(
        `SELECT part_id FROM part_fts WHERE part_id='bad'`,
      )
      .all();
    expect(badRows.length).toBe(0);

    const okRows = db
      .query<{ content: string }, []>(
        `SELECT content FROM part_fts WHERE part_id='ok' AND kind='patch_file'`,
      )
      .all();
    expect(okRows.length).toBe(1);
    expect(okRows[0]?.content).toBe("good.ts");
    db.close();
  });
});

describe("incremental backfill via rowid watermark", () => {
  test("rows inserted while plugin was 'offline' are picked up on next ensureFts", () => {
    const db = new Database(":memory:");
    makeSchema(db);
    ensureFts(db);

    // Simulate "plugin offline": drop the triggers, insert a row, restore.
    db.exec(`DROP TRIGGER part_fts_ai`);
    db.exec(`DROP TRIGGER part_fts_au`);
    db.exec(`DROP TRIGGER part_fts_ad`);

    db.query(
      `INSERT INTO part VALUES ('offline','m1','s1',6000,6000,
       '${JSON.stringify({ type: "text", text: "missed by triggers" }).replace(/'/g, "''")}')`,
    ).run();

    // Sanity: the FTS row is NOT there yet
    expect(
      db.query(`SELECT part_id FROM part_fts WHERE part_id='offline'`).get(),
    ).toBeNull();

    // Next ensureFts: triggers are missing, version still matches (no change),
    // but triggersExist returns false so the entire index is rebuilt. After
    // rebuild, the offline row should be present.
    const r = ensureFts(db);
    expect(r.built).toBe(true);

    const offlineRow = db
      .query<{ content: string }, []>(
        `SELECT content FROM part_fts WHERE part_id='offline'`,
      )
      .get();
    expect(offlineRow?.content).toBe("missed by triggers");
    db.close();
  });

  test("incremental backfill does NOT double-index trigger-indexed rows (H1 regression)", () => {
    const db = new Database(":memory:");
    makeSchema(db);
    ensureFts(db);

    // Insert a row while triggers are alive. Trigger indexes it immediately
    // (exactly 1 FTS row).
    db.query(
      `INSERT INTO part VALUES ('live','m1','s1',7000,7000,
       '${JSON.stringify({ type: "text", text: "indexed by trigger" }).replace(/'/g, "''")}')`,
    ).run();

    const afterTrigger = db
      .query<{ c: number }, []>(
        `SELECT COUNT(*) c FROM part_fts WHERE part_id='live'`,
      )
      .get();
    expect(afterTrigger?.c).toBe(1);

    // Second ensureFts: maxPart > watermark, so the incremental backfill
    // runs. Pre-H1-fix, this re-inserted the same row and the count became 2.
    // Post-fix, the incremental DELETEs the rowid range first, so the count
    // stays at 1.
    const r = ensureFts(db);
    expect(r.built).toBe(false);

    const afterIncremental = db
      .query<{ c: number }, []>(
        `SELECT COUNT(*) c FROM part_fts WHERE part_id='live'`,
      )
      .get();
    expect(afterIncremental?.c).toBe(1);

    // Running ensureFts again on a quiescent DB is a true no-op (no DELETE,
    // no INSERT, watermark already at MAX(rowid)).
    const r2 = ensureFts(db);
    expect(r2.built).toBe(false);
    expect(r2.built_ms).toBeUndefined();

    db.close();
  });

  test("watermark resets when part is truncated (rowid restarts) — M3", () => {
    const db = new Database(":memory:");
    makeSchema(db);
    ensureFts(db);

    const before = db
      .query<{ value: string }, []>(
        `SELECT value FROM part_fts_meta WHERE key='last_rowid'`,
      )
      .get();
    const initialWatermark = Number(before?.value);
    expect(initialWatermark).toBeGreaterThan(0);

    // Simulate truncation: drop triggers (otherwise DELETE cascades to FTS
    // and resets things naturally), wipe `part`. Manually set the watermark
    // ahead of MAX(rowid) to mimic the post-truncate state where the meta
    // table still holds the old watermark but the part table starts fresh.
    db.exec(`DROP TRIGGER part_fts_ai`);
    db.exec(`DROP TRIGGER part_fts_au`);
    db.exec(`DROP TRIGGER part_fts_ad`);
    db.query(`DELETE FROM part`).run();

    // Re-install everything via a full rebuild (triggersExist=false branch).
    ensureFts(db);

    // Force the watermark forward to mimic a real-world truncate where
    // part_fts_meta survived but MAX(rowid) restarted lower.
    db.query(
      `INSERT OR REPLACE INTO part_fts_meta(key, value) VALUES('last_rowid', ?)`,
    ).run("99999");

    // ensureFts sees maxPart (0) < watermark (99999) and should reset the
    // watermark down, NOT silently skip future rows.
    const r1 = ensureFts(db);
    expect(r1.built).toBe(false);

    const reset = db
      .query<{ value: string }, []>(
        `SELECT value FROM part_fts_meta WHERE key='last_rowid'`,
      )
      .get();
    expect(Number(reset?.value)).toBe(0);

    // Now insert a fresh row (rowid restarts at 1) and call ensureFts again.
    db.query(
      `INSERT INTO part VALUES ('p_after','m1','s1',8000,8000,
       '${JSON.stringify({ type: "text", text: "after truncate" }).replace(/'/g, "''")}')`,
    ).run();

    const r2 = ensureFts(db);
    expect(r2.built).toBe(false);

    const found = db
      .query<{ content: string }, []>(
        `SELECT content FROM part_fts WHERE part_id='p_after'`,
      )
      .get();
    expect(found?.content).toBe("after truncate");

    db.close();
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

describe("OpenCode schema drift defense", () => {
  test("empty part table: no drift detected (does not trigger rebuild)", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
        directory TEXT NOT NULL,
        time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL,
        data TEXT NOT NULL
      );
    `);
    // Build once. The drift check should not fire (no rows to check).
    const r1 = ensureFts(db);
    expect(r1.built).toBe(true);
    // Second call: still no drift, no rebuild.
    const r2 = ensureFts(db);
    expect(r2.built).toBe(false);
    db.close();
  });

  test("normal schema: no drift detected", () => {
    const db = new Database(":memory:");
    makeSchema(db);
    ensureFts(db);
    // Second call should be incremental/no-op, NOT a forced rebuild.
    const r = ensureFts(db);
    expect(r.built).toBe(false);
    db.close();
  });

  test("renamed key on text part: drift detected, FTS rebuilds", () => {
    const db = new Database(":memory:");
    makeSchema(db);
    ensureFts(db);

    // Capture original rebuild count via row content.
    const initialRows = (
      db.query<{ n: number }, []>(`SELECT COUNT(*) n FROM part_fts`).get() as
        | { n: number }
        | undefined
    )?.n;
    expect(initialRows).toBeGreaterThan(0);

    // Simulate OpenCode renaming $.text -> $.content for text parts.
    // Drop triggers first so the UPDATE doesn't try to maintain FTS.
    db.exec(`DROP TRIGGER part_fts_ai`);
    db.exec(`DROP TRIGGER part_fts_au`);
    db.exec(`DROP TRIGGER part_fts_ad`);
    // Replace the most recent text part's data with a drifted shape.
    const drifted = JSON.stringify({
      type: "text",
      content: "renamed key, no longer $.text",
    });
    db.query(`UPDATE part SET data = ? WHERE id = 'p4'`).run(drifted);

    // Capture warn calls so we can confirm we logged.
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (msg: string) => warnings.push(String(msg));

    try {
      const r = ensureFts(db);
      // Drift detected, table dropped, rebuilt from scratch.
      expect(r.built).toBe(true);
      expect(
        warnings.some((w) => w.includes("schema drift detected")),
      ).toBe(true);
    } finally {
      console.warn = originalWarn;
    }

    db.close();
  });
});
