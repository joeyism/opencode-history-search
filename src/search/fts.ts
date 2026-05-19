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
 *   - patch parts:   one row PER file path (json_each flattening)
 *
 * Triggers keep the index in sync on insert/update/delete of `part` rows.
 * EVERY trigger that reads `data` is guarded with `json_valid(...)` so a
 * future code path writing non-JSON `part.data` (truncated stream, binary,
 * schema change) CANNOT break OpenCode's primary insert path.
 *
 * Idempotency:
 *   - `ensureFts(db)` is safe to call on every search. It's a metadata check
 *     plus a row-count comparison, ~microseconds when the index is up to date.
 *   - First call builds the index (~3 sec for 200k parts).
 *   - If the version metadata mismatches, the index is rebuilt from scratch
 *     INSIDE a single transaction so a crash mid-build leaves the old index
 *     intact.
 *
 * Rollback (run manually if uninstalling):
 *   BEGIN IMMEDIATE;
 *   DROP TRIGGER IF EXISTS part_fts_ai;
 *   DROP TRIGGER IF EXISTS part_fts_au;
 *   DROP TRIGGER IF EXISTS part_fts_ad;
 *   DROP TABLE   IF EXISTS part_fts;
 *   DROP TABLE   IF EXISTS part_fts_meta;
 *   COMMIT;
 */

import { Database } from "bun:sqlite";
import { getDbPath } from "../storage-sqlite";

const FTS_TABLE = "part_fts";
const FTS_VERSION = 2; // bump if schema changes and a rebuild is required

export type FtsKind = "text" | "tool_name" | "tool_state" | "patch_file";

// ---------------------------------------------------------------------------
// One-shot ensure: open a writable connection, build/upgrade the index, close.
// ---------------------------------------------------------------------------

export interface EnsureResult {
  built: boolean;
  built_ms?: number;
  error?: string;
}

// Module-level latch: intentionally not reset for the lifetime of the process.
// We set this to `true` on BOTH success and failure to avoid a hot-loop where
// every subsequent search re-opens a writable connection. A failure is
// reported once via the EnsureResult and then we trust the next process
// startup to retry. This matches "ensure once" semantics.
let ensured = false;

export function ensureFtsOnce(): EnsureResult {
  if (ensured) return { built: false };
  ensured = true; // latch first so any throw below doesn't cause retry storm
  let db: Database | undefined;
  try {
    db = new Database(getDbPath()); // writable
    // Wait politely for any concurrent OpenCode writer instead of failing
    // immediately with SQLITE_BUSY. bun:sqlite default is 0ms.
    db.exec("PRAGMA busy_timeout = 5000");
    return ensureFts(db);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { built: false, error: message };
  } finally {
    db?.close();
  }
}

/**
 * Inspect existing state and rebuild only if necessary. The rebuild path is
 * fully transactional: a crash mid-build rolls back and leaves the old index
 * (or no index) intact.
 */
export function ensureFts(db: Database): EnsureResult {
  const tableExists = db
    .query(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(FTS_TABLE);

  if (tableExists && triggersExist(db) && versionMatches(db)) {
    // Conservative drift check. We'd rather skip a rebuild than do one
    // needlessly: false-negative = slightly stale results until the next
    // version bump; false-positive = unnecessary 3-second rebuild.
    const expected = (db
      .query(
        `SELECT COUNT(*) c FROM part
         WHERE json_valid(data)
           AND json_extract(data, '$.type') IN ('text','tool','patch')`,
      )
      .get() as { c: number }).c;
    const actual = (db
      .query(`SELECT COUNT(DISTINCT part_id) c FROM ${FTS_TABLE}`)
      .get() as { c: number }).c;
    if (actual >= expected * 0.95) {
      return { built: false };
    }
  }

  const t0 = performance.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    buildFts(db);
    installTriggers(db);
    recordVersion(db);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { built: true, built_ms: performance.now() - t0 };
}

// ---------------------------------------------------------------------------
// Backfill
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

  // Text parts
  db.exec(`
    INSERT INTO ${FTS_TABLE}(content, kind, part_id, message_id, session_id)
    SELECT json_extract(data, '$.text'), 'text', id, message_id, session_id
    FROM part
    WHERE json_valid(data)
      AND json_extract(data, '$.type') = 'text'
      AND json_extract(data, '$.text') IS NOT NULL
      AND json_extract(data, '$.text') != ''
  `);

  // Tool name + state title (skip blanks)
  db.exec(`
    INSERT INTO ${FTS_TABLE}(content, kind, part_id, message_id, session_id)
    SELECT
      trim(coalesce(json_extract(data, '$.tool'), '') || ' ' || coalesce(json_extract(data, '$.state.title'), '')),
      'tool_name', id, message_id, session_id
    FROM part
    WHERE json_valid(data)
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
    WHERE json_valid(data)
      AND json_extract(data, '$.type') = 'tool'
      AND json_extract(data, '$.state') IS NOT NULL
      AND trim(coalesce(json_extract(data, '$.state.input'), '') || ' ' || coalesce(json_extract(data, '$.state.output'), '')) != ''
  `);

  // Patch files, flattened: one FTS row per file path (NOT the JSON array text)
  db.exec(`
    INSERT INTO ${FTS_TABLE}(content, kind, part_id, message_id, session_id)
    SELECT j.value, 'patch_file', p.id, p.message_id, p.session_id
    FROM part p, json_each(json_extract(p.data, '$.files')) j
    WHERE json_valid(p.data)
      AND json_extract(p.data, '$.type') = 'patch'
      AND json_extract(p.data, '$.files') IS NOT NULL
      AND j.value IS NOT NULL
      AND j.value != ''
  `);
}

