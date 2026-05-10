import path from "path";
import os from "os";
import fs from "fs";
import { Glob } from "bun";

export interface Session {
  id: string;
  projectID: string;
  title: string;
  directory: string;
  time: { created: number; updated: number };
}

export interface Message {
  id: string;
  sessionID: string;
  role: "user" | "assistant";
  agent: string;
  time: { created: number };
}

export interface Part {
  id: string;
  messageID: string;
  sessionID: string;
  type: "text" | "tool" | "file" | "patch";
  text?: string;
  tool?: string;
  state?: {
    input?: any;
    output?: string;
    title?: string;
  };
  files?: string[]; // For patch parts — list of modified file paths
}

export async function getStorageDir(): Promise<string> {
  const xdgData =
    process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(xdgData, "opencode", "storage");
}

export async function getCurrentProjectID(): Promise<string> {
  const proc = Bun.spawn(["git", "rev-list", "--max-parents=0", "--all"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(proc.stdout).text();
  const commits = output.split("\n").filter(Boolean).sort();
  return commits[0] || "global";
}

export async function* listSessions(
  projectID: string | null,
): AsyncGenerator<Session> {
  const storageDir = await getStorageDir();
  const sessionDir = path.join(storageDir, "session");

  if (projectID !== null) {
    const projectDir = path.join(sessionDir, projectID);
    try {
      for await (const file of new Glob("*.json").scan({ cwd: projectDir })) {
        try {
          const content = await Bun.file(path.join(projectDir, file)).json();
          yield content as Session;
        } catch {
          continue;
        }
      }
    } catch {
      return;
    }
    return;
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(sessionDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const projectDir = path.join(sessionDir, entry);
    let stat: fs.FileStats;
    try {
      stat = fs.statSync(projectDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    try {
      for await (const file of new Glob("*.json").scan({ cwd: projectDir })) {
        try {
          const content = await Bun.file(path.join(projectDir, file)).json();
          yield content as Session;
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }
}

export async function* listMessages(
  sessionID: string,
  role?: "user" | "assistant",
): AsyncGenerator<Message> {
  const storageDir = await getStorageDir();
  const messageDir = path.join(storageDir, "message", sessionID.trim());

  try {
    for await (const file of new Glob("*.json").scan({ cwd: messageDir })) {
      try {
        const content = await Bun.file(path.join(messageDir, file)).json();
        if (role && content.role !== role) continue;
        yield content as Message;
      } catch {
        continue;
      }
    }
  } catch {
    return;
  }
}

export async function* listParts(messageID: string): AsyncGenerator<Part> {
  const storageDir = await getStorageDir();
  const partDir = path.join(storageDir, "part", messageID.trim());

  try {
    for await (const file of new Glob("*.json").scan({ cwd: partDir })) {
      try {
        const content = await Bun.file(path.join(partDir, file)).json();
        yield content as Part;
      } catch {
        continue;
      }
    }
  } catch {
    return;
  }
}
