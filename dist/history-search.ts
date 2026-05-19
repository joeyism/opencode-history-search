// @bun
var __require = import.meta.require;

// src/index.ts
import { tool } from "@opencode-ai/plugin";

// src/storage-sqlite.ts
import { Database } from "bun:sqlite";
import path from "path";
import os from "os";
function getDbPath() {
  const xdgData = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(xdgData, "opencode", "opencode.db");
}
function dbExists() {
  return Bun.file(getDbPath()).size > 0;
}
function openDb() {
  return new Database(getDbPath(), { readonly: true });
}
async function withDb(fn) {
  const db = openDb();
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}
function listSessionRowsSync(db, projectID) {
  const rows = projectID ? db.query(`SELECT id, project_id, title, directory, time_created, time_updated
             FROM session WHERE project_id = ?
             ORDER BY time_updated DESC`).all(projectID) : db.query(`SELECT id, project_id, title, directory, time_created, time_updated
             FROM session
             ORDER BY time_updated DESC`).all();
  return rows.map((row) => ({
    id: row.id,
    projectID: row.project_id,
    title: row.title,
    directory: row.directory,
    time: { created: row.time_created, updated: row.time_updated }
  }));
}
function listMessageRowsSync(db, sessionID, role) {
  const rows = db.query(`SELECT id, session_id, time_created, data
       FROM message WHERE session_id = ?
       ORDER BY time_created ASC`).all(sessionID);
  const out = [];
  for (const row of rows) {
    const data = JSON.parse(row.data);
    if (role && data.role !== role)
      continue;
    out.push({
      id: row.id,
      sessionID: row.session_id,
      role: data.role,
      agent: data.agent || "",
      time: { created: row.time_created }
    });
  }
  return out;
}
function listPartRowsSync(db, messageID) {
  const rows = db.query(`SELECT id, message_id, session_id, data
       FROM part WHERE message_id = ?
       ORDER BY time_created ASC`).all(messageID);
  const out = [];
  for (const row of rows) {
    const part = decodePart(row);
    if (part)
      out.push(part);
  }
  return out;
}
function isSearchableType(t) {
  return t === "text" || t === "tool" || t === "file" || t === "patch";
}
function decodePart(row) {
  let parsed;
  try {
    parsed = JSON.parse(row.data);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null)
    return null;
  const raw = parsed;
  if (!isSearchableType(raw.type))
    return null;
  const data = raw;
  const part = {
    id: row.id,
    messageID: row.message_id,
    sessionID: row.session_id,
    type: data.type
  };
  if (data.type === "text") {
    part.text = data.text;
  } else if (data.type === "tool") {
    part.tool = data.tool;
    part.state = data.state;
  } else if (data.type === "patch") {
    part.files = data.files;
  }
  return part;
}
async function* listSessionsSqlite(projectID, db) {
  const shouldClose = db === undefined;
  const _db = db ?? openDb();
  try {
    for (const session of listSessionRowsSync(_db, projectID)) {
      yield session;
    }
  } finally {
    if (shouldClose)
      _db.close();
  }
}
async function* listMessagesSqlite(sessionID, role, db) {
  const shouldClose = db === undefined;
  const _db = db ?? openDb();
  try {
    for (const message of listMessageRowsSync(_db, sessionID, role)) {
      yield message;
    }
  } finally {
    if (shouldClose)
      _db.close();
  }
}
async function* listPartsSqlite(messageID, db) {
  const shouldClose = db === undefined;
  const _db = db ?? openDb();
  try {
    for (const part of listPartRowsSync(_db, messageID)) {
      yield part;
    }
  } finally {
    if (shouldClose)
      _db.close();
  }
}

