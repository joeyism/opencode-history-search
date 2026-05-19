/**
 * SQLite FTS5 full-text index over part content.
 *
 * Schema:
 *   CREATE VIRTUAL TABLE part_fts USING fts5(
 *     content,             -- the searchable text
 *     kind        UNINDEXED, -- 'text' | 'tool_name' | 'tool_state' | 'patch_file'
 *     part_id     UNINDEXED,
 *     message_id  UNINDEXED,
 *     session_id  UNINDEXED,
 *     tokenize = 'unicode61 remove_diacritics 2'
 *   );
 *
 * One row per searchable extracted piece of content from a part:
 *   - text parts:    one row (the message text)
 *   - tool parts:    up to two rows (tool name + state input/output blob)
 *   - patch parts:   one row PER file path (json_each flattening, guarded
 *                    so a non-array $.files cannot abort OpenCode's INSERT)
 *
 * Triggers keep the index in sync on insert/update/delete of `part` rows.
 * EVERY trigger that reads `data` is guarded against malformed JSON in two
 * ways:
 *   1. `json_valid(NEW.data)` in the WHERE clause for `json_extract` callers.
 *   2. `json_each` is fed a `CASE WHEN json_type(...,'$.files')='array' THEN
 *      ... ELSE '[]' END` so a non-array `$.files` never reaches `json_each`
 *      (which throws `malformed JSON` and aborts the parent INSERT).
 *
 * Together these guarantee a future code path writing non-JSON or non-array
 * `part.data` (truncated stream, binary, schema change) CANNOT break
 * OpenCode's primary insert path.
 *
 * Idempotency:
 *   - `ensureFts(db)` is safe to call on every search. Fast path is a
 *     metadata check plus a rowid watermark comparison.
 *   - First call builds the index (~3 sec for 200k parts).
 *   - Subsequent calls do an incremental backfill of any part rows whose
 *     rowid is greater than the last-indexed watermark stored in
 *     `part_fts_meta`. This catches rows that older trigger versions skipped
 *     or that were inserted while this plugin wasn't loaded.
 *   - If the version metadata mismatches, the index is rebuilt from scratch
 *     INSIDE a single transaction so a crash mid-build leaves the old index
 *     intact.
 *
 * Rollback (run manually if uninstalling):
 *   PRAGMA busy_timeout = 15000;
 *   BEGIN IMMEDIATE;
 *     DROP TRIGGER IF EXISTS part_fts_ai;
 *     DROP TRIGGER IF EXISTS part_fts_au;
 *     DROP TRIGGER IF EXISTS part_fts_ad;
 *     DROP TABLE   IF EXISTS part_fts;
 *     DROP TABLE   IF EXISTS part_fts_tri;
 *     DROP TABLE   IF EXISTS part_fts_meta;
 *   COMMIT;
 *   -- VACUUM;  -- optional, reclaims ~550 MB on a 3.9 GB DB
 */

import { Database } from "bun:sqlite";
import { getDbPath } from "../storage-sqlite";

const FTS_TABLE = "part_fts";
const TRI_TABLE = "part_fts_tri";
// Bump when schema or trigger DDL changes. Forces a full rebuild on next
// `ensureFts` so users with stale indexes get the fix without manual action.
//   v1: initial single-text-only index (never shipped)
//   v2: text + tool_name + tool_state + patch_file (as JSON array text)
//   v3: patch_file flattened via json_each + CASE guard against non-array
//       $.files (F1 fix); also adds rowid watermark for incremental backfill
//   v4: H1 fix — incremental backfill DELETEs any existing FTS rows for the
//       range before re-inserting, so rows already indexed by a live trigger
//       don't end up duplicated. v3 indexes built between v3 ship and v4
//       fix are 2x bloated; the version bump triggers a clean rebuild.
//   v5: trigram FTS5 table (part_fts_tri) for fuzzy mode. Indexes only text
//       and tool_name content (tool_state JSON is too noisy + too big at
//       ~232 MB; patch paths use exact match). Replaces the O(n) in-memory
//       Fuse.js corpus rebuild that took 15+ seconds per fuzzy query.
const FTS_VERSION = 5;

