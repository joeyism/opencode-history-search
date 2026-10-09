import type { Database } from "bun:sqlite";
import { outsideContextSql, type InContext } from "../in-context";

export interface MultitermSqlOptions {
  limit: number;
  inContext?: InContext;
}

export interface MultitermSqlResult {
  sql: string;
  binds: any[];
}

export interface MultitermSearchMatch {
  sessionID: string;
  sessionTitle: string;
  timestamp: number;
  projectDirectory: string;
  termHits: Map<string, { partID: string; matchType: string; excerpt: string }>;
}

export function buildMultitermSql(
  terms: string[],
  projectID: string | null,
  options: MultitermSqlOptions,
): MultitermSqlResult {
  if (terms.length === 0) {
    throw new Error("terms array must contain at least one term");
  }

  // A match on the calling session's title would only point at the caller.
  const titleFilter = options.inContext ? " AND s.id != ?" : "";
  const conditions = terms
    .map((_, i) =>
      `MAX(CASE WHEN p.data LIKE ? ESCAPE '\\' OR (s.title LIKE ? ESCAPE '\\'${titleFilter}) THEN 1 ELSE 0 END) AS match_${i}`
    )
    .join(", ");

  const having = terms
    .map((_, i) => `match_${i} = 1`)
    .join(" AND ");

  const projectFilter = projectID !== null ? "AND s.project_id = ?" : "";
  const outside = outsideContextSql(options.inContext, "p.session_id", "p.message_id");

  const sql = `
    SELECT s.id AS session_id, s.title, s.directory, s.time_updated, ${conditions}
    FROM session s
    JOIN part p ON p.session_id = s.id
    WHERE 1=1
      ${projectFilter}
      AND ${outside.sql}
    GROUP BY s.id
    HAVING ${having}
    ORDER BY s.time_updated DESC
    LIMIT ${options.limit}
  `.trim();

  const binds: any[] = [];
  for (const term of terms) {
    const escaped = term.replace(/[%_\\]/g, "\\$&");
    binds.push(`%${escaped}%`);
    binds.push(`%${escaped}%`);
    if (options.inContext) binds.push(options.inContext.sessionID);
  }
  if (projectID !== null) {
    binds.push(projectID);
  }
  binds.push(...outside.binds);

  return { sql, binds };
}

export function searchMultitermSqlite(
  db: Database,
  projectID: string | null,
  terms: string[],
  options?: { limit?: number; inContext?: InContext },
): MultitermSearchMatch[] {
  const { sql, binds } = buildMultitermSql(terms, projectID, {
    limit: options?.limit ?? 50,
    inContext: options?.inContext,
  });

  type Row = {
    session_id: string;
    title: string;
    directory: string;
    time_updated: number;
  };

  const rows = db.query(sql).all(...binds) as Row[];

  if (rows.length === 0) {
    return [];
  }

  const placeholder = rows.map(() => "?").join(",");
  const sessionBinds: string[] = rows.map((r) => r.session_id);

  const termConditions: string[] = [];
  const allFollowBinds: Array<string | number> = [];
  for (const term of terms) {
    const escaped = term.replace(/[%_\\]/g, "\\$&");
    termConditions.push("(data LIKE ? ESCAPE '\\' OR session_id IN (" + placeholder + "))");
    allFollowBinds.push(`%${escaped}%`);
    for (const sid of sessionBinds) {
      allFollowBinds.push(sid);
    }
  }

  const outside = outsideContextSql(options?.inContext, "session_id", "message_id");
  allFollowBinds.push(...outside.binds);

  const sqlFollow = `
    SELECT session_id, id AS part_id, data
    FROM part
    WHERE ${termConditions.join(" AND ")}
      AND ${outside.sql}
    ORDER BY time_created ASC
  `;

  type FollowRow = { session_id: string; part_id: string; data: string };
  const followRows = db.query(sqlFollow).all(...allFollowBinds) as FollowRow[];

  const termHitsBySession = new Map<string, Map<string, { partID: string; matchType: string; excerpt: string }>>();

  for (const row of followRows) {
    if (!termHitsBySession.has(row.session_id)) {
      termHitsBySession.set(row.session_id, new Map());
    }
    const sessionMap = termHitsBySession.get(row.session_id)!;
    if (sessionMap.size >= terms.length) continue;

    for (const term of terms) {
      if (sessionMap.has(term)) continue;
      const lower = row.data.toLowerCase();
      const termLower = term.toLowerCase();
      if (lower.includes(termLower)) {
        const idx = lower.indexOf(termLower);
        const start = Math.max(0, idx - 50);
        const end = Math.min(row.data.length, idx + termLower.length + 50);
        sessionMap.set(term, {
          partID: row.part_id,
          matchType: "data",
          excerpt: row.data.slice(start, end),
        });
      }
    }
  }

  return rows.map((row) => ({
    sessionID: row.session_id,
    sessionTitle: row.title,
    timestamp: row.time_updated,
    projectDirectory: row.directory,
    termHits: termHitsBySession.get(row.session_id) ?? new Map(),
  }));
}

export async function searchMultiterm(
  projectID: string | null,
  terms: string[],
  options?: { limit?: number; inContext?: InContext },
): Promise<MultitermSearchMatch[]> {
  const { Database } = await import("bun:sqlite");
  const { getDbPath } = await import("../storage-sqlite");
  const dbPath = getDbPath();
  const db = new Database(dbPath, { readonly: true });
  try {
    return searchMultitermSqlite(db, projectID, terms, options);
  } finally {
    db.close();
  }
}
