import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { isInContext, outsideContextSql, type InContext } from "./in-context";
import { contextStartSqlite } from "./storage-sqlite";

function createDb(): Database {
  const db = new Database(":memory:");
  db.run(`CREATE TABLE session (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, slug TEXT NOT NULL,
    directory TEXT NOT NULL, title TEXT NOT NULL, version TEXT NOT NULL,
    time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL
  )`);
  db.run(`CREATE TABLE message (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
    time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE part (
    id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
    time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
  )`);
  return db;
}

function addMessage(
  db: Database,
  sessionID: string,
  id: string,
  time: number,
  info: object,
  parts: Array<object | string> = [],
): void {
  db.query("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run(
    id, sessionID, time, time, JSON.stringify(info),
  );
  parts.forEach((part, i) => {
    const data = typeof part === "string" ? part : JSON.stringify(part);
    db.query("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)").run(
      `${id}_part_${i}`, id, sessionID, time + i, time + i, data,
    );
  });
}

const user = { role: "user", agent: "build", summary: { diffs: [] } };
const text = (text: string) => ({ type: "text", text });
const compaction = (tail?: string) => ({
  type: "compaction",
  auto: true,
  overflow: false,
  ...(tail ? { tail_start_id: tail } : {}),
});
const summary = (parentID: string, extra: object = {}) => ({
  role: "assistant",
  agent: "compaction",
  summary: true,
  parentID,
  finish: "stop",
  ...extra,
});

describe("isInContext", () => {
  const message = (id: string, created: number) => ({ id, time: { created } });

  test("nothing is in context without a calling session", () => {
    expect(isInContext(undefined, "ses_a", message("msg_1", 1))).toBe(false);
  });

  test("other sessions are never in context", () => {
    const inContext: InContext = { sessionID: "ses_a" };
    expect(isInContext(inContext, "ses_b", message("msg_1", 1))).toBe(false);
  });

  test("the whole calling session is in context when it wasn't compacted", () => {
    const inContext: InContext = { sessionID: "ses_a" };
    expect(isInContext(inContext, "ses_a", message("msg_1", 1))).toBe(true);
  });

  test("a compacted session is in context from its first kept message on", () => {
    const inContext: InContext = {
      sessionID: "ses_a",
      since: { id: "msg_5", time: 500 },
    };
    expect(isInContext(inContext, "ses_a", message("msg_4", 400))).toBe(false);
    expect(isInContext(inContext, "ses_a", message("msg_5", 500))).toBe(true);
    expect(isInContext(inContext, "ses_a", message("msg_6", 600))).toBe(true);
  });

  test("messages created in the same millisecond are ordered by ID", () => {
    const inContext: InContext = {
      sessionID: "ses_a",
      since: { id: "msg_5", time: 500 },
    };
    expect(isInContext(inContext, "ses_a", message("msg_4", 500))).toBe(false);
    expect(isInContext(inContext, "ses_a", message("msg_6", 500))).toBe(true);
  });
});