// Busy timeout for the writable connection. Must comfortably exceed worst-case
// rebuild time so OpenCode writes don't fail with SQLITE_BUSY while we're
// rebuilding. Backfill at 200k parts is ~3s; 15s gives ~5x headroom.
const BUSY_TIMEOUT_MS = 15000;

// Retry an `ensureFtsOnce` failure after this long. Distinguishes transient
// failures (SQLITE_BUSY, SQLITE_LOCKED) from permanent ones (FTS5 not
// compiled, disk full, schema mismatch). For permanents we never retry.
const TRANSIENT_RETRY_MS = 60_000;

export type FtsKind = "text" | "tool_name" | "tool_state" | "patch_file";

// ---------------------------------------------------------------------------
// One-shot ensure: open a writable connection, build/upgrade the index, close.
// ---------------------------------------------------------------------------

export interface EnsureResult {
  built: boolean;
  built_ms?: number;
  error?: string;
  /** True if the error is transient (lock contention) and worth retrying. */
  transient?: boolean;
}

// Module-level latch. For PERMANENT failures we set this once and never
// retry — matches "ensure once" semantics. For TRANSIENT failures (lock
// contention against an active OpenCode writer) we allow one retry every
// TRANSIENT_RETRY_MS so a brief busy window doesn't degrade search for the
// rest of the process lifetime.
let ensuredAt: number | null = null;
let permanentFailure = false;

function isTransientSqliteError(err: unknown): boolean {
  // Prefer the structured error code over the localized message string.
  // bun:sqlite exposes `code` on SqliteError instances.
  const code = (err as { code?: string } | undefined)?.code;
  if (
    code === "SQLITE_BUSY" ||
    code === "SQLITE_LOCKED" ||
    code === "SQLITE_PROTOCOL"
  ) {
    return true;
  }
  // Fallback: not every transient surfaces here as an SqliteError; some throws
  // are bare Error instances. Match the message as a backstop.
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    message.includes("database is locked") ||
    message.includes("database table is locked") ||
    message.includes("sqlite_busy") ||
    message.includes("sqlite_locked")
  );
}

export function ensureFtsOnce(): EnsureResult {
  // Permanent failures: never retry.
  if (permanentFailure) return { built: false, error: "fts-permanently-disabled" };
  // Successful or recent-transient: short-circuit.
  if (ensuredAt !== null && Date.now() - ensuredAt < TRANSIENT_RETRY_MS) {
    return { built: false };
  }

  let db: Database | undefined;
  try {
    db = new Database(getDbPath()); // writable
    // Wait politely for any concurrent OpenCode writer instead of failing
    // immediately with SQLITE_BUSY. bun:sqlite default is 0ms.
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    const result = ensureFts(db);
    ensuredAt = Date.now();
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const transient = isTransientSqliteError(err);
    if (transient) {
      // Allow another attempt after TRANSIENT_RETRY_MS. Set ensuredAt so we
      // don't hot-loop on every search, but don't latch permanently.
      ensuredAt = Date.now();
    } else {
      permanentFailure = true;
    }
    return { built: false, error: message, transient };
  } finally {
    db?.close();
  }
}

/**
 * Cheap sanity check that OpenCode hasn't changed `part.data`'s JSON shape
 * out from under us. Samples the most recent row of each type we care about
 * (text/tool/patch) and verifies the JSON keys we depend on still exist.
 *
 * Returns null if everything looks normal (or if the table is empty).
 * Returns a short reason string if drift is detected.
 *
 * This is NOT a guarantee of correctness — OpenCode could change a value's
 * type without changing key presence, and we'd miss it. But it catches the
 * common cases (renamed keys, dropped fields, format swap) early enough to
 * surface a warning instead of silently degrading search.
 */
