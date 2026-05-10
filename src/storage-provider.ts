import {
  dbExists,
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

export { getCurrentProjectID, getStorageDir };
export type { Session, Message, Part };