describe("outsideContextSql", () => {
  let db: Database;

  beforeEach(() => {
    db = createDb();
    for (const sessionID of ["ses_a", "ses_b"]) {
      addMessage(db, sessionID, `${sessionID}_msg_1`, 100, user, [text("one")]);
      addMessage(db, sessionID, `${sessionID}_msg_2`, 200, user, [text("two")]);
      addMessage(db, sessionID, `${sessionID}_msg_3`, 300, user, [text("three")]);
    }
  });

  afterEach(() => {
    db.close();
  });

  function partsOutside(inContext: InContext | undefined): string[] {
    const outside = outsideContextSql(inContext, "p.session_id", "p.message_id");
    const rows = db
      .query(`SELECT p.id FROM part p WHERE ${outside.sql} ORDER BY p.id`)
      .all(...outside.binds) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  test("keeps every row without a calling session", () => {
    expect(partsOutside(undefined)).toHaveLength(6);
  });

  test("drops the whole calling session when it wasn't compacted", () => {
    expect(partsOutside({ sessionID: "ses_a" })).toEqual([
      "ses_b_msg_1_part_0",
      "ses_b_msg_2_part_0",
      "ses_b_msg_3_part_0",
    ]);
  });

  test("keeps the calling session's messages before the compaction cut", () => {
    const since = { id: "ses_a_msg_2", time: 200 };
    expect(partsOutside({ sessionID: "ses_a", since })).toEqual([
      "ses_a_msg_1_part_0",
      "ses_b_msg_1_part_0",
      "ses_b_msg_2_part_0",
      "ses_b_msg_3_part_0",
    ]);
  });
});

describe("contextStartSqlite", () => {
  let db: Database;

  beforeEach(() => {
    db = createDb();
    addMessage(db, "ses_a", "msg_01", 1000, user, [text("early question")]);
    addMessage(db, "ses_a", "msg_02", 2000, { role: "assistant", finish: "stop" }, [
      text("early answer"),
    ]);
    addMessage(db, "ses_a", "msg_03", 3000, user, [text("kept question")]);
  });

  afterEach(() => {
    db.close();
  });

  test("returns undefined for a session never compacted", () => {
    expect(contextStartSqlite("ses_a", db)).toBeUndefined();
  });

  test("returns the first message of the kept tail", () => {
    addMessage(db, "ses_a", "msg_04", 4000, user, [compaction("msg_03")]);
    addMessage(db, "ses_a", "msg_05", 5000, summary("msg_04"), [text("summary")]);
    addMessage(db, "ses_a", "msg_06", 6000, user, [text("continue")]);

    expect(contextStartSqlite("ses_a", db)).toEqual({ id: "msg_03", time: 3000 });
  });

  test("returns the compaction message when no tail was kept", () => {
    addMessage(db, "ses_a", "msg_04", 4000, user, [compaction()]);
    addMessage(db, "ses_a", "msg_05", 5000, summary("msg_04"), [text("summary")]);

    expect(contextStartSqlite("ses_a", db)).toEqual({ id: "msg_04", time: 4000 });
  });

  test("uses the latest completed compaction", () => {
    addMessage(db, "ses_a", "msg_04", 4000, user, [compaction("msg_02")]);
    addMessage(db, "ses_a", "msg_05", 5000, summary("msg_04"), [text("summary")]);
    addMessage(db, "ses_a", "msg_06", 6000, user, [text("more")]);
    addMessage(db, "ses_a", "msg_07", 7000, user, [compaction("msg_06")]);
    addMessage(db, "ses_a", "msg_08", 8000, summary("msg_07"), [text("summary")]);

    expect(contextStartSqlite("ses_a", db)).toEqual({ id: "msg_06", time: 6000 });
  });

  test("ignores compactions whose summary didn't finish", () => {
    addMessage(db, "ses_a", "msg_04", 4000, user, [compaction("msg_02")]);
    addMessage(db, "ses_a", "msg_05", 5000, summary("msg_04"), [text("summary")]);
    addMessage(db, "ses_a", "msg_06", 6000, user, [compaction("msg_03")]);
    addMessage(db, "ses_a", "msg_07", 7000, summary("msg_06", { finish: undefined }));

    expect(contextStartSqlite("ses_a", db)).toEqual({ id: "msg_02", time: 2000 });
  });

  test("ignores compactions whose summary failed", () => {
    addMessage(db, "ses_a", "msg_04", 4000, user, [compaction("msg_03")]);
    addMessage(db, "ses_a", "msg_05", 5000, summary("msg_04", {
      error: { name: "APIError", data: { message: "overloaded" } },
    }));

    expect(contextStartSqlite("ses_a", db)).toBeUndefined();
  });

  test("returns undefined when the kept tail's first message is gone", () => {
    addMessage(db, "ses_a", "msg_04", 4000, user, [compaction("msg_gone")]);
    addMessage(db, "ses_a", "msg_05", 5000, summary("msg_04"), [text("summary")]);

    expect(contextStartSqlite("ses_a", db)).toBeUndefined();
  });

  test("ignores other sessions' compactions", () => {
    addMessage(db, "ses_b", "msg_b1", 4000, user, [compaction()]);
    addMessage(db, "ses_b", "msg_b2", 5000, summary("msg_b1"), [text("summary")]);

    expect(contextStartSqlite("ses_a", db)).toBeUndefined();
  });

  test("skips malformed parts and messages", () => {
    addMessage(db, "ses_a", "msg_04", 4000, user, ['{"type":"compaction", oops']);
    addMessage(db, "ses_a", "msg_05", 5000, summary("msg_04"));
    db.query("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run(
      "msg_06", "ses_a", 6000, 6000, '{"summary": broken',
    );

    expect(contextStartSqlite("ses_a", db)).toBeUndefined();
  });
});
