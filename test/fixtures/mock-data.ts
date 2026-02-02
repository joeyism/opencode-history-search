import type { Session, Message, Part } from "../../src/storage";

export const MOCK_PROJECT_ID = "mock-project-123";

export const mockSessions: Session[] = [
  {
    id: "ses_001",
    projectID: MOCK_PROJECT_ID,
    title: "Implement storage layer",
    directory: "/mock/project",
    time: { created: 1706745600000, updated: 1706745600000 },
  },
  {
    id: "ses_002",
    projectID: MOCK_PROJECT_ID,
    title: "Fix authentication bug",
    directory: "/mock/project",
    time: { created: 1706659200000, updated: 1706659200000 },
  },
  {
    id: "ses_003",
    projectID: MOCK_PROJECT_ID,
    title: "Add fuzzy search feature",
    directory: "/mock/project",
    time: { created: 1706572800000, updated: 1706572800000 },
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
};

export async function* mockListSessions(
  projectID: string,
): AsyncGenerator<Session> {
  if (projectID === MOCK_PROJECT_ID) {
    for (const session of mockSessions) {
      yield session;
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
