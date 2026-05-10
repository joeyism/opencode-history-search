import type { Session, Message, Part } from "../../src/storage";

export const MOCK_PROJECT_ID = "mock-project-123";
export const MOCK_PROJECT_ID_2 = "mock-project-789";
export const MOCK_PROJECT_DIR = "/mock/project";
export const MOCK_PROJECT_DIR_2 = "/mock/other-project";

export const mockSessions: Session[] = [
  {
    id: "ses_001",
    projectID: MOCK_PROJECT_ID,
    title: "Implement storage layer",
    directory: MOCK_PROJECT_DIR,
    time: { created: 1706745600000, updated: 1706745600000 },
  },
  {
    id: "ses_002",
    projectID: MOCK_PROJECT_ID,
    title: "Fix authentication bug",
    directory: MOCK_PROJECT_DIR,
    time: { created: 1706659200000, updated: 1706659200000 },
  },
  {
    id: "ses_003",
    projectID: MOCK_PROJECT_ID,
    title: "Add fuzzy search feature",
    directory: MOCK_PROJECT_DIR,
    time: { created: 1706572800000, updated: 1706572800000 },
  },
  {
    id: "ses_004",
    projectID: MOCK_PROJECT_ID_2,
    title: "Refactor database connection pool",
    directory: MOCK_PROJECT_DIR_2,
    time: { created: 1706832000000, updated: 1706832000000 },
  },
  {
    id: "ses_005",
    projectID: MOCK_PROJECT_ID_2,
    title: "Implement caching layer",
    directory: MOCK_PROJECT_DIR_2,
    time: { created: 1706572800000, updated: 1706572800000 },
  },
  {
    id: "ses_006",
    projectID: MOCK_PROJECT_ID_2,
    title: "Fix memory leak in worker thread",
    directory: MOCK_PROJECT_DIR_2,
    time: { created: 1707004800000, updated: 1707004800000 },
  },
];

export const mockMessages: Record<string, Message[]> = {
  ses_001: [
    {
      id: "msg_001",
      sessionID: "ses_001",
      role: "user",
      agent: "user",
      time: { created: 1706745600000 },
    },
    {
      id: "msg_002",
      sessionID: "ses_001",
      role: "assistant",
      agent: "build",
      time: { created: 1706745601000 },
    },
  ],
  ses_002: [
    {
      id: "msg_003",
      sessionID: "ses_002",
      role: "user",
      agent: "user",
      time: { created: 1706659200000 },
    },
  ],
  ses_003: [
    {
      id: "msg_004",
      sessionID: "ses_003",
      role: "user",
      agent: "user",
      time: { created: 1706572800000 },
    },
  ],
  ses_004: [
    {
      id: "msg_005",
      sessionID: "ses_004",
      role: "user",
      agent: "user",
      time: { created: 1706832000000 },
    },
    {
      id: "msg_006",
      sessionID: "ses_004",
      role: "assistant",
      agent: "build",
      time: { created: 1706832001000 },
    },
  ],
  ses_005: [
    {
      id: "msg_007",
      sessionID: "ses_005",
      role: "user",
      agent: "user",
      time: { created: 1706572800000 },
    },
  ],
  ses_006: [
    {
      id: "msg_008",
      sessionID: "ses_006",
      role: "user",
      agent: "user",
      time: { created: 1707004800000 },
    },
  ],
};

export const mockParts: Record<string, Part[]> = {
  msg_001: [
    {
      id: "part_001",
      messageID: "msg_001",
      sessionID: "ses_001",
      type: "text",
      text: "Can you help me implement a storage module for our app?",
    },
  ],
  msg_002: [
    {
      id: "part_002",
      messageID: "msg_002",
      sessionID: "ses_001",
      type: "text",
      text: "I'll help you create a storage module with localStorage and IndexedDB support.",
    },
    {
      id: "part_003",
      messageID: "msg_002",
      sessionID: "ses_001",
      type: "tool",
      tool: "edit",
      state: {
        input: { filePath: "src/storage.ts" },
        output: "Created storage.ts",
        title: "Create storage module",
      },
    },
    {
      id: "part_006",
      messageID: "msg_002",
      sessionID: "ses_001",
      type: "patch",
      files: ["src/storage.ts", "src/utils/helpers.ts"],
    },
  ],
  msg_003: [
    {
      id: "part_004",
      messageID: "msg_003",
      sessionID: "ses_002",
      type: "text",
      text: "The authentication is broken, users can't log in",
    },
  ],
  msg_004: [
    {
      id: "part_005",
      messageID: "msg_004",
      sessionID: "ses_003",
      type: "text",
      text: "I need fuzzy search functionality for the search bar",
    },
  ],
  msg_005: [
    {
      id: "part_007",
      messageID: "msg_005",
      sessionID: "ses_004",
      type: "text",
      text: "We need to implement a database connection pool for the API server",
    },
  ],
  msg_006: [
    {
      id: "part_008",
      messageID: "msg_006",
      sessionID: "ses_004",
      type: "text",
      text: "I'll create a connection pool module with pooling and health checks.",
    },
    {
      id: "part_009",
      messageID: "msg_006",
      sessionID: "ses_004",
      type: "tool",
      tool: "write",
      state: {
        input: { filePath: "src/db/pool.ts" },
        output: "Created src/db/pool.ts",
        title: "Write connection pool",
      },
    },
    {
      id: "part_010",
      messageID: "msg_006",
      sessionID: "ses_004",
      type: "patch",
      files: ["src/db/pool.ts", "src/db/index.ts"],
    },
  ],
  msg_007: [
    {
      id: "part_011",
      messageID: "msg_007",
      sessionID: "ses_005",
      type: "text",
      text: "Add Redis caching layer in front of the database",
    },
  ],
  msg_008: [
    {
      id: "part_012",
      messageID: "msg_008",
      sessionID: "ses_006",
      type: "text",
      text: "The worker thread is leaking memory after about 100 requests",
    },
  ],
};

export async function* mockListSessions(
  projectID: string | null,
): AsyncGenerator<Session> {
  if (projectID === null) {
    for (const session of mockSessions) {
      yield session;
    }
  } else if (projectID === MOCK_PROJECT_ID || projectID === MOCK_PROJECT_ID_2) {
    for (const session of mockSessions) {
      if (session.projectID === projectID) {
        yield session;
      }
    }
  }
}

export async function* mockListMessages(
  sessionID: string,
): AsyncGenerator<Message> {
  const messages = mockMessages[sessionID] || [];
  for (const message of messages) {
    yield message;
  }
}

export async function* mockListParts(messageID: string): AsyncGenerator<Part> {
  const parts = mockParts[messageID] || [];
  for (const part of parts) {
    yield part;
  }
}