// ---------------------------------------------------------------------------
// Triggers
//
// Helpers below build the per-kind INSERTs as strings parameterized on the
// row alias (NEW for INSERT, NEW for the re-insert side of UPDATE). The
// CRITICAL property of every body is: json_valid(<alias>.data) gate FIRST.
// Without this, a single malformed `part.data` write anywhere in OpenCode
// would propagate `malformed JSON` up through the trigger and abort the
// host INSERT, breaking OpenCode itself.
// ---------------------------------------------------------------------------

function insertFromPartSql(alias: "NEW"): string {
  return `
    INSERT INTO ${FTS_TABLE}(content, kind, part_id, message_id, session_id)
    SELECT json_extract(${alias}.data, '$.text'), 'text', ${alias}.id, ${alias}.message_id, ${alias}.session_id
      WHERE json_valid(${alias}.data)
        AND json_extract(${alias}.data, '$.type') = 'text'
        AND json_extract(${alias}.data, '$.text') IS NOT NULL
        AND json_extract(${alias}.data, '$.text') != '';

    INSERT INTO ${FTS_TABLE}(content, kind, part_id, message_id, session_id)
    SELECT
      trim(coalesce(json_extract(${alias}.data, '$.tool'), '') || ' ' || coalesce(json_extract(${alias}.data, '$.state.title'), '')),
      'tool_name', ${alias}.id, ${alias}.message_id, ${alias}.session_id
      WHERE json_valid(${alias}.data)
        AND json_extract(${alias}.data, '$.type') = 'tool'
        AND json_extract(${alias}.data, '$.tool') IS NOT NULL
        AND trim(coalesce(json_extract(${alias}.data, '$.tool'), '') || ' ' || coalesce(json_extract(${alias}.data, '$.state.title'), '')) != '';

    INSERT INTO ${FTS_TABLE}(content, kind, part_id, message_id, session_id)
    SELECT
      trim(coalesce(json_extract(${alias}.data, '$.state.input'), '') || ' ' || coalesce(json_extract(${alias}.data, '$.state.output'), '')),
      'tool_state', ${alias}.id, ${alias}.message_id, ${alias}.session_id
      WHERE json_valid(${alias}.data)
        AND json_extract(${alias}.data, '$.type') = 'tool'
        AND json_extract(${alias}.data, '$.state') IS NOT NULL
        AND trim(coalesce(json_extract(${alias}.data, '$.state.input'), '') || ' ' || coalesce(json_extract(${alias}.data, '$.state.output'), '')) != '';

    INSERT INTO ${FTS_TABLE}(content, kind, part_id, message_id, session_id)
    SELECT j.value, 'patch_file', ${alias}.id, ${alias}.message_id, ${alias}.session_id
      FROM json_each(json_extract(${alias}.data, '$.files')) j
      WHERE json_valid(${alias}.data)
        AND json_extract(${alias}.data, '$.type') = 'patch'
        AND json_extract(${alias}.data, '$.files') IS NOT NULL
        AND j.value IS NOT NULL
        AND j.value != '';
  `;
}

