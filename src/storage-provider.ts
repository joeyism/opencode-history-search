import {
  dbExists,
  withDb,
  listSessionsSqlite,
  listMessagesSqlite,
  listPartsSqlite,
} from "./storage-sqlite";
import {
  listSessions as listSessionsJSON,
  listMessages as listMessagesJSON,
  listParts as listPartsJSON,
  getCurrentProjectID,
  getStorageDir,
} from "./storage";
import type { Session, Message, Part } from "./storage";
import type { Database } from "bun:sqlite";
import { ensureFtsOnce } from "./search/fts";

/**
 * Whether the SQLite backend is available. Evaluated fresh on each call so
 * fresh OpenCode installs that create the DB *after* this plugin is loaded
 * get the fast path on subsequent searches, not the JSON fallback forever.
 */
function useSqlite(): boolean {
  return dbExists();
}

// One-time logging latch for FTS errors so we don't spam the console.
let warnedFtsError = false;

/**
 * If SQLite is available, opens a single shared read-only connection, runs
 * `fn`, then closes it. Returns the result. If SQLite is not available (legacy
 * JSON backend, or storage-provider is mocked in tests), returns `null` so the
 * caller can fall back to the generator-based path.
 *
 * Before opening the read-only connection, this ensures the FTS5 index exists
 * (which requires a brief writable connection). The first call may take a few
 * seconds to build the index. Subsequent calls are microseconds.
 *
 * If the FTS build fails for any reason (DB busy, disk full, permission, etc.),
 * we log a single warning and still proceed to the read-only path. The keyword
 * search will fall back to the row-scan path (regex mode equivalent) if the
 * FTS table is missing or unusable.
 *
 * This is the recommended entry point for any search code that wants the fast
 * path: one connection per execute(), no per-row open/close.
 */
export async function withSqlite<T>(
  fn: (db: Database) => Promise<T> | T,
): Promise<T | null> {
  if (!useSqlite()) return null;
  const ftsResult = ensureFtsOnce();
  if (ftsResult.error && !warnedFtsError) {
    warnedFtsError = true;
    console.warn(
      `[history-search] FTS5 index unavailable: ${ftsResult.error}. ` +
        `Falling back to slower row-scan search. ` +
        `See README "Rollback" section if you want to remove the index entirely.`,
    );
  } else if (ftsResult.built && ftsResult.built_ms !== undefined) {
    console.warn(
      `[history-search] Built FTS5 search index in ${Math.round(ftsResult.built_ms)}ms ` +
        `(one-time setup, see README "Rollback" to remove).`,
    );
  }
  return await withDb(fn);
}

export async function* listSessions(
  projectID: string | null,
): AsyncGenerator<Session> {
  if (useSqlite()) {
    yield* listSessionsSqlite(projectID);
  } else {
    yield* listSessionsJSON(projectID);
  }
}

export async function* listMessages(
  sessionID: string,
  role?: "user" | "assistant",
): AsyncGenerator<Message> {
  if (useSqlite()) {
    yield* listMessagesSqlite(sessionID, role);
  } else {
    yield* listMessagesJSON(sessionID, role);
  }
}

export async function* listParts(messageID: string): AsyncGenerator<Part> {
  if (useSqlite()) {
    yield* listPartsSqlite(messageID);
  } else {
    yield* listPartsJSON(messageID);
  }
}

export { getCurrentProjectID, getStorageDir };
export type { Session, Message, Part };
