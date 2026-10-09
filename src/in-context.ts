/**
 * A message, identified the way OpenCode orders a session's messages: by
 * creation time, then by ID.
 */
export interface MessageRef {
  id: string;
  time: number;
}

/**
 * The part of the calling session that is already in its context.
 *
 * Searches leave it out of their results: the caller already has it, and the
 * calling session would otherwise always match, since OpenCode stores the
 * running tool call, query included, before executing it.
 */
export interface InContext {
  sessionID: string;
  /**
   * The first message still in context, when the session was compacted.
   * Messages before it survive only in the compaction summary, so they stay
   * searchable. Absent when the whole session is in context.
   */
  since?: MessageRef;
}

/** Whether a message of the given session is in the caller's context. */
export function isInContext(
  inContext: InContext | undefined,
  sessionID: string,
  message: { id: string; time: { created: number } },
): boolean {
  if (!inContext || inContext.sessionID !== sessionID) return false;
  const since = inContext.since;
  if (!since) return true;
  const time = message.time.created;
  return time > since.time || (time === since.time && message.id >= since.id);
}

/**
 * An SQL condition that holds for rows outside the caller's context.
 *
 * @param sessionColumn - Expression holding the row's session ID.
 * @param messageColumn - Expression holding the row's message ID.
 */
export function outsideContextSql(
  inContext: InContext | undefined,
  sessionColumn: string,
  messageColumn: string,
): { sql: string; binds: Array<string | number> } {
  if (!inContext) return { sql: "1 = 1", binds: [] };

  const { sessionID, since } = inContext;
  if (!since) return { sql: `${sessionColumn} != ?`, binds: [sessionID] };

  return {
    sql: `(${sessionColumn} != ? OR ${messageColumn} IN (
      SELECT id FROM message
      WHERE session_id = ?
        AND (time_created < ? OR (time_created = ? AND id < ?))
    ))`,
    binds: [sessionID, sessionID, since.time, since.time, since.id],
  };
}
