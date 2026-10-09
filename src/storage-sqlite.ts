import { Database } from "bun:sqlite";
import path from "path";
import os from "os";
import type { Session, Message, Part } from "./storage";
import type { MessageRef } from "./in-context";

export function getDbPath(): string {
  const xdgData =
    process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(xdgData, "opencode", "opencode.db");
}

export function dbExists(): boolean {
  try {
    return Bun.file(getDbPath()).size > 0;
  } catch {
    return false;
  }
}

function openDb(): Database {
  return new Database(getDbPath(), { readonly: true });
}

export async function* listSessionsSqlite(
  projectID: string | null,
  db?: Database,
): AsyncGenerator<Session> {
  const shouldClose = db === undefined;
  const _db = db ?? openDb();
  try {
    const rows = (
      projectID
        ? _db
            .query(
              `SELECT id, project_id, title, directory, time_created, time_updated
               FROM session WHERE project_id = ?
               ORDER BY time_updated DESC`,
            )
            .all(projectID)
        : _db
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

    for (const row of rows) {
      yield {
        id: row.id,
        projectID: row.project_id,
        title: row.title,
        directory: row.directory,
        time: { created: row.time_created, updated: row.time_updated },
      };
    }
  } finally {
    if (shouldClose) _db.close();
  }
}

export async function* listMessagesSqlite(
  sessionID: string,
  role?: "user" | "assistant",
): AsyncGenerator<Message> {
  const db = openDb();
  try {
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

    for (const row of rows) {
      const data = JSON.parse(row.data);
      if (role && data.role !== role) continue;
      yield {
        id: row.id,
        sessionID: row.session_id,
        role: data.role,
        agent: data.agent || "",
        time: { created: row.time_created },
      };
    }
  } finally {
    db.close();
  }
}

export async function* listPartsSqlite(
  messageID: string,
): AsyncGenerator<Part> {
  const db = openDb();
  try {
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

    for (const row of rows) {
      const data = JSON.parse(row.data);

      // Map SQLite part types to our interface types
      const type =
        data.type === "text"
          ? "text"
          : data.type === "tool"
            ? "tool"
            : data.type === "file"
              ? "file"
              : data.type === "patch"
                ? "patch"
                : null;

      if (!type) continue; // Skip step-start, step-finish, reasoning, compaction, agent, etc.

      const part: Part = {
        id: row.id,
        messageID: row.message_id,
        sessionID: row.session_id,
        type: type as "text" | "tool" | "file" | "patch",
      };

      if (type === "text") {
        part.text = data.text;
      } else if (type === "tool") {
        part.tool = data.tool;
        part.state = data.state;
      } else if (type === "patch") {
        part.files = data.files;
      }

      yield part;
    }
  } finally {
    db.close();
  }
}

function parseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Finds the first message of a session that is still in its context.
 *
 * Mirrors OpenCode's `filterCompacted`: the latest compaction whose summary
 * finished without an error cuts the session at the first message of the
 * tail it kept verbatim (`tail_start_id`), or at the compaction message when
 * it kept none. Returns undefined when the whole session is in context: when
 * it was never compacted, or when the tail's first message no longer exists,
 * where OpenCode keeps everything too.
 */
export function contextStartSqlite(
  sessionID: string,
  db?: Database,
): MessageRef | undefined {
  const shouldClose = db === undefined;
  const _db = db ?? openDb();
  try {
    const summarized = new Set<string>();
    const messages = _db
      .query(
        `SELECT data FROM message
         WHERE session_id = ? AND data LIKE '%"summary"%'`,
      )
      .all(sessionID) as Array<{ data: string }>;
    for (const row of messages) {
      const info = parseJson(row.data);
      if (
        info?.role === "assistant" &&
        info.summary === true &&
        info.finish &&
        !info.error &&
        typeof info.parentID === "string"
      ) {
        summarized.add(info.parentID);
      }
    }
    if (summarized.size === 0) return undefined;

    const compactions = _db
      .query(
        `SELECT m.id, m.time_created, m.data AS message, p.data AS part
         FROM part p
         JOIN message m ON m.id = p.message_id
         WHERE p.session_id = ? AND p.data LIKE '%"compaction"%'
         ORDER BY m.time_created DESC, m.id DESC`,
      )
      .all(sessionID) as Array<{
      id: string;
      time_created: number;
      message: string;
      part: string;
    }>;
    for (const row of compactions) {
      if (!summarized.has(row.id)) continue;
      const part = parseJson(row.part);
      if (part?.type !== "compaction") continue;
      if (parseJson(row.message)?.role !== "user") continue;

      if (!part.tail_start_id) return { id: row.id, time: row.time_created };
      const tail = _db
        .query(
          `SELECT id, time_created FROM message
           WHERE id = ? AND session_id = ?`,
        )
        .get(part.tail_start_id, sessionID) as
        | { id: string; time_created: number }
        | null;
      return tail ? { id: tail.id, time: tail.time_created } : undefined;
    }
    return undefined;
  } finally {
    if (shouldClose) _db.close();
  }
}
