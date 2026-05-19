import { Database } from "bun:sqlite";
import path from "path";
import os from "os";
import type { Session, Message, Part } from "./storage";

export function getDbPath(): string {
  const xdgData =
    process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(xdgData, "opencode", "opencode.db");
}

export function dbExists(): boolean {
  // Bun.file(path).size returns 0 when the file doesn't exist (never throws),
  // so a simple comparison is sufficient. No try/catch needed.
  return Bun.file(getDbPath()).size > 0;
}

export function openDb(): Database {
  return new Database(getDbPath(), { readonly: true });
}

/**
 * Run `fn` with a single shared read-only Database connection.
 * Use this for any search path that touches multiple sessions/messages/parts
 * so we don't pay the open/close cost per row.
 */
export async function withDb<T>(fn: (db: Database) => Promise<T> | T): Promise<T> {
  const db = openDb();
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Synchronous, single-connection row iterators.
//
// These are the fast path. They take an existing `db` and return plain arrays
// (or do callback iteration) rather than async generators, which avoids the
// per-row event loop overhead AND lets us share one connection.
// ---------------------------------------------------------------------------

export interface RawPart {
  id: string;
  message_id: string;
  session_id: string;
  data: string;
}

export function listSessionRowsSync(
  db: Database,
  projectID: string | null,
): Session[] {
  const rows = (
    projectID
      ? db
          .query(
            `SELECT id, project_id, title, directory, time_created, time_updated
             FROM session WHERE project_id = ?
             ORDER BY time_updated DESC`,
          )
          .all(projectID)
      : db
          .query(
            `SELECT id, project_id, title, directory, time_created, time_updated
             FROM session
             ORDER BY time_updated DESC`,
          )
          .all()
  ) as Array<{
    id: string;
    project_id: string;
    title: string;
    directory: string;
    time_created: number;
    time_updated: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    projectID: row.project_id,
    title: row.title,
    directory: row.directory,
    time: { created: row.time_created, updated: row.time_updated },
  }));
}

export function listMessageRowsSync(
  db: Database,
  sessionID: string,
  role?: "user" | "assistant",
): Message[] {
  const rows = db
    .query(
      `SELECT id, session_id, time_created, data
       FROM message WHERE session_id = ?
       ORDER BY time_created ASC`,
    )
    .all(sessionID) as Array<{
    id: string;
    session_id: string;
    time_created: number;
    data: string;
  }>;

  const out: Message[] = [];
  for (const row of rows) {
    const data = JSON.parse(row.data);
    if (role && data.role !== role) continue;
    out.push({
      id: row.id,
      sessionID: row.session_id,
      role: data.role,
      agent: data.agent || "",
      time: { created: row.time_created },
    });
  }
  return out;
}

export function listPartRowsSync(db: Database, messageID: string): Part[] {
  const rows = db
    .query(
      `SELECT id, message_id, session_id, data
       FROM part WHERE message_id = ?
       ORDER BY time_created ASC`,
    )
    .all(messageID) as Array<{
    id: string;
    message_id: string;
    session_id: string;
    data: string;
  }>;

  const out: Part[] = [];
  for (const row of rows) {
    const part = decodePart(row);
    if (part) out.push(part);
  }
  return out;
}

/**
 * Discriminated union of the JSON shapes we care about in `part.data`.
 */
type SearchablePartJson =
  | { type: "text"; text?: string }
  | { type: "tool"; tool?: string; state?: Part["state"] }
  | { type: "file" }
  | { type: "patch"; files?: string[] };

function isSearchableType(t: unknown): t is SearchablePartJson["type"] {
  return t === "text" || t === "tool" || t === "file" || t === "patch";
}

/**
 * Decode a raw part row into our Part shape, or null if it's a type we
 * don't search over (reasoning, step-start, etc), or the data is malformed.
 */
export function decodePart(row: {
  id: string;
  message_id: string;
  session_id: string;
  data: string;
}): Part | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.data);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const raw = parsed as { type?: unknown };
  if (!isSearchableType(raw.type)) return null;
  const data = raw as SearchablePartJson;

  const part: Part = {
    id: row.id,
    messageID: row.message_id,
    sessionID: row.session_id,
    type: data.type,
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

// ---------------------------------------------------------------------------
// Async generator wrappers (kept for back-compat with storage-provider.ts and
// any callers that still iterate via for-await). Internally these now use the
// sync helpers above, and accept an optional `db` so a parent scope can share
// one connection across many calls.
// ---------------------------------------------------------------------------

export async function* listSessionsSqlite(
  projectID: string | null,
  db?: Database,
): AsyncGenerator<Session> {
  const shouldClose = db === undefined;
  const _db = db ?? openDb();
  try {
    for (const session of listSessionRowsSync(_db, projectID)) {
      yield session;
    }
  } finally {
    if (shouldClose) _db.close();
  }
}

export async function* listMessagesSqlite(
  sessionID: string,
  role?: "user" | "assistant",
  db?: Database,
): AsyncGenerator<Message> {
  const shouldClose = db === undefined;
  const _db = db ?? openDb();
  try {
    for (const message of listMessageRowsSync(_db, sessionID, role)) {
      yield message;
    }
  } finally {
    if (shouldClose) _db.close();
  }
}

export async function* listPartsSqlite(
  messageID: string,
  db?: Database,
): AsyncGenerator<Part> {
  const shouldClose = db === undefined;
  const _db = db ?? openDb();
  try {
    for (const part of listPartRowsSync(_db, messageID)) {
      yield part;
    }
  } finally {
    if (shouldClose) _db.close();
  }
}
