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

const useSqlite = dbExists();

/**
 * If SQLite is available, opens a single shared connection, runs `fn`, then
 * closes it. Returns the result. If SQLite is not available (legacy JSON
 * backend, or storage-provider is mocked in tests), returns `null` so the
 * caller can fall back to the generator-based path.
 *
 * This is the recommended entry point for any search code that wants the fast
 * path: one connection per execute(), no per-row open/close.
 */
export async function withSqlite<T>(
  fn: (db: Database) => Promise<T> | T,
): Promise<T | null> {
  if (!useSqlite) return null;
  return await withDb(fn);
}

export async function* listSessions(
  projectID: string | null,
): AsyncGenerator<Session> {
  if (useSqlite) {
    yield* listSessionsSqlite(projectID);
  } else {
    yield* listSessionsJSON(projectID);
  }
}

export async function* listMessages(
  sessionID: string,
  role?: "user" | "assistant",
): AsyncGenerator<Message> {
  if (useSqlite) {
    yield* listMessagesSqlite(sessionID, role);
  } else {
    yield* listMessagesJSON(sessionID, role);
  }
}

export async function* listParts(messageID: string): AsyncGenerator<Part> {
  if (useSqlite) {
    yield* listPartsSqlite(messageID);
  } else {
    yield* listPartsJSON(messageID);
  }
}

export { getCurrentProjectID, getStorageDir };
export type { Session, Message, Part };