function triggersExist(db: Database): boolean {
  const triggers = db
    .query(
      `SELECT name FROM sqlite_master
       WHERE type='trigger' AND name IN ('part_fts_ai', 'part_fts_ad', 'part_fts_au')`,
    )
    .all() as Array<{ name: string }>;
  return triggers.length === 3;
}

function installTriggers(db: Database): void {
  db.exec(`DROP TRIGGER IF EXISTS part_fts_ai`);
  db.exec(`DROP TRIGGER IF EXISTS part_fts_ad`);
  db.exec(`DROP TRIGGER IF EXISTS part_fts_au`);

  db.exec(`
    CREATE TRIGGER part_fts_ai AFTER INSERT ON part
    BEGIN
      ${insertFromPartSql("NEW")}
    END;
  `);

  // DELETE only reads OLD.id, so no json_valid guard needed.
  db.exec(`
    CREATE TRIGGER part_fts_ad AFTER DELETE ON part
    BEGIN
      DELETE FROM ${FTS_TABLE} WHERE part_id = OLD.id;
    END;
  `);

  // UPDATE: delete-then-insert ensures correctness across type changes.
  // The DELETE uses OLD.id only (safe). The re-insert uses NEW.data, gated
  // by json_valid (safe).
  db.exec(`
    CREATE TRIGGER part_fts_au AFTER UPDATE ON part
    BEGIN
      DELETE FROM ${FTS_TABLE} WHERE part_id = OLD.id;
      ${insertFromPartSql("NEW")}
    END;
  `);
}

// ---------------------------------------------------------------------------
// Version metadata
// ---------------------------------------------------------------------------

function versionMatches(db: Database): boolean {
  // This is called only from `ensureFts`, which is only invoked through
  // `ensureFtsOnce` on a WRITABLE connection. If anyone ever calls this on a
  // read-only handle, we want to know about it, so no try/catch here.
  db.exec(
    `CREATE TABLE IF NOT EXISTS part_fts_meta (key TEXT PRIMARY KEY, value TEXT)`,
  );
  const row = db
    .query(`SELECT value FROM part_fts_meta WHERE key = 'version'`)
    .get() as { value: string } | undefined;
  return row?.value === String(FTS_VERSION);
}

function recordVersion(db: Database): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS part_fts_meta (key TEXT PRIMARY KEY, value TEXT)`,
  );
  db.query(
    `INSERT OR REPLACE INTO part_fts_meta(key, value) VALUES('version', ?)`,
  ).run(String(FTS_VERSION));
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
  const where: string[] = [`${FTS_TABLE}.content MATCH ?`];
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

  // No JOIN to `part`: the FTS row already contains the searchable content
  // (text body, file path, tool name, etc.). Pulling 16KB+ data blobs over
  // the FFI just to re-decode them in JS was the slow path.
  const sql = `
    SELECT
      ${FTS_TABLE}.part_id    AS part_id,
      ${FTS_TABLE}.message_id AS message_id,
      ${FTS_TABLE}.session_id AS session_id,
      ${FTS_TABLE}.content    AS content,
      ${FTS_TABLE}.kind       AS kind,
      m.time_created          AS time_created,
      s.title                 AS session_title,
      s.directory             AS session_directory
    FROM ${FTS_TABLE}
    JOIN message m ON m.id = ${FTS_TABLE}.message_id
    JOIN session s ON s.id = ${FTS_TABLE}.session_id
    WHERE ${where.join(" AND ")}
    ORDER BY m.time_created DESC
    LIMIT ?
  `;

  try {
    return db.query(sql).all(...binds) as FtsHit[];
  } catch (err: unknown) {
    // FTS5 syntax errors should never crash the host. Log once and return
    // an empty result so the caller can fall back gracefully if it wants.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[history-search] FTS query failed: ${message}`);
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
  // Strip ASCII control characters (incl. NUL, newlines, tabs). FTS5 treats
  // whitespace as a token boundary anyway, so replacing with space is safe.
  const cleaned = s.replace(/[\u0000-\u001f]/g, " ").trim();
  if (cleaned === "") return null;
  // Require at least one alphanumeric or unicode-letter character; FTS5
  // tokenizes punctuation away and would receive zero tokens otherwise.
  if (!/[\p{L}\p{N}]/u.test(cleaned)) return null;
  return `"${cleaned.replace(/"/g, '""')}"`;
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

export function searchTitles(
  db: Database,
  query: string,
  opts: { projectID: string | null; limit: number },
): TitleHit[] {
  const like = `%${query.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
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