// src/storage.ts
import path2 from "path";
import os2 from "os";
import fs from "fs";
var {Glob } = globalThis.Bun;
async function getStorageDir() {
  const xdgData = process.env.XDG_DATA_HOME || path2.join(os2.homedir(), ".local", "share");
  return path2.join(xdgData, "opencode", "storage");
}
async function getCurrentProjectID() {
  const proc = Bun.spawn(["git", "rev-list", "--max-parents=0", "--all"], {
    stdout: "pipe",
    stderr: "pipe"
  });
  const output = await new Response(proc.stdout).text();
  const commits = output.split(`
`).filter(Boolean).sort();
  return commits[0] || "global";
}
async function* listSessions(projectID) {
  const storageDir = await getStorageDir();
  const sessionDir = path2.join(storageDir, "session");
  if (projectID !== null) {
    const projectDir = path2.join(sessionDir, projectID);
    try {
      for await (const file of new Glob("*.json").scan({ cwd: projectDir })) {
        try {
          const content = await Bun.file(path2.join(projectDir, file)).json();
          yield content;
        } catch {
          continue;
        }
      }
    } catch {
      return;
    }
    return;
  }
  let entries;
  try {
    entries = fs.readdirSync(sessionDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const projectDir = path2.join(sessionDir, entry);
    let stat;
    try {
      stat = fs.statSync(projectDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory())
      continue;
    try {
      for await (const file of new Glob("*.json").scan({ cwd: projectDir })) {
        try {
          const content = await Bun.file(path2.join(projectDir, file)).json();
          yield content;
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }
}
async function* listMessages(sessionID, role) {
  const storageDir = await getStorageDir();
  const messageDir = path2.join(storageDir, "message", sessionID.trim());
  try {
    for await (const file of new Glob("*.json").scan({ cwd: messageDir })) {
      try {
        const content = await Bun.file(path2.join(messageDir, file)).json();
        if (role && content.role !== role)
          continue;
        yield content;
      } catch {
        continue;
      }
    }
  } catch {
    return;
  }
}
async function* listParts(messageID) {
  const storageDir = await getStorageDir();
  const partDir = path2.join(storageDir, "part", messageID.trim());
  try {
    for await (const file of new Glob("*.json").scan({ cwd: partDir })) {
      try {
        const content = await Bun.file(path2.join(partDir, file)).json();
        yield content;
      } catch {
        continue;
      }
    }
  } catch {
    return;
  }
}

// src/search/fts.ts
import { Database as Database2 } from "bun:sqlite";
var FTS_TABLE = "part_fts";
var TRI_TABLE = "part_fts_tri";
var FTS_VERSION = 5;
var BUSY_TIMEOUT_MS = 15000;
var TRANSIENT_RETRY_MS = 60000;
var ensuredAt = null;
var permanentFailure = false;
function isTransientSqliteError(err) {
  const code = err?.code;
  if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" || code === "SQLITE_PROTOCOL") {
    return true;
  }
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return message.includes("database is locked") || message.includes("database table is locked") || message.includes("sqlite_busy") || message.includes("sqlite_locked");
}
function ensureFtsOnce() {
  if (permanentFailure)
    return { built: false, error: "fts-permanently-disabled" };
  if (ensuredAt !== null && Date.now() - ensuredAt < TRANSIENT_RETRY_MS) {
    return { built: false };
  }
  let db;
  try {
    db = new Database2(getDbPath());
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    const result = ensureFts(db);
    ensuredAt = Date.now();
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const transient = isTransientSqliteError(err);
    if (transient) {
      ensuredAt = Date.now();
    } else {
      permanentFailure = true;
    }
    return { built: false, error: message, transient };
  } finally {
    db?.close();
  }
}
function detectSchemaDrift(db) {
  const samples = [
    { type: "text", required: ["$.text"] },
    { type: "tool", required: ["$.tool"] },
    { type: "patch", required: ["$.files"] }
  ];
  for (const { type, required } of samples) {
    const row = db.query(`SELECT data FROM part
         WHERE json_valid(data) AND json_extract(data, '$.type') = ?
         ORDER BY rowid DESC LIMIT 1`).get(type);
    if (!row)
      continue;
    for (const key of required) {
      const present = db.query(`SELECT json_type(?, ?) AS t`).get(row.data, key)?.t;
      if (present === null || present === undefined) {
        return `part type='${type}' missing expected key '${key}'`;
      }
    }
  }
  return null;
}
function ensureFts(db) {
  ensureMetaTable(db);
  const drift = detectSchemaDrift(db);
  if (drift) {
    console.warn(`[history-search] OpenCode schema drift detected (${drift}). ` + `Forcing FTS rebuild; if search results look wrong, update this plugin.`);
    db.exec(`DROP TABLE IF EXISTS ${FTS_TABLE}`);
    db.exec(`DROP TABLE IF EXISTS ${TRI_TABLE}`);
  }
  const tableExists = db.query(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(FTS_TABLE);
  if (tableExists && triggersExist(db) && versionMatches(db)) {
    const watermark = readWatermark(db);
    const maxPart = db.query(`SELECT COALESCE(MAX(rowid), 0) AS r FROM part`).get().r;
    if (maxPart < watermark) {
      writeWatermark(db, maxPart);
      return { built: false };
    }
    if (maxPart > watermark) {
      const t02 = performance.now();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.query(`DELETE FROM ${FTS_TABLE}
           WHERE part_id IN (SELECT id FROM part WHERE rowid >= ?)`).run(watermark + 1);
        db.query(`DELETE FROM ${TRI_TABLE}
           WHERE part_id IN (SELECT id FROM part WHERE rowid >= ?)`).run(watermark + 1);
        backfillRange(db, watermark + 1);
        writeWatermark(db, maxPart);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return { built: false, built_ms: performance.now() - t02 };
    }
    return { built: false };
  }
  const t0 = performance.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    buildFts(db);
    installTriggers(db);
    const maxPart = db.query(`SELECT COALESCE(MAX(rowid), 0) AS r FROM part`).get().r;
    writeWatermark(db, maxPart);
    recordVersion(db);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { built: true, built_ms: performance.now() - t0 };
}
function buildFts(db) {
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
function backfillRange(db, startRowid) {
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
var EXPECTED_TRIGGERS = ["part_fts_ai", "part_fts_ad", "part_fts_au"];
function insertFromPartSql() {
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
function triggersExist(db) {
  const placeholders = EXPECTED_TRIGGERS.map(() => "?").join(",");
  const rows = db.query(`SELECT name FROM sqlite_master WHERE type='trigger' AND name IN (${placeholders})`).all(...EXPECTED_TRIGGERS);
  return rows.length === EXPECTED_TRIGGERS.length;
}
function installTriggers(db) {
  for (const name of EXPECTED_TRIGGERS) {
    db.exec(`DROP TRIGGER IF EXISTS ${name}`);
  }
  db.exec(`
    CREATE TRIGGER part_fts_ai AFTER INSERT ON part
    BEGIN
      ${insertFromPartSql()}
    END;
  `);
  db.exec(`
    CREATE TRIGGER part_fts_ad AFTER DELETE ON part
    BEGIN
      DELETE FROM ${FTS_TABLE} WHERE part_id = OLD.id;
      DELETE FROM ${TRI_TABLE} WHERE part_id = OLD.id;
    END;
  `);
  db.exec(`
    CREATE TRIGGER part_fts_au AFTER UPDATE ON part
    BEGIN
      DELETE FROM ${FTS_TABLE} WHERE part_id = OLD.id;
      DELETE FROM ${TRI_TABLE} WHERE part_id = OLD.id;
      ${insertFromPartSql()}
    END;
  `);
}
function ensureMetaTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS part_fts_meta (key TEXT PRIMARY KEY, value TEXT)`);
}
function versionMatches(db) {
  const row = db.query(`SELECT value FROM part_fts_meta WHERE key = 'version'`).get();
  return row?.value === String(FTS_VERSION);
}
function recordVersion(db) {
  db.query(`INSERT OR REPLACE INTO part_fts_meta(key, value) VALUES('version', ?)`).run(String(FTS_VERSION));
}
function readWatermark(db) {
  const row = db.query(`SELECT value FROM part_fts_meta WHERE key = 'last_rowid'`).get();
  return row ? Number(row.value) : 0;
}
function writeWatermark(db, rowid) {
  db.query(`INSERT OR REPLACE INTO part_fts_meta(key, value) VALUES('last_rowid', ?)`).run(String(rowid));
}
var warnedQueryError = false;
function searchFts(db, query, opts) {
  return runFtsQuery(db, FTS_TABLE, query, opts);
}
function searchFtsTrigram(db, query, opts) {
  return runFtsQuery(db, TRI_TABLE, query, opts);
}
function runFtsQuery(db, table, query, opts) {
  const where = [`${table}.content MATCH ?`];
  const binds = [query];
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
    return db.query(sql).all(...binds);
  } catch (err) {
    if (!warnedQueryError) {
      warnedQueryError = true;
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[history-search] FTS query failed (${table}): ${message}`);
    }
    return [];
  }
}
function escapeFtsPhrase(s) {
  const cleaned = sanitizeQuery(s);
  if (cleaned === null)
    return null;
  return `"${cleaned.replace(/"/g, '""')}"`;
}
function sanitizeQuery(s) {
  const cleaned = s.replace(/[\u0000-\u001f]/g, " ").trim();
  if (cleaned === "")
    return null;
  if (!/[\p{L}\p{N}]/u.test(cleaned))
    return null;
  return cleaned;
}
function searchTitles(db, query, opts) {
  const cleaned = sanitizeQuery(query);
  if (cleaned === null)
    return [];
  const like = `%${cleaned.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  const sql = `
    SELECT id, title, directory, time_updated
    FROM session
    WHERE title LIKE ? ESCAPE '\\'
      ${opts.projectID ? "AND project_id = ?" : ""}
    ORDER BY time_updated DESC
    LIMIT ?
  `;
  const binds = [like];
  if (opts.projectID)
    binds.push(opts.projectID);
  binds.push(opts.limit);
  return db.query(sql).all(...binds);
}

// src/storage-provider.ts
function useSqlite() {
  return dbExists();
}
var warnedFtsError = false;
async function withSqlite(fn) {
  if (!useSqlite())
    return null;
  const ftsResult = ensureFtsOnce();
  if (ftsResult.error && !ftsResult.transient && !warnedFtsError) {
    warnedFtsError = true;
    console.warn(`[history-search] FTS5 index unavailable: ${ftsResult.error}. ` + `Falling back to slower row-scan search. ` + `See README "Rollback" section if you want to remove the index entirely.`);
  } else if (ftsResult.built && ftsResult.built_ms !== undefined) {
    console.warn(`[history-search] Built FTS5 search index in ${Math.round(ftsResult.built_ms)}ms ` + `(one-time setup, see README "Rollback" to remove).`);
  }
  return await withDb(fn);
}
async function* listSessions2(projectID) {
  if (useSqlite()) {
    yield* listSessionsSqlite(projectID);
  } else {
    yield* listSessions(projectID);
  }
}
async function* listMessages2(sessionID, role) {
  if (useSqlite()) {
    yield* listMessagesSqlite(sessionID, role);
  } else {
    yield* listMessages(sessionID, role);
  }
}
async function* listParts2(messageID) {
  if (useSqlite()) {
    yield* listPartsSqlite(messageID);
  } else {
    yield* listParts(messageID);
  }
}

// src/search/keyword.ts
async function searchKeyword(projectID, query, options = {}) {
  const fast = await withSqlite((db) => {
    if (options.regex) {
      return searchKeywordSqlite(db, projectID, query, options);
    }
    return searchKeywordFts(db, projectID, query, options);
  });
  if (fast !== null)
    return fast;
  return searchKeywordGenerators(projectID, query, options);
}
function buildPattern(query, options) {
  return options.regex ? new RegExp(query, options.caseSensitive ? "" : "i") : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), options.caseSensitive ? "" : "i");
}
function searchKeywordFts(db, projectID, query, options) {
  const limit = options.limit || 50;
  const phrase = escapeFtsPhrase(query);
  if (phrase === null) {
    return searchKeywordSqlite(db, projectID, query, options);
  }
  const out = [];
  const titles = searchTitles(db, query, { projectID, limit });
  for (const t of titles) {
    if (out.length >= limit)
      break;
    out.push({
      sessionID: t.id,
      sessionTitle: t.title,
      timestamp: t.time_updated,
      matchType: "title",
      excerpt: t.title,
      context: t.title,
      projectDirectory: t.directory
    });
  }
  const overfetch = Math.min(limit * 3, 500);
  const hits = searchFts(db, phrase, {
    projectID,
    role: options.role,
    startTime: options.startTime,
    endTime: options.endTime,
    limit: overfetch
  });
  const pattern = buildPattern(query, options);
  const seen = new Set;
  for (const hit of hits) {
    if (out.length >= limit)
      break;
    const m = ftsHitToSearchMatch(hit, query, pattern);
    const key = `${hit.part_id}|${m.matchType}|${m.excerpt}`;
    if (seen.has(key))
      continue;
    seen.add(key);
    out.push(m);
  }
  return out.sort((a, b) => b.timestamp - a.timestamp);
}
function ftsHitToSearchMatch(hit, query, pattern) {
  const base = {
    sessionID: hit.session_id,
    sessionTitle: hit.session_title,
    timestamp: hit.time_created,
    messageID: hit.message_id,
    partID: hit.part_id,
    projectDirectory: hit.session_directory
  };
  const content = hit.content;
  const m = pattern.exec(content);
  const idx = m?.index ?? 0;
  const contextStart = Math.max(0, idx - 100);
  const contextEnd = Math.min(content.length, idx + (m?.[0].length ?? query.length) + 100);
  const excerpt = m?.[0] ?? query;
  const context = content.slice(contextStart, contextEnd);
  switch (hit.kind) {
    case "text":
      return { ...base, matchType: "message", excerpt, context };
    case "tool_name":
    case "tool_state":
      return { ...base, matchType: "tool", excerpt, context };
    case "patch_file":
      return {
        ...base,
        matchType: "filepath",
        excerpt: content,
        context: `Modified file: ${content}`
      };
    default: {
      const _exhaustive = hit.kind;
      throw new Error(`unhandled FtsKind: ${String(_exhaustive)}`);
    }
  }
}
function searchKeywordSqlite(db, projectID, query, options) {
  const pattern = buildPattern(query, options);
  const limit = options.limit || 50;
  const results = [];
  const sessions = listSessionRowsSync(db, projectID);
  for (const session of sessions) {
    if (results.length >= limit)
      break;
    if (pattern.test(session.title)) {
      results.push({
        sessionID: session.id,
        sessionTitle: session.title,
        timestamp: session.time.updated,
        matchType: "title",
        excerpt: session.title,
        context: session.title,
        projectDirectory: session.directory
      });
      if (results.length >= limit)
        break;
    }
    const messages = listMessageRowsSync(db, session.id, options.role);
    for (const message of messages) {
      if (results.length >= limit)
        break;
      if (options.startTime !== undefined && message.time.created < options.startTime)
        continue;
      if (options.endTime !== undefined && message.time.created > options.endTime)
        continue;
      const parts = listPartRowsSync(db, message.id);
      for (const part of parts) {
        if (results.length >= limit)
          break;
        matchPart(results, pattern, query, session, message, part, limit);
      }
    }
  }
  return results.sort((a, b) => b.timestamp - a.timestamp);
}
async function searchKeywordGenerators(projectID, query, options) {
  const results = [];
  const pattern = buildPattern(query, options);
  const limit = options.limit || 50;
  for await (const session of listSessions2(projectID)) {
    if (results.length >= limit)
      break;
    if (pattern.test(session.title)) {
      results.push({
        sessionID: session.id,
        sessionTitle: session.title,
        timestamp: session.time.updated,
        matchType: "title",
        excerpt: session.title,
        context: session.title,
        projectDirectory: session.directory
      });
      if (results.length >= limit)
        break;
    }
    for await (const message of listMessages2(session.id, options.role)) {
      if (results.length >= limit)
        break;
      for await (const part of listParts2(message.id)) {
        if (results.length >= limit)
          break;
        matchPart(results, pattern, query, session, message, part, limit);
      }
    }
  }
  return results.sort((a, b) => b.timestamp - a.timestamp);
}
function matchPart(results, pattern, query, session, message, part, limit) {
  if (results.length >= limit)
    return;
  if (part.type === "text" && part.text && pattern.test(part.text)) {
    const match = part.text.match(pattern);
    const matchIndex = match ? part.text.indexOf(match[0]) : 0;
    const contextStart = Math.max(0, matchIndex - 100);
    const contextEnd = Math.min(part.text.length, matchIndex + match[0].length + 100);
    const context = part.text.slice(contextStart, contextEnd);
    results.push({
      sessionID: session.id,
      sessionTitle: session.title,
      timestamp: message.time.created,
      matchType: "message",
      excerpt: match ? match[0] : query,
      context,
      messageID: message.id,
      partID: part.id,
      projectDirectory: session.directory
    });
    if (results.length >= limit)
      return;
  }
  if (part.type === "tool" && part.tool && pattern.test(part.tool)) {
    results.push({
      sessionID: session.id,
      sessionTitle: session.title,
      timestamp: message.time.created,
      matchType: "tool",
      excerpt: part.tool,
      context: part.state?.title || part.tool,
      messageID: message.id,
      partID: part.id,
      projectDirectory: session.directory
    });
    if (results.length >= limit)
      return;
  }
  if (part.type === "tool" && part.state) {
    const inputStr = JSON.stringify(part.state.input || {});
    const outputStr = part.state.output || "";
    if (pattern.test(inputStr) || pattern.test(outputStr)) {
      const matched = pattern.exec(inputStr) || pattern.exec(outputStr);
      if (matched) {
        results.push({
          sessionID: session.id,
          sessionTitle: session.title,
          timestamp: message.time.created,
          matchType: "filepath",
          excerpt: matched[0],
          context: part.state.title || part.tool || "",
          messageID: message.id,
          partID: part.id,
          projectDirectory: session.directory
        });
        if (results.length >= limit)
          return;
      }
    }
  }
  if (part.type === "patch" && part.files) {
    for (const filePath of part.files) {
      if (results.length >= limit)
        return;
      if (pattern.test(filePath)) {
        results.push({
          sessionID: session.id,
          sessionTitle: session.title,
          timestamp: message.time.created,
          matchType: "filepath",
          excerpt: filePath,
          context: `Modified file: ${filePath}`,
          messageID: message.id,
          partID: part.id,
          projectDirectory: session.directory
        });
      }
    }
  }
}

// node_modules/fuse.js/dist/fuse.mjs
function isArray(value) {
  return !Array.isArray ? getTag(value) === "[object Array]" : Array.isArray(value);
}
var INFINITY = 1 / 0;
function baseToString(value) {
  if (typeof value == "string") {
    return value;
  }
  let result = value + "";
  return result == "0" && 1 / value == -INFINITY ? "-0" : result;
}
function toString(value) {
  return value == null ? "" : baseToString(value);
}
function isString(value) {
  return typeof value === "string";
}
function isNumber(value) {
  return typeof value === "number";
}
function isBoolean(value) {
  return value === true || value === false || isObjectLike(value) && getTag(value) == "[object Boolean]";
}
function isObject(value) {
  return typeof value === "object";
}
function isObjectLike(value) {
  return isObject(value) && value !== null;
}
function isDefined(value) {
  return value !== undefined && value !== null;
}
function isBlank(value) {
  return !value.trim().length;
}
function getTag(value) {
  return value == null ? value === undefined ? "[object Undefined]" : "[object Null]" : Object.prototype.toString.call(value);
}
var INCORRECT_INDEX_TYPE = "Incorrect 'index' type";
var LOGICAL_SEARCH_INVALID_QUERY_FOR_KEY = (key) => `Invalid value for key ${key}`;
var PATTERN_LENGTH_TOO_LARGE = (max) => `Pattern length exceeds max of ${max}.`;
var MISSING_KEY_PROPERTY = (name) => `Missing ${name} property in key`;
var INVALID_KEY_WEIGHT_VALUE = (key) => `Property 'weight' in key '${key}' must be a positive integer`;
var hasOwn = Object.prototype.hasOwnProperty;

class KeyStore {
  constructor(keys) {
    this._keys = [];
    this._keyMap = {};
    let totalWeight = 0;
    keys.forEach((key) => {
      let obj = createKey(key);
      this._keys.push(obj);
      this._keyMap[obj.id] = obj;
      totalWeight += obj.weight;
    });
    this._keys.forEach((key) => {
      key.weight /= totalWeight;
    });
  }
  get(keyId) {
    return this._keyMap[keyId];
  }
  keys() {
    return this._keys;
  }
  toJSON() {
    return JSON.stringify(this._keys);
  }
}
function createKey(key) {
  let path3 = null;
  let id = null;
  let src = null;
  let weight = 1;
  let getFn = null;
  if (isString(key) || isArray(key)) {
    src = key;
    path3 = createKeyPath(key);
    id = createKeyId(key);
  } else {
    if (!hasOwn.call(key, "name")) {
      throw new Error(MISSING_KEY_PROPERTY("name"));
    }
    const name = key.name;
    src = name;
    if (hasOwn.call(key, "weight")) {
      weight = key.weight;
      if (weight <= 0) {
        throw new Error(INVALID_KEY_WEIGHT_VALUE(name));
      }
    }
    path3 = createKeyPath(name);
    id = createKeyId(name);
    getFn = key.getFn;
  }
  return { path: path3, id, weight, src, getFn };
}
function createKeyPath(key) {
  return isArray(key) ? key : key.split(".");
}
function createKeyId(key) {
  return isArray(key) ? key.join(".") : key;
}
function get(obj, path3) {
  let list = [];
  let arr = false;
  const deepGet = (obj2, path4, index) => {
    if (!isDefined(obj2)) {
      return;
    }
    if (!path4[index]) {
      list.push(obj2);
    } else {
      let key = path4[index];
      const value = obj2[key];
      if (!isDefined(value)) {
        return;
      }
      if (index === path4.length - 1 && (isString(value) || isNumber(value) || isBoolean(value))) {
        list.push(toString(value));
      } else if (isArray(value)) {
        arr = true;
        for (let i = 0, len = value.length;i < len; i += 1) {
          deepGet(value[i], path4, index + 1);
        }
      } else if (path4.length) {
        deepGet(value, path4, index + 1);
      }
    }
  };
  deepGet(obj, isString(path3) ? path3.split(".") : path3, 0);
  return arr ? list : list[0];
}
var MatchOptions = {
  includeMatches: false,
  findAllMatches: false,
  minMatchCharLength: 1
};
var BasicOptions = {
  isCaseSensitive: false,
  ignoreDiacritics: false,
  includeScore: false,
  keys: [],
  shouldSort: true,
  sortFn: (a, b) => a.score === b.score ? a.idx < b.idx ? -1 : 1 : a.score < b.score ? -1 : 1
};
var FuzzyOptions = {
  location: 0,
  threshold: 0.6,
  distance: 100
};
var AdvancedOptions = {
  useExtendedSearch: false,
  getFn: get,
  ignoreLocation: false,
  ignoreFieldNorm: false,
  fieldNormWeight: 1
};
var Config = {
  ...BasicOptions,
  ...MatchOptions,
  ...FuzzyOptions,
  ...AdvancedOptions
};
var SPACE = /[^ ]+/g;
function norm(weight = 1, mantissa = 3) {
  const cache = new Map;
  const m = Math.pow(10, mantissa);
  return {
    get(value) {
      const numTokens = value.match(SPACE).length;
      if (cache.has(numTokens)) {
        return cache.get(numTokens);
      }
      const norm2 = 1 / Math.pow(numTokens, 0.5 * weight);
      const n = parseFloat(Math.round(norm2 * m) / m);
      cache.set(numTokens, n);
      return n;
    },
    clear() {
      cache.clear();
    }
  };
}

class FuseIndex {
  constructor({
    getFn = Config.getFn,
    fieldNormWeight = Config.fieldNormWeight
  } = {}) {
    this.norm = norm(fieldNormWeight, 3);
    this.getFn = getFn;
    this.isCreated = false;
    this.setIndexRecords();
  }
  setSources(docs = []) {
    this.docs = docs;
  }
  setIndexRecords(records = []) {
    this.records = records;
  }
  setKeys(keys = []) {
    this.keys = keys;
    this._keysMap = {};
    keys.forEach((key, idx) => {
      this._keysMap[key.id] = idx;
    });
  }
  create() {
    if (this.isCreated || !this.docs.length) {
      return;
    }
    this.isCreated = true;
    if (isString(this.docs[0])) {
      this.docs.forEach((doc, docIndex) => {
        this._addString(doc, docIndex);
      });
    } else {
      this.docs.forEach((doc, docIndex) => {
        this._addObject(doc, docIndex);
      });
    }
    this.norm.clear();
  }
  add(doc) {
    const idx = this.size();
    if (isString(doc)) {
      this._addString(doc, idx);
    } else {
      this._addObject(doc, idx);
    }
  }
  removeAt(idx) {
    this.records.splice(idx, 1);
    for (let i = idx, len = this.size();i < len; i += 1) {
      this.records[i].i -= 1;
    }
  }
  getValueForItemAtKeyId(item, keyId) {
    return item[this._keysMap[keyId]];
  }
  size() {
    return this.records.length;
  }
  _addString(doc, docIndex) {
    if (!isDefined(doc) || isBlank(doc)) {
      return;
    }
    let record = {
      v: doc,
      i: docIndex,
      n: this.norm.get(doc)
    };
    this.records.push(record);
  }
  _addObject(doc, docIndex) {
    let record = { i: docIndex, $: {} };
    this.keys.forEach((key, keyIndex) => {
      let value = key.getFn ? key.getFn(doc) : this.getFn(doc, key.path);
      if (!isDefined(value)) {
        return;
      }
      if (isArray(value)) {
        let subRecords = [];
        const stack = [{ nestedArrIndex: -1, value }];
        while (stack.length) {
          const { nestedArrIndex, value: value2 } = stack.pop();
          if (!isDefined(value2)) {
            continue;
          }
          if (isString(value2) && !isBlank(value2)) {
            let subRecord = {
              v: value2,
              i: nestedArrIndex,
              n: this.norm.get(value2)
            };
            subRecords.push(subRecord);
          } else if (isArray(value2)) {
            value2.forEach((item, k) => {
              stack.push({
                nestedArrIndex: k,
                value: item
              });
            });
          } else
            ;
        }
        record.$[keyIndex] = subRecords;
      } else if (isString(value) && !isBlank(value)) {
        let subRecord = {
          v: value,
          n: this.norm.get(value)
        };
        record.$[keyIndex] = subRecord;
      }
    });
    this.records.push(record);
  }
  toJSON() {
    return {
      keys: this.keys,
      records: this.records
    };
  }
}
function createIndex(keys, docs, { getFn = Config.getFn, fieldNormWeight = Config.fieldNormWeight } = {}) {
  const myIndex = new FuseIndex({ getFn, fieldNormWeight });
  myIndex.setKeys(keys.map(createKey));
  myIndex.setSources(docs);
  myIndex.create();
  return myIndex;
}
function parseIndex(data, { getFn = Config.getFn, fieldNormWeight = Config.fieldNormWeight } = {}) {
  const { keys, records } = data;
  const myIndex = new FuseIndex({ getFn, fieldNormWeight });
  myIndex.setKeys(keys);
  myIndex.setIndexRecords(records);
  return myIndex;
}
function computeScore$1(pattern, {
  errors = 0,
  currentLocation = 0,
  expectedLocation = 0,
  distance = Config.distance,
  ignoreLocation = Config.ignoreLocation
} = {}) {
  const accuracy = errors / pattern.length;
  if (ignoreLocation) {
    return accuracy;
  }
  const proximity = Math.abs(expectedLocation - currentLocation);
  if (!distance) {
    return proximity ? 1 : accuracy;
  }
  return accuracy + proximity / distance;
}
function convertMaskToIndices(matchmask = [], minMatchCharLength = Config.minMatchCharLength) {
  let indices = [];
  let start = -1;
  let end = -1;
  let i = 0;
  for (let len = matchmask.length;i < len; i += 1) {
    let match = matchmask[i];
    if (match && start === -1) {
      start = i;
    } else if (!match && start !== -1) {
      end = i - 1;
      if (end - start + 1 >= minMatchCharLength) {
        indices.push([start, end]);
      }
      start = -1;
    }
  }
  if (matchmask[i - 1] && i - start >= minMatchCharLength) {
    indices.push([start, i - 1]);
  }
  return indices;
}
var MAX_BITS = 32;
function search(text, pattern, patternAlphabet, {
  location = Config.location,
  distance = Config.distance,
  threshold = Config.threshold,
  findAllMatches = Config.findAllMatches,
  minMatchCharLength = Config.minMatchCharLength,
  includeMatches = Config.includeMatches,
  ignoreLocation = Config.ignoreLocation
} = {}) {
  if (pattern.length > MAX_BITS) {
    throw new Error(PATTERN_LENGTH_TOO_LARGE(MAX_BITS));
  }
  const patternLen = pattern.length;
  const textLen = text.length;
  const expectedLocation = Math.max(0, Math.min(location, textLen));
  let currentThreshold = threshold;
  let bestLocation = expectedLocation;
  const computeMatches = minMatchCharLength > 1 || includeMatches;
  const matchMask = computeMatches ? Array(textLen) : [];
  let index;
  while ((index = text.indexOf(pattern, bestLocation)) > -1) {
    let score = computeScore$1(pattern, {
      currentLocation: index,
      expectedLocation,
      distance,
      ignoreLocation
    });
    currentThreshold = Math.min(score, currentThreshold);
    bestLocation = index + patternLen;
    if (computeMatches) {
      let i = 0;
      while (i < patternLen) {
        matchMask[index + i] = 1;
        i += 1;
      }
    }
  }
  bestLocation = -1;
  let lastBitArr = [];
  let finalScore = 1;
  let binMax = patternLen + textLen;
  const mask = 1 << patternLen - 1;
  for (let i = 0;i < patternLen; i += 1) {
    let binMin = 0;
    let binMid = binMax;
    while (binMin < binMid) {
      const score2 = computeScore$1(pattern, {
        errors: i,
        currentLocation: expectedLocation + binMid,
        expectedLocation,
        distance,
        ignoreLocation
      });
      if (score2 <= currentThreshold) {
        binMin = binMid;
      } else {
        binMax = binMid;
      }
      binMid = Math.floor((binMax - binMin) / 2 + binMin);
    }
    binMax = binMid;
    let start = Math.max(1, expectedLocation - binMid + 1);
    let finish = findAllMatches ? textLen : Math.min(expectedLocation + binMid, textLen) + patternLen;
    let bitArr = Array(finish + 2);
    bitArr[finish + 1] = (1 << i) - 1;
    for (let j = finish;j >= start; j -= 1) {
      let currentLocation = j - 1;
      let charMatch = patternAlphabet[text.charAt(currentLocation)];
      if (computeMatches) {
        matchMask[currentLocation] = +!!charMatch;
      }
      bitArr[j] = (bitArr[j + 1] << 1 | 1) & charMatch;
      if (i) {
        bitArr[j] |= (lastBitArr[j + 1] | lastBitArr[j]) << 1 | 1 | lastBitArr[j + 1];
      }
      if (bitArr[j] & mask) {
        finalScore = computeScore$1(pattern, {
          errors: i,
          currentLocation,
          expectedLocation,
          distance,
          ignoreLocation
        });
        if (finalScore <= currentThreshold) {
          currentThreshold = finalScore;
          bestLocation = currentLocation;
          if (bestLocation <= expectedLocation) {
            break;
          }
          start = Math.max(1, 2 * expectedLocation - bestLocation);
        }
      }
    }
    const score = computeScore$1(pattern, {
      errors: i + 1,
      currentLocation: expectedLocation,
      expectedLocation,
      distance,
      ignoreLocation
    });
    if (score > currentThreshold) {
      break;
    }
    lastBitArr = bitArr;
  }
  const result = {
    isMatch: bestLocation >= 0,
    score: Math.max(0.001, finalScore)
  };
  if (computeMatches) {
    const indices = convertMaskToIndices(matchMask, minMatchCharLength);
    if (!indices.length) {
      result.isMatch = false;
    } else if (includeMatches) {
      result.indices = indices;
    }
  }
  return result;
}
function createPatternAlphabet(pattern) {
  let mask = {};
  for (let i = 0, len = pattern.length;i < len; i += 1) {
    const char = pattern.charAt(i);
    mask[char] = (mask[char] || 0) | 1 << len - i - 1;
  }
  return mask;
}
var stripDiacritics = String.prototype.normalize ? (str) => str.normalize("NFD").replace(/[\u0300-\u036F\u0483-\u0489\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0711\u0730-\u074A\u07A6-\u07B0\u07EB-\u07F3\u07FD\u0816-\u0819\u081B-\u0823\u0825-\u0827\u0829-\u082D\u0859-\u085B\u08D3-\u08E1\u08E3-\u0903\u093A-\u093C\u093E-\u094F\u0951-\u0957\u0962\u0963\u0981-\u0983\u09BC\u09BE-\u09C4\u09C7\u09C8\u09CB-\u09CD\u09D7\u09E2\u09E3\u09FE\u0A01-\u0A03\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A70\u0A71\u0A75\u0A81-\u0A83\u0ABC\u0ABE-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AE2\u0AE3\u0AFA-\u0AFF\u0B01-\u0B03\u0B3C\u0B3E-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B62\u0B63\u0B82\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD7\u0C00-\u0C04\u0C3E-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C62\u0C63\u0C81-\u0C83\u0CBC\u0CBE-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CE2\u0CE3\u0D00-\u0D03\u0D3B\u0D3C\u0D3E-\u0D44\u0D46-\u0D48\u0D4A-\u0D4D\u0D57\u0D62\u0D63\u0D82\u0D83\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DF2\u0DF3\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u0EB1\u0EB4-\u0EB9\u0EBB\u0EBC\u0EC8-\u0ECD\u0F18\u0F19\u0F35\u0F37\u0F39\u0F3E\u0F3F\u0F71-\u0F84\u0F86\u0F87\u0F8D-\u0F97\u0F99-\u0FBC\u0FC6\u102B-\u103E\u1056-\u1059\u105E-\u1060\u1062-\u1064\u1067-\u106D\u1071-\u1074\u1082-\u108D\u108F\u109A-\u109D\u135D-\u135F\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17B4-\u17D3\u17DD\u180B-\u180D\u1885\u1886\u18A9\u1920-\u192B\u1930-\u193B\u1A17-\u1A1B\u1A55-\u1A5E\u1A60-\u1A7C\u1A7F\u1AB0-\u1ABE\u1B00-\u1B04\u1B34-\u1B44\u1B6B-\u1B73\u1B80-\u1B82\u1BA1-\u1BAD\u1BE6-\u1BF3\u1C24-\u1C37\u1CD0-\u1CD2\u1CD4-\u1CE8\u1CED\u1CF2-\u1CF4\u1CF7-\u1CF9\u1DC0-\u1DF9\u1DFB-\u1DFF\u20D0-\u20F0\u2CEF-\u2CF1\u2D7F\u2DE0-\u2DFF\u302A-\u302F\u3099\u309A\uA66F-\uA672\uA674-\uA67D\uA69E\uA69F\uA6F0\uA6F1\uA802\uA806\uA80B\uA823-\uA827\uA880\uA881\uA8B4-\uA8C5\uA8E0-\uA8F1\uA8FF\uA926-\uA92D\uA947-\uA953\uA980-\uA983\uA9B3-\uA9C0\uA9E5\uAA29-\uAA36\uAA43\uAA4C\uAA4D\uAA7B-\uAA7D\uAAB0\uAAB2-\uAAB4\uAAB7\uAAB8\uAABE\uAABF\uAAC1\uAAEB-\uAAEF\uAAF5\uAAF6\uABE3-\uABEA\uABEC\uABED\uFB1E\uFE00-\uFE0F\uFE20-\uFE2F]/g, "") : (str) => str;

class BitapSearch {
  constructor(pattern, {
    location = Config.location,
    threshold = Config.threshold,
    distance = Config.distance,
    includeMatches = Config.includeMatches,
    findAllMatches = Config.findAllMatches,
    minMatchCharLength = Config.minMatchCharLength,
    isCaseSensitive = Config.isCaseSensitive,
    ignoreDiacritics = Config.ignoreDiacritics,
    ignoreLocation = Config.ignoreLocation
  } = {}) {
    this.options = {
      location,
      threshold,
      distance,
      includeMatches,
      findAllMatches,
      minMatchCharLength,
      isCaseSensitive,
      ignoreDiacritics,
      ignoreLocation
    };
    pattern = isCaseSensitive ? pattern : pattern.toLowerCase();
    pattern = ignoreDiacritics ? stripDiacritics(pattern) : pattern;
    this.pattern = pattern;
    this.chunks = [];
    if (!this.pattern.length) {
      return;
    }
    const addChunk = (pattern2, startIndex) => {
      this.chunks.push({
        pattern: pattern2,
        alphabet: createPatternAlphabet(pattern2),
        startIndex
      });
    };
    const len = this.pattern.length;
    if (len > MAX_BITS) {
      let i = 0;
      const remainder = len % MAX_BITS;
      const end = len - remainder;
      while (i < end) {
        addChunk(this.pattern.substr(i, MAX_BITS), i);
        i += MAX_BITS;
      }
      if (remainder) {
        const startIndex = len - MAX_BITS;
        addChunk(this.pattern.substr(startIndex), startIndex);
      }
    } else {
      addChunk(this.pattern, 0);
    }
  }
  searchIn(text) {
    const { isCaseSensitive, ignoreDiacritics, includeMatches } = this.options;
    text = isCaseSensitive ? text : text.toLowerCase();
    text = ignoreDiacritics ? stripDiacritics(text) : text;
    if (this.pattern === text) {
      let result2 = {
        isMatch: true,
        score: 0
      };
      if (includeMatches) {
        result2.indices = [[0, text.length - 1]];
      }
      return result2;
    }
    const {
      location,
      distance,
      threshold,
      findAllMatches,
      minMatchCharLength,
      ignoreLocation
    } = this.options;
    let allIndices = [];
    let totalScore = 0;
    let hasMatches = false;
    this.chunks.forEach(({ pattern, alphabet, startIndex }) => {
      const { isMatch, score, indices } = search(text, pattern, alphabet, {
        location: location + startIndex,
        distance,
        threshold,
        findAllMatches,
        minMatchCharLength,
        includeMatches,
        ignoreLocation
      });
      if (isMatch) {
        hasMatches = true;
      }
      totalScore += score;
      if (isMatch && indices) {
        allIndices = [...allIndices, ...indices];
      }
    });
    let result = {
      isMatch: hasMatches,
      score: hasMatches ? totalScore / this.chunks.length : 1
    };
    if (hasMatches && includeMatches) {
      result.indices = allIndices;
    }
    return result;
  }
}

class BaseMatch {
  constructor(pattern) {
    this.pattern = pattern;
  }
  static isMultiMatch(pattern) {
    return getMatch(pattern, this.multiRegex);
  }
  static isSingleMatch(pattern) {
    return getMatch(pattern, this.singleRegex);
  }
  search() {}
}
function getMatch(pattern, exp) {
  const matches = pattern.match(exp);
  return matches ? matches[1] : null;
}

class ExactMatch extends BaseMatch {
  constructor(pattern) {
    super(pattern);
  }
  static get type() {
    return "exact";
  }
  static get multiRegex() {
    return /^="(.*)"$/;
  }
  static get singleRegex() {
    return /^=(.*)$/;
  }
  search(text) {
    const isMatch = text === this.pattern;
    return {
      isMatch,
      score: isMatch ? 0 : 1,
      indices: [0, this.pattern.length - 1]
    };
  }
}

class InverseExactMatch extends BaseMatch {
  constructor(pattern) {
    super(pattern);
  }
  static get type() {
    return "inverse-exact";
  }
  static get multiRegex() {
    return /^!"(.*)"$/;
  }
  static get singleRegex() {
    return /^!(.*)$/;
  }
  search(text) {
    const index = text.indexOf(this.pattern);
    const isMatch = index === -1;
    return {
      isMatch,
      score: isMatch ? 0 : 1,
      indices: [0, text.length - 1]
    };
  }
}

class PrefixExactMatch extends BaseMatch {
  constructor(pattern) {
    super(pattern);
  }
  static get type() {
    return "prefix-exact";
  }
  static get multiRegex() {
    return /^\^"(.*)"$/;
  }
  static get singleRegex() {
    return /^\^(.*)$/;
  }
  search(text) {
    const isMatch = text.startsWith(this.pattern);
    return {
      isMatch,
      score: isMatch ? 0 : 1,
      indices: [0, this.pattern.length - 1]
    };
  }
}

class InversePrefixExactMatch extends BaseMatch {
  constructor(pattern) {
    super(pattern);
  }
  static get type() {
    return "inverse-prefix-exact";
  }
  static get multiRegex() {
    return /^!\^"(.*)"$/;
  }
  static get singleRegex() {
    return /^!\^(.*)$/;
  }
  search(text) {
    const isMatch = !text.startsWith(this.pattern);
    return {
      isMatch,
      score: isMatch ? 0 : 1,
      indices: [0, text.length - 1]
    };
  }
}

class SuffixExactMatch extends BaseMatch {
  constructor(pattern) {
    super(pattern);
  }
  static get type() {
    return "suffix-exact";
  }
  static get multiRegex() {
    return /^"(.*)"\$$/;
  }
  static get singleRegex() {
    return /^(.*)\$$/;
  }
  search(text) {
    const isMatch = text.endsWith(this.pattern);
    return {
      isMatch,
      score: isMatch ? 0 : 1,
      indices: [text.length - this.pattern.length, text.length - 1]
    };
  }
}

class InverseSuffixExactMatch extends BaseMatch {
  constructor(pattern) {
    super(pattern);
  }
  static get type() {
    return "inverse-suffix-exact";
  }
  static get multiRegex() {
    return /^!"(.*)"\$$/;
  }
  static get singleRegex() {
    return /^!(.*)\$$/;
  }
  search(text) {
    const isMatch = !text.endsWith(this.pattern);
    return {
      isMatch,
      score: isMatch ? 0 : 1,
      indices: [0, text.length - 1]
    };
  }
}

class FuzzyMatch extends BaseMatch {
  constructor(pattern, {
    location = Config.location,
    threshold = Config.threshold,
    distance = Config.distance,
    includeMatches = Config.includeMatches,
    findAllMatches = Config.findAllMatches,
    minMatchCharLength = Config.minMatchCharLength,
    isCaseSensitive = Config.isCaseSensitive,
    ignoreDiacritics = Config.ignoreDiacritics,
    ignoreLocation = Config.ignoreLocation
  } = {}) {
    super(pattern);
    this._bitapSearch = new BitapSearch(pattern, {
      location,
      threshold,
      distance,
      includeMatches,
      findAllMatches,
      minMatchCharLength,
      isCaseSensitive,
      ignoreDiacritics,
      ignoreLocation
    });
  }
  static get type() {
    return "fuzzy";
  }
  static get multiRegex() {
    return /^"(.*)"$/;
  }
  static get singleRegex() {
    return /^(.*)$/;
  }
  search(text) {
    return this._bitapSearch.searchIn(text);
  }
}

class IncludeMatch extends BaseMatch {
  constructor(pattern) {
    super(pattern);
  }
  static get type() {
    return "include";
  }
  static get multiRegex() {
    return /^'"(.*)"$/;
  }
  static get singleRegex() {
    return /^'(.*)$/;
  }
  search(text) {
    let location = 0;
    let index;
    const indices = [];
    const patternLen = this.pattern.length;
    while ((index = text.indexOf(this.pattern, location)) > -1) {
      location = index + patternLen;
      indices.push([index, location - 1]);
    }
    const isMatch = !!indices.length;
    return {
      isMatch,
      score: isMatch ? 0 : 1,
      indices
    };
  }
}
var searchers = [
  ExactMatch,
  IncludeMatch,
  PrefixExactMatch,
  InversePrefixExactMatch,
  InverseSuffixExactMatch,
  SuffixExactMatch,
  InverseExactMatch,
  FuzzyMatch
];
var searchersLen = searchers.length;
var SPACE_RE = / +(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/;
var OR_TOKEN = "|";
function parseQuery(pattern, options = {}) {
  return pattern.split(OR_TOKEN).map((item) => {
    let query = item.trim().split(SPACE_RE).filter((item2) => item2 && !!item2.trim());
    let results = [];
    for (let i = 0, len = query.length;i < len; i += 1) {
      const queryItem = query[i];
      let found = false;
      let idx = -1;
      while (!found && ++idx < searchersLen) {
        const searcher = searchers[idx];
        let token = searcher.isMultiMatch(queryItem);
        if (token) {
          results.push(new searcher(token, options));
          found = true;
        }
      }
      if (found) {
        continue;
      }
      idx = -1;
      while (++idx < searchersLen) {
        const searcher = searchers[idx];
        let token = searcher.isSingleMatch(queryItem);
        if (token) {
          results.push(new searcher(token, options));
          break;
        }
      }
    }
    return results;
  });
}
var MultiMatchSet = new Set([FuzzyMatch.type, IncludeMatch.type]);

class ExtendedSearch {
  constructor(pattern, {
    isCaseSensitive = Config.isCaseSensitive,
    ignoreDiacritics = Config.ignoreDiacritics,
    includeMatches = Config.includeMatches,
    minMatchCharLength = Config.minMatchCharLength,
    ignoreLocation = Config.ignoreLocation,
    findAllMatches = Config.findAllMatches,
    location = Config.location,
    threshold = Config.threshold,
    distance = Config.distance
  } = {}) {
    this.query = null;
    this.options = {
      isCaseSensitive,
      ignoreDiacritics,
      includeMatches,
      minMatchCharLength,
      findAllMatches,
      ignoreLocation,
      location,
      threshold,
      distance
    };
    pattern = isCaseSensitive ? pattern : pattern.toLowerCase();
    pattern = ignoreDiacritics ? stripDiacritics(pattern) : pattern;
    this.pattern = pattern;
    this.query = parseQuery(this.pattern, this.options);
  }
  static condition(_, options) {
    return options.useExtendedSearch;
  }
  searchIn(text) {
    const query = this.query;
    if (!query) {
      return {
        isMatch: false,
        score: 1
      };
    }
    const { includeMatches, isCaseSensitive, ignoreDiacritics } = this.options;
    text = isCaseSensitive ? text : text.toLowerCase();
    text = ignoreDiacritics ? stripDiacritics(text) : text;
    let numMatches = 0;
    let allIndices = [];
    let totalScore = 0;
    for (let i = 0, qLen = query.length;i < qLen; i += 1) {
      const searchers2 = query[i];
      allIndices.length = 0;
      numMatches = 0;
      for (let j = 0, pLen = searchers2.length;j < pLen; j += 1) {
        const searcher = searchers2[j];
        const { isMatch, indices, score } = searcher.search(text);
        if (isMatch) {
          numMatches += 1;
          totalScore += score;
          if (includeMatches) {
            const type = searcher.constructor.type;
            if (MultiMatchSet.has(type)) {
              allIndices = [...allIndices, ...indices];
            } else {
              allIndices.push(indices);
            }
          }
        } else {
          totalScore = 0;
          numMatches = 0;
          allIndices.length = 0;
          break;
        }
      }
      if (numMatches) {
        let result = {
          isMatch: true,
          score: totalScore / numMatches
        };
        if (includeMatches) {
          result.indices = allIndices;
        }
        return result;
      }
    }
    return {
      isMatch: false,
      score: 1
    };
  }
}
var registeredSearchers = [];
function register(...args) {
  registeredSearchers.push(...args);
}
function createSearcher(pattern, options) {
  for (let i = 0, len = registeredSearchers.length;i < len; i += 1) {
    let searcherClass = registeredSearchers[i];
    if (searcherClass.condition(pattern, options)) {
      return new searcherClass(pattern, options);
    }
  }
  return new BitapSearch(pattern, options);
}
var LogicalOperator = {
  AND: "$and",
  OR: "$or"
};
var KeyType = {
  PATH: "$path",
  PATTERN: "$val"
};
var isExpression = (query) => !!(query[LogicalOperator.AND] || query[LogicalOperator.OR]);
var isPath = (query) => !!query[KeyType.PATH];
var isLeaf = (query) => !isArray(query) && isObject(query) && !isExpression(query);
var convertToExplicit = (query) => ({
  [LogicalOperator.AND]: Object.keys(query).map((key) => ({
    [key]: query[key]
  }))
});
function parse(query, options, { auto = true } = {}) {
  const next = (query2) => {
    let keys = Object.keys(query2);
    const isQueryPath = isPath(query2);
    if (!isQueryPath && keys.length > 1 && !isExpression(query2)) {
      return next(convertToExplicit(query2));
    }
    if (isLeaf(query2)) {
      const key = isQueryPath ? query2[KeyType.PATH] : keys[0];
      const pattern = isQueryPath ? query2[KeyType.PATTERN] : query2[key];
      if (!isString(pattern)) {
        throw new Error(LOGICAL_SEARCH_INVALID_QUERY_FOR_KEY(key));
      }
      const obj = {
        keyId: createKeyId(key),
        pattern
      };
      if (auto) {
        obj.searcher = createSearcher(pattern, options);
      }
      return obj;
    }
    let node = {
      children: [],
      operator: keys[0]
    };
    keys.forEach((key) => {
      const value = query2[key];
      if (isArray(value)) {
        value.forEach((item) => {
          node.children.push(next(item));
        });
      }
    });
    return node;
  };
  if (!isExpression(query)) {
    query = convertToExplicit(query);
  }
  return next(query);
}
function computeScore(results, { ignoreFieldNorm = Config.ignoreFieldNorm }) {
  results.forEach((result) => {
    let totalScore = 1;
    result.matches.forEach(({ key, norm: norm2, score }) => {
      const weight = key ? key.weight : null;
      totalScore *= Math.pow(score === 0 && weight ? Number.EPSILON : score, (weight || 1) * (ignoreFieldNorm ? 1 : norm2));
    });
    result.score = totalScore;
  });
}
function transformMatches(result, data) {
  const matches = result.matches;
  data.matches = [];
  if (!isDefined(matches)) {
    return;
  }
  matches.forEach((match) => {
    if (!isDefined(match.indices) || !match.indices.length) {
      return;
    }
    const { indices, value } = match;
    let obj = {
      indices,
      value
    };
    if (match.key) {
      obj.key = match.key.src;
    }
    if (match.idx > -1) {
      obj.refIndex = match.idx;
    }
    data.matches.push(obj);
  });
}
function transformScore(result, data) {
  data.score = result.score;
}
function format(results, docs, {
  includeMatches = Config.includeMatches,
  includeScore = Config.includeScore
} = {}) {
  const transformers = [];
  if (includeMatches)
    transformers.push(transformMatches);
  if (includeScore)
    transformers.push(transformScore);
  return results.map((result) => {
    const { idx } = result;
    const data = {
      item: docs[idx],
      refIndex: idx
    };
    if (transformers.length) {
      transformers.forEach((transformer) => {
        transformer(result, data);
      });
    }
    return data;
  });
}

class Fuse {
  constructor(docs, options = {}, index) {
    this.options = { ...Config, ...options };
    if (this.options.useExtendedSearch && false) {}
    this._keyStore = new KeyStore(this.options.keys);
    this.setCollection(docs, index);
  }
  setCollection(docs, index) {
    this._docs = docs;
    if (index && !(index instanceof FuseIndex)) {
      throw new Error(INCORRECT_INDEX_TYPE);
    }
    this._myIndex = index || createIndex(this.options.keys, this._docs, {
      getFn: this.options.getFn,
      fieldNormWeight: this.options.fieldNormWeight
    });
  }
  add(doc) {
    if (!isDefined(doc)) {
      return;
    }
    this._docs.push(doc);
    this._myIndex.add(doc);
  }
  remove(predicate = () => false) {
    const results = [];
    for (let i = 0, len = this._docs.length;i < len; i += 1) {
      const doc = this._docs[i];
      if (predicate(doc, i)) {
        this.removeAt(i);
        i -= 1;
        len -= 1;
        results.push(doc);
      }
    }
    return results;
  }
  removeAt(idx) {
    this._docs.splice(idx, 1);
    this._myIndex.removeAt(idx);
  }
  getIndex() {
    return this._myIndex;
  }
  search(query, { limit = -1 } = {}) {
    const {
      includeMatches,
      includeScore,
      shouldSort,
      sortFn,
      ignoreFieldNorm
    } = this.options;
    let results = isString(query) ? isString(this._docs[0]) ? this._searchStringList(query) : this._searchObjectList(query) : this._searchLogical(query);
    computeScore(results, { ignoreFieldNorm });
    if (shouldSort) {
      results.sort(sortFn);
    }
    if (isNumber(limit) && limit > -1) {
      results = results.slice(0, limit);
    }
    return format(results, this._docs, {
      includeMatches,
      includeScore
    });
  }
  _searchStringList(query) {
    const searcher = createSearcher(query, this.options);
    const { records } = this._myIndex;
    const results = [];
    records.forEach(({ v: text, i: idx, n: norm2 }) => {
      if (!isDefined(text)) {
        return;
      }
      const { isMatch, score, indices } = searcher.searchIn(text);
      if (isMatch) {
        results.push({
          item: text,
          idx,
          matches: [{ score, value: text, norm: norm2, indices }]
        });
      }
    });
    return results;
  }
  _searchLogical(query) {
    const expression = parse(query, this.options);
    const evaluate = (node, item, idx) => {
      if (!node.children) {
        const { keyId, searcher } = node;
        const matches = this._findMatches({
          key: this._keyStore.get(keyId),
          value: this._myIndex.getValueForItemAtKeyId(item, keyId),
          searcher
        });
        if (matches && matches.length) {
          return [
            {
              idx,
              item,
              matches
            }
          ];
        }
        return [];
      }
      const res = [];
      for (let i = 0, len = node.children.length;i < len; i += 1) {
        const child = node.children[i];
        const result = evaluate(child, item, idx);
        if (result.length) {
          res.push(...result);
        } else if (node.operator === LogicalOperator.AND) {
          return [];
        }
      }
      return res;
    };
    const records = this._myIndex.records;
    const resultMap = {};
    const results = [];
    records.forEach(({ $: item, i: idx }) => {
      if (isDefined(item)) {
        let expResults = evaluate(expression, item, idx);
        if (expResults.length) {
          if (!resultMap[idx]) {
            resultMap[idx] = { idx, item, matches: [] };
            results.push(resultMap[idx]);
          }
          expResults.forEach(({ matches }) => {
            resultMap[idx].matches.push(...matches);
          });
        }
      }
    });
    return results;
  }
  _searchObjectList(query) {
    const searcher = createSearcher(query, this.options);
    const { keys, records } = this._myIndex;
    const results = [];
    records.forEach(({ $: item, i: idx }) => {
      if (!isDefined(item)) {
        return;
      }
      let matches = [];
      keys.forEach((key, keyIndex) => {
        matches.push(...this._findMatches({
          key,
          value: item[keyIndex],
          searcher
        }));
      });
      if (matches.length) {
        results.push({
          idx,
          item,
          matches
        });
      }
    });
    return results;
  }
  _findMatches({ key, value, searcher }) {
    if (!isDefined(value)) {
      return [];
    }
    let matches = [];
    if (isArray(value)) {
      value.forEach(({ v: text, i: idx, n: norm2 }) => {
        if (!isDefined(text)) {
          return;
        }
        const { isMatch, score, indices } = searcher.searchIn(text);
        if (isMatch) {
          matches.push({
            score,
            key,
            value: text,
            idx,
            norm: norm2,
            indices
          });
        }
      });
    } else {
      const { v: text, n: norm2 } = value;
      const { isMatch, score, indices } = searcher.searchIn(text);
      if (isMatch) {
        matches.push({ score, key, value: text, norm: norm2, indices });
      }
    }
    return matches;
  }
}
Fuse.version = "7.1.0";
Fuse.createIndex = createIndex;
Fuse.parseIndex = parseIndex;
Fuse.config = Config;
{
  Fuse.parseQuery = parse;
}
{
  register(ExtendedSearch);
}

// src/search/fuzzy.ts
async function searchFuzzy(projectID, query, options = {}) {
  const fast = await withSqlite((db) => searchFuzzyTrigram(db, projectID, query, options));
  if (fast !== null)
    return fast;
  return searchFuzzyGenerators(projectID, query, options);
}
function searchFuzzyTrigram(db, projectID, query, options) {
  const limit = options.limit ?? 50;
  const phrase = escapeFtsPhrase(query);
  if (phrase === null)
    return [];
  const out = [];
  const titles = searchTitles(db, query, { projectID, limit });
  for (const t of titles) {
    if (out.length >= limit)
      break;
    out.push({
      sessionID: t.id,
      sessionTitle: t.title,
      timestamp: t.time_updated,
      matchType: "title",
      excerpt: t.title,
      context: t.title,
      projectDirectory: t.directory
    });
  }
  const overfetch = Math.min(limit * 3, 500);
  const hits = searchFtsTrigram(db, phrase, {
    projectID,
    role: options.role,
    startTime: options.startTime,
    endTime: options.endTime,
    limit: overfetch
  });
  const seen = new Set;
  for (const hit of hits) {
    if (out.length >= limit)
      break;
    const m = ftsHitToFuzzyMatch(hit, query);
    const key = `${hit.part_id}|${m.matchType}|${m.excerpt}`;
    if (seen.has(key))
      continue;
    seen.add(key);
    out.push(m);
  }
  return out.sort((a, b) => b.timestamp - a.timestamp);
}
function ftsHitToFuzzyMatch(hit, query) {
  const content = hit.content;
  const excerpt = content.slice(0, 100) || query;
  const context = content.slice(0, 300) || excerpt;
  const matchType = hit.kind === "text" ? "message" : "tool";
  return {
    sessionID: hit.session_id,
    sessionTitle: hit.session_title,
    timestamp: hit.time_created,
    matchType,
    excerpt,
    context,
    messageID: hit.message_id,
    partID: hit.part_id,
    projectDirectory: hit.session_directory
  };
}
async function searchFuzzyGenerators(projectID, query, options) {
  const items = [];
  try {
    for await (const session of listSessions2(projectID)) {
      items.push({
        session,
        content: session.title,
        type: "title",
        timestamp: session.time.updated
      });
      try {
        for await (const message of listMessages2(session.id, options.role)) {
          try {
            for await (const part of listParts2(message.id)) {
              addPartItems(items, session, message, part);
            }
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }
    }
  } catch {
    return [];
  }
  return runFuse(items, query, options);
}
function addPartItems(items, session, message, part) {
  if (part.type === "text" && part.text) {
    items.push({
      session,
      content: part.text,
      type: "message",
      messageID: message.id,
      partID: part.id,
      timestamp: message.time.created
    });
  }
  if (part.type === "tool" && part.tool) {
    items.push({
      session,
      content: part.tool + " " + (part.state?.title || ""),
      type: "tool",
      messageID: message.id,
      partID: part.id,
      timestamp: message.time.created
    });
  }
  if (part.type === "tool" && part.state) {
    const inputStr = JSON.stringify(part.state.input || {});
    const outputStr = part.state.output || "";
    const combined = inputStr + " " + outputStr;
    const pathMatches = combined.match(/(?:\/[^/\s]+)+/g);
    if (pathMatches) {
      for (const p of pathMatches) {
        items.push({
          session,
          content: p,
          type: "filepath",
          messageID: message.id,
          partID: part.id,
          timestamp: message.time.created
        });
      }
    }
  }
  if (part.type === "patch" && part.files) {
    for (const filePath of part.files) {
      items.push({
        session,
        content: filePath,
        type: "filepath",
        messageID: message.id,
        partID: part.id,
        timestamp: message.time.created
      });
    }
  }
}
function runFuse(items, query, options) {
  const threshold = options.threshold ?? 0.4;
  const limit = options.limit ?? 50;
  const fuse = new Fuse(items, {
    keys: ["content"],
    threshold,
    includeScore: true,
    includeMatches: true,
    ignoreLocation: true,
    minMatchCharLength: 2
  });
  const results = fuse.search(query, { limit });
  return results.map((result) => {
    const matchedText = result.matches?.[0]?.value || result.item.content;
    const matchIndex = result.matches?.[0]?.indices?.[0]?.[0] || 0;
    const contextStart = Math.max(0, matchIndex - 100);
    const contextEnd = Math.min(matchedText.length, matchIndex + 200);
    const context = matchedText.slice(contextStart, contextEnd);
    const excerptStart = Math.max(0, matchIndex - 20);
    const excerptEnd = Math.min(matchedText.length, matchIndex + 80);
    const excerpt = matchedText.slice(excerptStart, excerptEnd);
    return {
      sessionID: result.item.session.id,
      sessionTitle: result.item.session.title,
      timestamp: result.item.timestamp,
      matchType: result.item.type,
      excerpt: excerpt || query,
      context: context || excerpt,
      messageID: result.item.messageID,
      partID: result.item.partID,
      projectDirectory: result.item.session.directory
    };
  }).sort((a, b) => b.timestamp - a.timestamp);
}

// src/search/date-filter.ts
function parseDateFilter(filter) {
  const normalized = filter.trim().toLowerCase();
  if (normalized === "today") {
    const start = new Date;
    start.setHours(0, 0, 0, 0);
    const end = new Date;
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  if (normalized === "yesterday") {
    const start = new Date;
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  const relativeMatch = normalized.match(/^last (\d+) (day|week|month)s?$/);
  if (relativeMatch && relativeMatch[1] && relativeMatch[2]) {
    const count = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const end = new Date;
    const start = new Date;
    if (unit === "day") {
      start.setDate(start.getDate() - count);
    } else if (unit === "week") {
      start.setDate(start.getDate() - count * 7);
    } else if (unit === "month") {
      start.setMonth(start.getMonth() - count);
    }
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }
  const rangeMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})$/);
  if (rangeMatch && rangeMatch[1] && rangeMatch[2]) {
    const start = new Date(rangeMatch[1]);
    const end = new Date(rangeMatch[2]);
    end.setHours(23, 59, 59, 999);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error(`Invalid date range: ${filter}`);
    }
    if (start > end) {
      throw new Error(`Start date must be before end date: ${filter}`);
    }
    return { start, end };
  }
  const isoMatch = normalized.match(/^(\d{4}-\d{2}(?:-\d{2})?)$/);
  if (isoMatch && isoMatch[1]) {
    const dateStr = isoMatch[1];
    if (dateStr.match(/^\d{4}-\d{2}$/)) {
      const start2 = new Date(`${dateStr}-01`);
      const end2 = new Date(start2);
      end2.setMonth(end2.getMonth() + 1);
      end2.setDate(0);
      end2.setHours(23, 59, 59, 999);
      if (isNaN(start2.getTime())) {
        throw new Error(`Invalid date: ${filter}`);
      }
      return { start: start2, end: end2 };
    }
    const start = new Date(dateStr);
    const end = new Date(dateStr);
    end.setHours(23, 59, 59, 999);
    if (isNaN(start.getTime())) {
      throw new Error(`Invalid date: ${filter}`);
    }
    return { start, end };
  }
  throw new Error(`Unrecognized date filter format: ${filter}. Supported formats: "today", "yesterday", "last N days/weeks/months", "YYYY-MM-DD", "YYYY-MM", "YYYY-MM-DD to YYYY-MM-DD"`);
}
function filterByDate(results, dateRange) {
  return results.filter((result) => {
    const timestamp = new Date(result.timestamp);
    return timestamp >= dateRange.start && timestamp <= dateRange.end;
  });
}

// src/search/file-trace.ts
function traceFileSqlite(db, projectID, queryPath, options) {
  const normalizedQuery = queryPath.replace(/\\/g, "/");
  const isExactPath = normalizedQuery.includes("/");
  const likePattern = `%${normalizedQuery}%`;
  const projectFilter = projectID !== null ? "AND s.project_id = ?" : "";
  const sql = `
    SELECT
      s.id AS session_id,
      s.title AS session_title,
      m.id AS message_id,
      m.time_created AS message_time,
      json_extract(p.data, '$.tool') AS tool_name,
      json_extract(p.data, '$.state.input.filePath') AS matched_file_path_tool,
      json_extract(p.data, '$.files') AS matched_files_patch,
      0 AS source_priority
    FROM session s
    JOIN message m ON m.session_id = s.id
    JOIN part p ON p.message_id = m.id
    WHERE json_valid(p.data)
      AND json_extract(m.data, '$.role') = 'assistant'
      AND json_extract(p.data, '$.type') = 'tool'
      AND json_extract(p.data, '$.tool') IN ('write', 'edit')
      AND json_extract(p.data, '$.state.input.filePath') LIKE ?
      ${projectFilter}
      
    UNION ALL

    SELECT
      s.id AS session_id,
      s.title AS session_title,
      m.id AS message_id,
      m.time_created AS message_time,
      NULL AS tool_name,
      NULL AS matched_file_path_tool,
      p.data AS matched_files_patch,
      1 AS source_priority
    FROM session s
    JOIN message m ON m.session_id = s.id
    JOIN part p ON p.message_id = m.id
    WHERE json_valid(p.data)
      AND json_extract(m.data, '$.role') = 'assistant'
      AND json_extract(p.data, '$.type') = 'patch'
      AND json_extract(p.data, '$.files') LIKE ?
      ${projectFilter}
    ORDER BY message_time DESC, source_priority ASC
  `;
  const binds = projectID !== null ? [likePattern, projectID, likePattern, projectID] : [likePattern, likePattern];
  const rows = db.query(sql).all(...binds);
  const candidates = [];
  for (const row of rows) {
    let matchedPath = null;
    if (row.source_priority === 0 && row.matched_file_path_tool) {
      if (isMatch(row.matched_file_path_tool, normalizedQuery, isExactPath)) {
        matchedPath = row.matched_file_path_tool;
      }
    } else if (row.source_priority === 1 && row.matched_files_patch) {
      try {
        const parsed = JSON.parse(row.matched_files_patch);
        if (Array.isArray(parsed.files)) {
          for (const f of parsed.files) {
            if (isMatch(f, normalizedQuery, isExactPath)) {
              matchedPath = f;
              break;
            }
          }
        }
      } catch {
        continue;
      }
    }
    if (matchedPath) {
      candidates.push({
        sessionID: row.session_id,
        sessionTitle: row.session_title,
        messageID: row.message_id,
        timestamp: row.message_time,
        toolName: row.tool_name,
        filePath: matchedPath
      });
    }
  }
  const seen = new Set;
  const deduped = [];
  for (const c of candidates) {
    const key = `${c.sessionID}|${c.messageID}|${c.filePath}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(c);
    }
  }
  let earliestTime = Infinity;
  let earliestIndex = -1;
  for (let i = 0;i < deduped.length; i++) {
    const candidate = deduped[i];
    if (candidate && candidate.timestamp < earliestTime) {
      earliestTime = candidate.timestamp;
      earliestIndex = i;
    }
  }
  const findUserPrompt = db.query(`
    SELECT json_extract(p.data, '$.text') AS text
    FROM message m
    JOIN part p ON p.message_id = m.id
    WHERE m.session_id = ?
      AND m.time_created < ?
      AND json_valid(p.data)
      AND json_extract(m.data, '$.role') = 'user'
      AND json_extract(p.data, '$.type') = 'text'
    ORDER BY m.time_created DESC
    LIMIT 1
  `);
  const results = deduped.map((c, idx) => {
    const promptRow = findUserPrompt.get(c.sessionID, c.timestamp);
    return {
      sessionID: c.sessionID,
      sessionTitle: c.sessionTitle,
      timestamp: c.timestamp,
      firstTouch: idx === earliestIndex,
      userPrompt: promptRow ? promptRow.text : null,
      toolName: c.toolName,
      filePath: c.filePath
    };
  });
  const limit = options?.limit ?? 50;
  return results.slice(0, limit);
}
function isMatch(path3, query, isExact) {
  if (isExact) {
    return path3 === query;
  }
  return path3 === query || path3.endsWith(`/${query}`);
}
async function traceFile(projectID, filePath, options) {
  const { Database: Database3 } = await import("bun:sqlite");
  const dbPath = getDbPath();
  const db = new Database3(dbPath, { readonly: true });
  try {
    return traceFileSqlite(db, projectID, filePath, options);
  } finally {
    db.close();
  }
}

// src/format.ts
function formatResults(matches) {
  if (matches.length === 0) {
    return "No matches found in conversation history.";
  }
  const lines = [
    `Found ${matches.length} matches in conversation history:
`
  ];
  for (const match of matches) {
    const date = new Date(match.timestamp).toISOString().split("T")[0];
    const time = new Date(match.timestamp).toTimeString().split(" ")[0];
    lines.push(`## ${match.sessionTitle}`);
    lines.push(`- Session ID: ${match.sessionID}`);
    lines.push(`- Project: ${match.projectDirectory}`);
    lines.push(`- Date: ${date} ${time}`);
    lines.push(`- Match Type: ${match.matchType}`);
    lines.push(`- Excerpt: "${match.excerpt}"`);
    if (match.context && match.context !== match.excerpt) {
      lines.push(`- Context: ...${match.context}...`);
    }
    lines.push("");
  }
  return lines.join(`
`);
}
function formatTraceResults(matches) {
  if (matches.length === 0) {
    return "No file trace matches found in conversation history.";
  }
  const lines = [
    `Found ${matches.length} file trace matches in conversation history:
`
  ];
  for (const match of matches) {
    const date = new Date(match.timestamp).toISOString().split("T")[0];
    const time = new Date(match.timestamp).toTimeString().split(" ")[0];
    lines.push(`## ${match.sessionTitle}`);
    lines.push(`- Session ID: ${match.sessionID}`);
    lines.push(`- Date: ${date} ${time}`);
    lines.push(`- Status: ${match.firstTouch ? "First seen" : "Later touch"}`);
    lines.push(`- File: ${match.filePath}`);
    if (match.toolName) {
      lines.push(`- Tool: ${match.toolName}`);
    }
    if (match.userPrompt) {
      lines.push(`- Preceding User Prompt: "${match.userPrompt}"`);
    }
    lines.push("");
  }
  return lines.join(`
`);
}

// src/index.ts
var historySearch = tool({
  description: `Search through past conversation histories. Use searchAllProjects=true to search ALL projects on this machine. Searches session titles, message content, tool invocations, and file paths. Supports keyword search, regex patterns, fuzzy search (for typos and variations), and date filtering.`,
  args: {
    query: tool.schema.string().optional().describe("Search query (keyword, regex pattern, or fuzzy search term). Required unless filePath is provided."),
    filePath: tool.schema.string().optional().describe("File path to trace touch history (e.g., 'src/auth.ts'). If provided, query, mode, regex, caseSensitive, fuzzyThreshold, and role are ignored."),
    searchAllProjects: tool.schema.boolean().optional().describe("Set to true to search ALL projects on your machine across all repositories, not just the current one. Default: false (current repo only). Use when user asks to search globally, across all projects, machine-wide, or everywhere."),
    mode: tool.schema.enum(["keyword", "fuzzy"]).optional().describe("Search mode: 'keyword' for exact matches, 'fuzzy' for typo-tolerant matching (default: keyword)"),
    regex: tool.schema.boolean().optional().describe("Treat query as regex pattern (keyword mode only, default: false)"),
    caseSensitive: tool.schema.boolean().optional().describe("Case-sensitive search (keyword mode only, default: false)"),
    fuzzyThreshold: tool.schema.number().optional().describe("Fuzzy match threshold 0.0-1.0 (fuzzy mode only, default: 0.4, lower = stricter)"),
    date: tool.schema.string().optional().describe("Filter by date: 'today', 'yesterday', 'last N days/weeks/months', 'YYYY-MM-DD', 'YYYY-MM', 'YYYY-MM-DD to YYYY-MM-DD'"),
    limit: tool.schema.number().optional().describe("Maximum number of results (default: 50)"),
    role: tool.schema.enum(["user", "assistant"]).optional().describe("Filter by message role: 'user' for your messages only, 'assistant' for AI responses only. Ignored if filePath is provided.")
  },
  async execute(args) {
    if (!args.query && !args.filePath) {
      throw new Error("Either 'query' or 'filePath' must be provided.");
    }
    if (args.query !== undefined && args.query.length > 1024) {
      throw new Error(`'query' is too long (${args.query.length} chars; max 1024).`);
    }
    const projectID = args.searchAllProjects ? null : await getCurrentProjectID();
    const dateRange = args.date ? parseDateFilter(args.date) : null;
    if (args.filePath) {
      let matches2 = await traceFile(projectID, args.filePath, {
        limit: args.limit
      });
      if (dateRange)
        matches2 = filterByDate(matches2, dateRange);
      return formatTraceResults(matches2);
    }
    if (!args.query) {
      throw new Error("'query' is required when 'filePath' is not provided.");
    }
    const startTime = dateRange?.start.getTime();
    const endTime = dateRange?.end.getTime();
    let matches = args.mode === "fuzzy" ? await searchFuzzy(projectID, args.query, {
      threshold: args.fuzzyThreshold,
      limit: args.limit,
      role: args.role
    }) : await searchKeyword(projectID, args.query, {
      regex: args.regex,
      caseSensitive: args.caseSensitive,
      limit: args.limit,
      role: args.role,
      startTime,
      endTime
    });
    if (dateRange)
      matches = filterByDate(matches, dateRange);
    return formatResults(matches);
  }
});
historySearch.id = "opencode-history-search";
historySearch.server = async (_input, _options) => ({
  tool: { "history-search": historySearch }
});
var src_default = historySearch;
export {
  src_default as default
};