function detectSchemaDrift(db: Database): string | null {
  type Row = { data: string };

  // For each type we index, grab the most recent row. If none exist, that
  // type is just empty — not drift. If one exists but is missing required
  // keys, that's drift.
  const samples: Array<{ type: string; required: string[] }> = [
    { type: "text", required: ["$.text"] },
    { type: "tool", required: ["$.tool"] },
    { type: "patch", required: ["$.files"] },
  ];

  for (const { type, required } of samples) {
    const row = db
      .query<Row, string>(
        `SELECT data FROM part
         WHERE json_valid(data) AND json_extract(data, '$.type') = ?
         ORDER BY rowid DESC LIMIT 1`,
      )
      .get(type);
    if (!row) continue;
    for (const key of required) {
      // json_type returns NULL if the path doesn't exist. If a future
      // OpenCode version renames the key, this catches it.
      const present = (db
        .query<{ t: string | null }, [string, string]>(
          `SELECT json_type(?, ?) AS t`,
        )
        .get(row.data, key))?.t;
      if (present === null || present === undefined) {
        return `part type='${type}' missing expected key '${key}'`;
      }
    }
  }
  return null;
}

/**
 * Inspect existing state and rebuild only if necessary. The rebuild path is
 * fully transactional: a crash mid-build rolls back and leaves the old index
 * (or no index) intact.
 *
 * The fast path uses a rowid watermark stored in `part_fts_meta`. On every
 * call we check whether any part rows have been inserted past the watermark
 * and incrementally backfill them. This catches rows that older trigger
 * versions skipped or that were inserted while this plugin wasn't loaded.
 */
