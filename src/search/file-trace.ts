import type { Database } from "bun:sqlite";
import { getDbPath } from "../storage-sqlite";

export interface FileTraceResult {
  sessionID: string;
  sessionTitle: string;
  timestamp: number;
  firstTouch: boolean;
  userPrompt: string | null;
  toolName: string | null;
  filePath: string;
}

export interface TraceFileOptions {
  limit?: number;
}

export function traceFileSqlite(
  db: Database,
  projectID: string,
  queryPath: string,
  options?: TraceFileOptions
): FileTraceResult[] {
  const normalizedQuery = queryPath.replace(/\\/g, "/");
  const isExactPath = normalizedQuery.includes("/");

  // Use broad SQL LIKE matching, then refine to exact/basename rules in TypeScript.
  const likePattern = `%${normalizedQuery}%`;

  const sql = `
    SELECT
      s.id AS session_id,
      s.title AS session_title,
      m.id AS message_id,
      m.time_created AS message_time,
      json_extract(p.data, '$.tool') AS tool_name,
      json_extract(p.data, '$.state.input.filePath') AS matched_file_path_tool,
      json_extract(p.data, '$.files') AS matched_files_patch,
      0 AS source_priority
    FROM session s
    JOIN message m ON m.session_id = s.id
    JOIN part p ON p.message_id = m.id
    WHERE s.project_id = ?
      AND json_valid(p.data)
      AND json_extract(m.data, '$.role') = 'assistant'
      AND json_extract(p.data, '$.type') = 'tool'
      AND json_extract(p.data, '$.tool') IN ('write', 'edit')
      AND json_extract(p.data, '$.state.input.filePath') LIKE ?
      
    UNION ALL

    SELECT
      s.id AS session_id,
      s.title AS session_title,
      m.id AS message_id,
      m.time_created AS message_time,
      NULL AS tool_name,
      NULL AS matched_file_path_tool,
      p.data AS matched_files_patch, -- using whole data to parse files in TS since sqlite json_each might be tricky with versions
      1 AS source_priority
    FROM session s
    JOIN message m ON m.session_id = s.id
    JOIN part p ON p.message_id = m.id
    WHERE s.project_id = ?
      AND json_valid(p.data)
      AND json_extract(m.data, '$.role') = 'assistant'
      AND json_extract(p.data, '$.type') = 'patch'
      AND json_extract(p.data, '$.files') LIKE ?
    ORDER BY message_time DESC, source_priority ASC
  `;

  const rows = db.query(sql).all(projectID, likePattern, projectID, likePattern) as Array<{
    session_id: string;
    session_title: string;
    message_id: string;
    message_time: number;
    tool_name: string | null;
    matched_file_path_tool: string | null;
    matched_files_patch: string | null;
    source_priority: number;
  }>;

  const candidates: Array<{
    sessionID: string;
    sessionTitle: string;
    messageID: string;
    timestamp: number;
    toolName: string | null;
    filePath: string;
  }> = [];

  for (const row of rows) {
    let matchedPath: string | null = null;
    
    if (row.source_priority === 0 && row.matched_file_path_tool) {
      if (isMatch(row.matched_file_path_tool, normalizedQuery, isExactPath)) {
        matchedPath = row.matched_file_path_tool;
      }
    } else if (row.source_priority === 1 && row.matched_files_patch) {
      try {
        const parsed = JSON.parse(row.matched_files_patch);
        if (Array.isArray(parsed.files)) {
          for (const f of parsed.files) {
            if (isMatch(f, normalizedQuery, isExactPath)) {
              matchedPath = f;
              break;
            }
          }
        }
      } catch {
        continue;
      }
    }

    if (matchedPath) {
      candidates.push({
        sessionID: row.session_id,
        sessionTitle: row.session_title,
        messageID: row.message_id,
        timestamp: row.message_time,
        toolName: row.tool_name,
        filePath: matchedPath,
      });
    }
  }

  // Deduplicate by sessionID + messageID + filePath
  // Since SQL orders by message_time DESC, source_priority ASC (tool before patch)
  // we just keep the first one we see for a given key.
  const seen = new Set<string>();
  const deduped: typeof candidates = [];
  for (const c of candidates) {
    const key = `${c.sessionID}|${c.messageID}|${c.filePath}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(c);
    }
  }

  // Find firstTouch
  let earliestTime = Infinity;
  let earliestIndex = -1;
  for (let i = 0; i < deduped.length; i++) {
    const candidate = deduped[i];
    if (candidate && candidate.timestamp < earliestTime) {
      earliestTime = candidate.timestamp;
      earliestIndex = i;
    }
  }

  // Lookup user prompts
  const findUserPrompt = db.query(`
    SELECT json_extract(p.data, '$.text') AS text
    FROM message m
    JOIN part p ON p.message_id = m.id
    WHERE m.session_id = ?
      AND m.time_created < ?
      AND json_valid(p.data)
      AND json_extract(m.data, '$.role') = 'user'
      AND json_extract(p.data, '$.type') = 'text'
    ORDER BY m.time_created DESC
    LIMIT 1
  `);

  const results: FileTraceResult[] = deduped.map((c, idx) => {
    const promptRow = findUserPrompt.get(c.sessionID, c.timestamp) as { text: string } | undefined;
    return {
      sessionID: c.sessionID,
      sessionTitle: c.sessionTitle,
      timestamp: c.timestamp,
      firstTouch: idx === earliestIndex,
      userPrompt: promptRow ? promptRow.text : null,
      toolName: c.toolName,
      filePath: c.filePath,
    };
  });

  const limit = options?.limit ?? 50;
  return results.slice(0, limit);
}

function isMatch(path: string, query: string, isExact: boolean): boolean {
  if (isExact) {
    return path === query;
  }
  return path === query || path.endsWith(`/${query}`);
}

export async function traceFile(
  projectID: string,
  filePath: string,
  options?: TraceFileOptions
): Promise<FileTraceResult[]> {
  const { Database } = await import("bun:sqlite");
  const dbPath = getDbPath();
  const db = new Database(dbPath, { readonly: true });
  try {
    return traceFileSqlite(db, projectID, filePath, options);
  } finally {
    db.close();
  }
}
