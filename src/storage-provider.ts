import {
  dbExists,
  listSessionsSqlite,
  listMessagesSqlite,
  listPartsSqlite,
  contextStartSqlite,
} from "./storage-sqlite";
import {
  listSessions as listSessionsJSON,
  listMessages as listMessagesJSON,
  listParts as listPartsJSON,
  getCurrentProjectID,
  getStorageDir,
} from "./storage";
import type { Session, Message, Part } from "./storage";
import type { InContext } from "./in-context";

const useSqlite = dbExists();

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

/**
 * Finds what the calling session already has in its context.
 *
 * Compactions are only detected in SQLite storage; with the older JSON
 * storage the whole session counts as in context.
 */
export async function getInContext(
  sessionID: string | undefined,
): Promise<InContext | undefined> {
  if (!sessionID) return undefined;
  const since = useSqlite ? contextStartSqlite(sessionID) : undefined;
  return since ? { sessionID, since } : { sessionID };
}

export { getCurrentProjectID, getStorageDir };
export type { Session, Message, Part };
