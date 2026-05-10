import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { getStorageDir, getCurrentProjectID, listSessions } from "./storage";
import type { Session } from "./storage";
import {
  MOCK_PROJECT_ID,
  MOCK_PROJECT_ID_2,
  MOCK_PROJECT_DIR,
  MOCK_PROJECT_DIR_2,
} from "../test/fixtures/mock-data";
import fs from "fs";
import path from "path";

test("getStorageDir returns valid path", async () => {
  const dir = await getStorageDir();
  expect(dir).toContain("opencode/storage");
});

test("getCurrentProjectID returns non-empty string", async () => {
  const id = await getCurrentProjectID();
  expect(id.length).toBeGreaterThan(0);
});

describe("listSessions", () => {
  let savedXdgData: string | undefined;

  describe("global (projectID = null)", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync("/tmp/test-global-sessions-");
      savedXdgData = process.env.XDG_DATA_HOME;
    });

    afterEach(() => {
      if (savedXdgData) {
        process.env.XDG_DATA_HOME = savedXdgData;
      } else {
        delete process.env.XDG_DATA_HOME;
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function sessionDir(): string {
      return path.join(tmpDir, "opencode", "storage", "session");
    }

    test("listSessions(null) returns sessions from multiple project directories", async () => {
      const proj1Dir = path.join(sessionDir(), MOCK_PROJECT_ID);
      const proj2Dir = path.join(sessionDir(), MOCK_PROJECT_ID_2);
      fs.mkdirSync(proj1Dir, { recursive: true });
      fs.mkdirSync(proj2Dir, { recursive: true });
      fs.writeFileSync(
        path.join(proj1Dir, "ses_001.json"),
        JSON.stringify({
          id: "ses_001",
          projectID: MOCK_PROJECT_ID,
          title: "Session One",
          directory: MOCK_PROJECT_DIR,
          time: { created: 1000, updated: 1000 },
        }),
      );
      fs.writeFileSync(
        path.join(proj2Dir, "ses_004.json"),
        JSON.stringify({
          id: "ses_004",
          projectID: MOCK_PROJECT_ID_2,
          title: "Session Four",
          directory: MOCK_PROJECT_DIR_2,
          time: { created: 2000, updated: 2000 },
        }),
      );

      process.env.XDG_DATA_HOME = tmpDir;

      const sessions: Session[] = [];
      for await (const session of listSessions(null)) {
        sessions.push(session);
      }

      expect(sessions.length).toBe(2);
      const ids = sessions.map((s) => s.id).sort();
      expect(ids).toEqual(["ses_001", "ses_004"]);
    });

    test("listSessions(null) skips directories that fail to read", async () => {
      const projDir = path.join(sessionDir(), MOCK_PROJECT_ID);
      const badDir = path.join(sessionDir(), "bad-project");
      fs.mkdirSync(projDir, { recursive: true });
      fs.mkdirSync(badDir, { recursive: true });
      fs.writeFileSync(
        path.join(projDir, "ses_001.json"),
        JSON.stringify({
          id: "ses_001",
          projectID: MOCK_PROJECT_ID,
          title: "Good session",
          directory: MOCK_PROJECT_DIR,
          time: { created: 1000, updated: 1000 },
        }),
      );
      fs.writeFileSync(path.join(badDir, "ses_x.json"), "not-valid-json{");

      process.env.XDG_DATA_HOME = tmpDir;

      const sessions: Session[] = [];
      for await (const session of listSessions(null)) {
        sessions.push(session);
      }

      expect(sessions.length).toBe(1);
      expect(sessions[0]?.id).toBe("ses_001");
    });

    test("listSessions(null) returns empty when session directory does not exist", async () => {
      process.env.XDG_DATA_HOME = tmpDir;

      const sessions: Session[] = [];
      for await (const session of listSessions(null)) {
        sessions.push(session);
      }

      expect(sessions.length).toBe(0);
    });

    test("listSessions(MOCK_PROJECT_ID) still returns scoped results", async () => {
      const projDir = path.join(sessionDir(), MOCK_PROJECT_ID);
      fs.mkdirSync(projDir, { recursive: true });
      fs.writeFileSync(
        path.join(projDir, "ses_001.json"),
        JSON.stringify({
          id: "ses_001",
          projectID: MOCK_PROJECT_ID,
          title: "Session One",
          directory: MOCK_PROJECT_DIR,
          time: { created: 1000, updated: 1000 },
        }),
      );

      process.env.XDG_DATA_HOME = tmpDir;

      const sessions: Session[] = [];
      for await (const session of listSessions(MOCK_PROJECT_ID)) {
        sessions.push(session);
      }

      expect(sessions.length).toBe(1);
      expect(sessions[0]?.id).toBe("ses_001");
    });
  });
});