export function ensureFts(db: Database): EnsureResult {
  ensureMetaTable(db);

  // Defense against OpenCode schema drift on upgrade. If they ever change
  // the shape of part.data (rename $.text, switch to msgpack, etc.) our
  // triggers won't crash thanks to json_valid, but search results would go
  // silently stale. This check catches that early and forces a rebuild
  // (which won't help if the shape really changed, but it will surface the
  // problem loudly via the warn instead of silently degrading).
  const drift = detectSchemaDrift(db);
  if (drift) {
    console.warn(
      `[history-search] OpenCode schema drift detected (${drift}). ` +
        `Forcing FTS rebuild; if search results look wrong, update this plugin.`,
    );
    // Drop both FTS tables so the fast-path check below fails and we fall
    // through to the full rebuild branch.
    db.exec(`DROP TABLE IF EXISTS ${FTS_TABLE}`);
    db.exec(`DROP TABLE IF EXISTS ${TRI_TABLE}`);
  }

  const tableExists = db
    .query(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(FTS_TABLE);

  if (tableExists && triggersExist(db) && versionMatches(db)) {
    // Incremental backfill: index any part rows whose rowid is past the
    // watermark we recorded at last successful backfill. This is the
    // authoritative drift check — strictly correct, no fudge factor.
    const watermark = readWatermark(db);
    const maxPart = (db
      .query(`SELECT COALESCE(MAX(rowid), 0) AS r FROM part`)
      .get() as { r: number }).r;

    // M3: if `part` was truncated externally, rowid restarts at 1 and the
    // stored watermark is now in the future. Reset so we don't permanently
    // skip the first `watermark` rows of the new generation.
    if (maxPart < watermark) {
      writeWatermark(db, maxPart);
      return { built: false };
    }

    if (maxPart > watermark) {
      const t0 = performance.now();
      db.exec("BEGIN IMMEDIATE");
      try {
        // CRITICAL (H1): when triggers are live, every row inserted past the
        // watermark has already been indexed by `part_fts_ai`. If we just
        // re-run backfillRange we'd double-index every such row, growing the
        // index 2x per cycle (and the JS-layer dedup hides this until search
        // returns half as many distinct results as it should). Wipe any
        // existing FTS rows for the range first so backfill is idempotent.
        // Both tables (unicode61 + trigram).
        db.query(
          `DELETE FROM ${FTS_TABLE}
           WHERE part_id IN (SELECT id FROM part WHERE rowid >= ?)`,
        ).run(watermark + 1);
        db.query(
          `DELETE FROM ${TRI_TABLE}
           WHERE part_id IN (SELECT id FROM part WHERE rowid >= ?)`,
        ).run(watermark + 1);
        backfillRange(db, watermark + 1);
        writeWatermark(db, maxPart);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return { built: false, built_ms: performance.now() - t0 };
    }
    return { built: false };
  }

  const t0 = performance.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    buildFts(db);
    installTriggers(db);
    const maxPart = (db
      .query(`SELECT COALESCE(MAX(rowid), 0) AS r FROM part`)
      .get() as { r: number }).r;
    writeWatermark(db, maxPart);
    recordVersion(db);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { built: true, built_ms: performance.now() - t0 };
}

// ---------------------------------------------------------------------------
// Backfill (full + incremental share the same WHERE shape)
// ---------------------------------------------------------------------------

function buildFts(db: Database): void {
  db.exec(`DROP TABLE IF EXISTS ${FTS_TABLE}`);
  db.exec(`
    CREATE VIRTUAL TABLE ${FTS_TABLE} USING fts5(
      content,
      kind UNINDEXED,
      part_id UNINDEXED,
      message_id UNINDEXED,
      session_id UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);
  // Trigram index for fuzzy/substring matches. Only indexes text and
  // tool_name (tool_state is ~232 MB and too noisy for fuzzy; patch paths
  // are matched exactly via the unicode61 index above).
  db.exec(`DROP TABLE IF EXISTS ${TRI_TABLE}`);
  db.exec(`
    CREATE VIRTUAL TABLE ${TRI_TABLE} USING fts5(
      content,
      kind UNINDEXED,
      part_id UNINDEXED,
      message_id UNINDEXED,
      session_id UNINDEXED,
      tokenize = 'trigram'
    );
  `);
  backfillRange(db, 0);
}

/**
 * Index part rows whose rowid is >= `startRowid`. Used by both the full
 * build (startRowid=0) and the incremental top-up (startRowid=watermark+1).
 *
 * Note on patch_file:
 *   `json_each` aborts with `malformed JSON` if its argument isn't an array
 *   or NULL. A patch row with `files: "string"` would kill the backfill.
 *   We use `CASE WHEN json_type(...,'$.files')='array' THEN ... ELSE '[]'
 *   END` so non-array values become an empty array (zero FTS rows, no
 *   error). Same guard mirrored in the triggers.
 */
function backfillRange(db: Database, startRowid: number): void {
  // Text parts — populate BOTH the unicode61 (keyword) and trigram (fuzzy)
  // indexes from the same source rows.
  db.exec(`
    INSERT INTO ${FTS_TABLE}(content, kind, part_id, message_id, session_id)
    SELECT json_extract(data, '$.text'), 'text', id, message_id, session_id
    FROM part
    WHERE rowid >= ${startRowid}
      AND json_valid(data)
      AND json_extract(data, '$.type') = 'text'
      AND json_extract(data, '$.text') IS NOT NULL
      AND json_extract(data, '$.text') != ''
  `);
  db.exec(`
    INSERT INTO ${TRI_TABLE}(content, kind, part_id, message_id, session_id)
    SELECT json_extract(data, '$.text'), 'text', id, message_id, session_id
    FROM part
    WHERE rowid >= ${startRowid}
      AND json_valid(data)
      AND json_extract(data, '$.type') = 'text'
      AND json_extract(data, '$.text') IS NOT NULL
      AND json_extract(data, '$.text') != ''
  `);

  // Tool name + state title (skip blanks) — also indexed in both for
  // fuzzy "find that tool I half-remember".
  db.exec(`
    INSERT INTO ${FTS_TABLE}(content, kind, part_id, message_id, session_id)
    SELECT
      trim(coalesce(json_extract(data, '$.tool'), '') || ' ' || coalesce(json_extract(data, '$.state.title'), '')),
      'tool_name', id, message_id, session_id
    FROM part
    WHERE rowid >= ${startRowid}
      AND json_valid(data)
      AND json_extract(data, '$.type') = 'tool'
      AND json_extract(data, '$.tool') IS NOT NULL
      AND trim(coalesce(json_extract(data, '$.tool'), '') || ' ' || coalesce(json_extract(data, '$.state.title'), '')) != ''
  `);
  db.exec(`
    INSERT INTO ${TRI_TABLE}(content, kind, part_id, message_id, session_id)
    SELECT
      trim(coalesce(json_extract(data, '$.tool'), '') || ' ' || coalesce(json_extract(data, '$.state.title'), '')),
      'tool_name', id, message_id, session_id
    FROM part
    WHERE rowid >= ${startRowid}
      AND json_valid(data)
      AND json_extract(data, '$.type') = 'tool'
      AND json_extract(data, '$.tool') IS NOT NULL
      AND trim(coalesce(json_extract(data, '$.tool'), '') || ' ' || coalesce(json_extract(data, '$.state.title'), '')) != ''
  `);

  // Tool state input + output as one blob
  db.exec(`
    INSERT INTO ${FTS_TABLE}(content, kind, part_id, message_id, session_id)
    SELECT
      trim(coalesce(json_extract(data, '$.state.input'), '') || ' ' || coalesce(json_extract(data, '$.state.output'), '')),
      'tool_state', id, message_id, session_id
    FROM part
    WHERE rowid >= ${startRowid}
      AND json_valid(data)
      AND json_extract(data, '$.type') = 'tool'
      AND json_extract(data, '$.state') IS NOT NULL
      AND trim(coalesce(json_extract(data, '$.state.input'), '') || ' ' || coalesce(json_extract(data, '$.state.output'), '')) != ''
  `);

  // Patch files, flattened: one FTS row per file path. We pre-filter to
  // valid patch rows with array-typed $.files in a subquery so json_each
  // never sees a row it would crash on. The CASE wrapper is the F1 audit
  // fix — without it, a patch row with non-array $.files would abort
  // OpenCode's INSERT through the trigger.
  db.exec(`
    INSERT INTO ${FTS_TABLE}(content, kind, part_id, message_id, session_id)
    SELECT j.value, 'patch_file', p.id, p.message_id, p.session_id
    FROM (
      SELECT id, message_id, session_id, json_extract(data, '$.files') AS files
      FROM part
      WHERE rowid >= ${startRowid}
        AND json_valid(data)
        AND json_extract(data, '$.type') = 'patch'
        AND json_type(data, '$.files') = 'array'
    ) p, json_each(p.files) j
    WHERE j.value IS NOT NULL
      AND j.value != ''
  `);
}

// ---------------------------------------------------------------------------
// Triggers
//
// Helpers below build the per-kind INSERTs as strings parameterized on the
// row alias (always NEW). The CRITICAL property of every body:
//   - json_valid(NEW.data) gates every json_extract caller (F1's textual
//     siblings)
//   - json_each is wrapped in a CASE WHEN json_type(...,'$.files')='array'
//     so a non-array $.files never reaches json_each (F1 fix)
// Without these, a single malformed `part.data` write anywhere in OpenCode
// would propagate `malformed JSON` up through the trigger and abort the
// host INSERT, breaking OpenCode itself.
// ---------------------------------------------------------------------------

const EXPECTED_TRIGGERS = ["part_fts_ai", "part_fts_ad", "part_fts_au"] as const;

function insertFromPartSql(): string {
  // Mirror every NEW row into both indexes. The trigram index gets text +
  // tool_name only (smaller content for fuzzy); the unicode61 index gets
  // all four kinds (keyword search has different needs).
  return `
    -- text: both tables
    INSERT INTO ${FTS_TABLE}(content, kind, part_id, message_id, session_id)
    SELECT json_extract(NEW.data, '$.text'), 'text', NEW.id, NEW.message_id, NEW.session_id
      WHERE json_valid(NEW.data)
        AND json_extract(NEW.data, '$.type') = 'text'
        AND json_extract(NEW.data, '$.text') IS NOT NULL
        AND json_extract(NEW.data, '$.text') != '';
    INSERT INTO ${TRI_TABLE}(content, kind, part_id, message_id, session_id)
    SELECT json_extract(NEW.data, '$.text'), 'text', NEW.id, NEW.message_id, NEW.session_id
      WHERE json_valid(NEW.data)
        AND json_extract(NEW.data, '$.type') = 'text'
        AND json_extract(NEW.data, '$.text') IS NOT NULL
        AND json_extract(NEW.data, '$.text') != '';

    -- tool_name: both tables
    INSERT INTO ${FTS_TABLE}(content, kind, part_id, message_id, session_id)
    SELECT
      trim(coalesce(json_extract(NEW.data, '$.tool'), '') || ' ' || coalesce(json_extract(NEW.data, '$.state.title'), '')),
      'tool_name', NEW.id, NEW.message_id, NEW.session_id
      WHERE json_valid(NEW.data)
        AND json_extract(NEW.data, '$.type') = 'tool'
        AND json_extract(NEW.data, '$.tool') IS NOT NULL
        AND trim(coalesce(json_extract(NEW.data, '$.tool'), '') || ' ' || coalesce(json_extract(NEW.data, '$.state.title'), '')) != '';
    INSERT INTO ${TRI_TABLE}(content, kind, part_id, message_id, session_id)
    SELECT
      trim(coalesce(json_extract(NEW.data, '$.tool'), '') || ' ' || coalesce(json_extract(NEW.data, '$.state.title'), '')),
      'tool_name', NEW.id, NEW.message_id, NEW.session_id
      WHERE json_valid(NEW.data)
        AND json_extract(NEW.data, '$.type') = 'tool'
        AND json_extract(NEW.data, '$.tool') IS NOT NULL
        AND trim(coalesce(json_extract(NEW.data, '$.tool'), '') || ' ' || coalesce(json_extract(NEW.data, '$.state.title'), '')) != '';

    -- tool_state: unicode61 only (too big + too noisy for fuzzy)
    INSERT INTO ${FTS_TABLE}(content, kind, part_id, message_id, session_id)
    SELECT
      trim(coalesce(json_extract(NEW.data, '$.state.input'), '') || ' ' || coalesce(json_extract(NEW.data, '$.state.output'), '')),
      'tool_state', NEW.id, NEW.message_id, NEW.session_id
      WHERE json_valid(NEW.data)
        AND json_extract(NEW.data, '$.type') = 'tool'
        AND json_extract(NEW.data, '$.state') IS NOT NULL
        AND trim(coalesce(json_extract(NEW.data, '$.state.input'), '') || ' ' || coalesce(json_extract(NEW.data, '$.state.output'), '')) != '';

    -- patch_file: unicode61 only (exact path match, fuzzy doesn't help)
    INSERT INTO ${FTS_TABLE}(content, kind, part_id, message_id, session_id)
    SELECT j.value, 'patch_file', NEW.id, NEW.message_id, NEW.session_id
      FROM json_each(
        CASE
          WHEN json_valid(NEW.data)
           AND json_extract(NEW.data, '$.type') = 'patch'
           AND json_type(NEW.data, '$.files') = 'array'
          THEN json_extract(NEW.data, '$.files')
          ELSE '[]'
        END
      ) j
      WHERE j.value IS NOT NULL
        AND j.value != '';
  `;
}

function triggersExist(db: Database): boolean {
  const placeholders = EXPECTED_TRIGGERS.map(() => "?").join(",");
  const rows = db
    .query<{ name: string }, string[]>(
      `SELECT name FROM sqlite_master WHERE type='trigger' AND name IN (${placeholders})`,
    )
    .all(...EXPECTED_TRIGGERS);
  return rows.length === EXPECTED_TRIGGERS.length;
}

function installTriggers(db: Database): void {
  for (const name of EXPECTED_TRIGGERS) {
    db.exec(`DROP TRIGGER IF EXISTS ${name}`);
  }

  db.exec(`
    CREATE TRIGGER part_fts_ai AFTER INSERT ON part
    BEGIN
      ${insertFromPartSql()}
    END;
  `);

  // DELETE only reads OLD.id, so no json_valid guard needed. Clear both
  // tables; either may have rows for this part.
  db.exec(`
    CREATE TRIGGER part_fts_ad AFTER DELETE ON part
    BEGIN
      DELETE FROM ${FTS_TABLE} WHERE part_id = OLD.id;
      DELETE FROM ${TRI_TABLE} WHERE part_id = OLD.id;
    END;
  `);

  // UPDATE: delete-then-insert ensures correctness across type changes.
  // The DELETE uses OLD.id only (safe). The re-insert uses NEW.data, gated
  // by json_valid + json_type='array' (safe). Both tables touched.
  db.exec(`
    CREATE TRIGGER part_fts_au AFTER UPDATE ON part
    BEGIN
      DELETE FROM ${FTS_TABLE} WHERE part_id = OLD.id;
      DELETE FROM ${TRI_TABLE} WHERE part_id = OLD.id;
      ${insertFromPartSql()}
    END;
  `);
}

// ---------------------------------------------------------------------------
// Version + watermark metadata
// ---------------------------------------------------------------------------

function ensureMetaTable(db: Database): void {
  // Called only on the writable connection in `ensureFtsOnce`. Read-only
  // callers will throw SQLITE_READONLY here, which is the intended failure
  // mode (we want it loud, not silent).
  db.exec(
    `CREATE TABLE IF NOT EXISTS part_fts_meta (key TEXT PRIMARY KEY, value TEXT)`,
  );
}

function versionMatches(db: Database): boolean {
  const row = db
    .query(`SELECT value FROM part_fts_meta WHERE key = 'version'`)
    .get() as { value: string } | undefined;
  return row?.value === String(FTS_VERSION);
}

function recordVersion(db: Database): void {
  db.query(
    `INSERT OR REPLACE INTO part_fts_meta(key, value) VALUES('version', ?)`,
  ).run(String(FTS_VERSION));
}

function readWatermark(db: Database): number {
  const row = db
    .query(`SELECT value FROM part_fts_meta WHERE key = 'last_rowid'`)
    .get() as { value: string } | undefined;
  return row ? Number(row.value) : 0;
}

function writeWatermark(db: Database, rowid: number): void {
  db.query(
    `INSERT OR REPLACE INTO part_fts_meta(key, value) VALUES('last_rowid', ?)`,
  ).run(String(rowid));
}

// ---------------------------------------------------------------------------
// Query API
// ---------------------------------------------------------------------------

export interface FtsHit {
  part_id: string;
  message_id: string;
  session_id: string;
  content: string; // the FTS-indexed snippet (text body, file path, tool name, etc.)
  kind: FtsKind;
  time_created: number;
  session_title: string;
  session_directory: string;
}

export interface FtsQueryOptions {
  projectID: string | null;
  role?: "user" | "assistant";
  startTime?: number; // ms epoch, inclusive
  endTime?: number; // ms epoch, inclusive
  limit: number;
}

type Bind = string | number | bigint | null;

// One-time warn latch for searchFts errors. FTS5 syntax errors shouldn't
// crash the host, but we also don't want to spam logs if a malformed query
// comes through repeatedly.
let warnedQueryError = false;

/**
 * Run an FTS5 MATCH query against indexed part content, joined back to
 * message and session so we have everything needed to format a SearchMatch.
 *
 * Callers MUST wrap user input with `escapeFtsPhrase` so FTS5 treats it as
 * a literal phrase rather than an operator expression (AND, OR, NEAR, parens).
 *
 * Any FTS5 syntax error or other SqliteError is caught and translated to an
 * empty result set so a weird query never crashes the host plugin.
 */
export function searchFts(
  db: Database,
  query: string,
  opts: FtsQueryOptions,
): FtsHit[] {
  return runFtsQuery(db, FTS_TABLE, query, opts);
}

/**
 * Run an FTS5 MATCH query against the trigram index. Use this for
 * substring-tolerant and typo-tolerant matching (fuzzy mode). The trigram
 * index only covers `text` and `tool_name` kinds; tool_state and patch_file
 * are not indexed there.
 *
 * Caller still wraps with `escapeFtsPhrase` so FTS5 treats input as a phrase.
 */
export function searchFtsTrigram(
  db: Database,
  query: string,
  opts: FtsQueryOptions,
): FtsHit[] {
  return runFtsQuery(db, TRI_TABLE, query, opts);
}

// Constrain to the two module-private FTS table names so the only callers
// of this helper are searchFts / searchFtsTrigram. Direct interpolation of
// `table` into the SELECT is safe because the type prevents any other value.
type FtsTable = typeof FTS_TABLE | typeof TRI_TABLE;

function runFtsQuery(
  db: Database,
  table: FtsTable,
  query: string,
  opts: FtsQueryOptions,
): FtsHit[] {
  const where: string[] = [`${table}.content MATCH ?`];
  const binds: Bind[] = [query];

  if (opts.projectID) {
    where.push("s.project_id = ?");
    binds.push(opts.projectID);
  }
  if (opts.role) {
    where.push("json_extract(m.data, '$.role') = ?");
    binds.push(opts.role);
  }
  if (opts.startTime !== undefined) {
    where.push("m.time_created >= ?");
    binds.push(opts.startTime);
  }
  if (opts.endTime !== undefined) {
    where.push("m.time_created <= ?");
    binds.push(opts.endTime);
  }
  binds.push(opts.limit);

  // No JOIN to `part`: the FTS row already contains the searchable content.
  const sql = `
    SELECT
      ${table}.part_id    AS part_id,
      ${table}.message_id AS message_id,
      ${table}.session_id AS session_id,
      ${table}.content    AS content,
      ${table}.kind       AS kind,
      m.time_created      AS time_created,
      s.title             AS session_title,
      s.directory         AS session_directory
    FROM ${table}
    JOIN message m ON m.id = ${table}.message_id
    JOIN session s ON s.id = ${table}.session_id
    WHERE ${where.join(" AND ")}
    ORDER BY m.time_created DESC
    LIMIT ?
  `;

  try {
    return db.query(sql).all(...binds) as FtsHit[];
  } catch (err: unknown) {
    if (!warnedQueryError) {
      warnedQueryError = true;
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[history-search] FTS query failed (${table}): ${message}`);
    }
    return [];
  }
}

/**
 * Wrap a user-provided string so FTS5 treats it as a literal phrase, not an
 * operator expression. Returns null if the input has no tokenizable content
 * (empty, whitespace-only, all-punctuation) so callers can short-circuit.
 *
 * FTS5 phrase syntax: double-quoted, with embedded double-quotes escaped
 * by doubling. Control characters are stripped (they truncate or syntax-error
 * inside the FTS5 parser).
 */
export function escapeFtsPhrase(s: string): string | null {
  const cleaned = sanitizeQuery(s);
  if (cleaned === null) return null;
  return `"${cleaned.replace(/"/g, '""')}"`;
}

/**
 * Strip ASCII control characters (incl. NUL, newlines, tabs) and trim
 * whitespace. Returns null if the input has no tokenizable content
 * (empty, whitespace-only, all-punctuation). Shared by FTS phrase escape
 * and LIKE-based title search so both paths sanitize identically.
 */
export function sanitizeQuery(s: string): string | null {
  const cleaned = s.replace(/[\u0000-\u001f]/g, " ").trim();
  if (cleaned === "") return null;
  // Require at least one alphanumeric or unicode-letter character; FTS5
  // tokenizes punctuation away and would receive zero tokens otherwise.
  // Also keeps LIKE searches from returning the entire table on '%' input.
  if (!/[\p{L}\p{N}]/u.test(cleaned)) return null;
  return cleaned;
}

// ---------------------------------------------------------------------------
// Title search (FTS doesn't help — titles are short, sessions are indexed)
// ---------------------------------------------------------------------------

export interface TitleHit {
  id: string;
  title: string;
  directory: string;
  time_updated: number;
}

/**
 * Return session-title hits for `query` via LIKE on session.title.
 *
 * Returns `[]` when `query` has no tokenizable content (empty, whitespace,
 * all-punctuation). This matches `escapeFtsPhrase`'s null-return contract
 * and prevents a stray `LIKE '%%'` from scanning every session. Callers
 * that need fallback semantics for non-tokenizable input should detect the
 * empty array and route to the row-scan path themselves.
 */
export function searchTitles(
  db: Database,
  query: string,
  opts: { projectID: string | null; limit: number },
): TitleHit[] {
  // Share the sanitize step with the FTS path so control chars and
  // pathological inputs can't slip through here.
  const cleaned = sanitizeQuery(query);
  if (cleaned === null) return [];

  const like = `%${cleaned.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  const sql = `
    SELECT id, title, directory, time_updated
    FROM session
    WHERE title LIKE ? ESCAPE '\\'
      ${opts.projectID ? "AND project_id = ?" : ""}
    ORDER BY time_updated DESC
    LIMIT ?
  `;
  const binds: Bind[] = [like];
  if (opts.projectID) binds.push(opts.projectID);
  binds.push(opts.limit);
  return db.query(sql).all(...binds) as TitleHit[];
}
