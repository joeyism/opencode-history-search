/**
 * Date filtering utilities for search results
 * Supports natural language dates: "today", "yesterday", "last N days/weeks/months"
 * Supports ISO dates: "YYYY-MM-DD"
 * Supports date ranges: "YYYY-MM-DD to YYYY-MM-DD"
 */

export interface DateRange {
  start: Date;
  end: Date;
}

/**
 * Parse a date filter string into a DateRange
 * @param filter Date filter string (e.g., "today", "last 7 days", "2024-01-15", "2024-01-01 to 2024-01-31")
 * @returns DateRange object with start and end dates (inclusive)
 * @throws Error if the filter format is invalid
 */
export function parseDateFilter(filter: string): DateRange {
  const normalized = filter.trim().toLowerCase();

  // Today: 00:00:00 to 23:59:59 today
  if (normalized === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  // Yesterday: 00:00:00 to 23:59:59 yesterday
  if (normalized === "yesterday") {
    const start = new Date();
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  // "last N days/weeks/months" - from N units ago until now
  const relativeMatch = normalized.match(/^last (\d+) (day|week|month)s?$/);
  if (relativeMatch && relativeMatch[1] && relativeMatch[2]) {
    const count = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const end = new Date();
    const start = new Date();

    if (unit === "day") {
      start.setDate(start.getDate() - count);
    } else if (unit === "week") {
      start.setDate(start.getDate() - count * 7);
    } else if (unit === "month") {
      start.setMonth(start.getMonth() - count);
    }

    start.setHours(0, 0, 0, 0);
    return { start, end };
  }

  // Date range: "YYYY-MM-DD to YYYY-MM-DD"
  const rangeMatch = normalized.match(
    /^(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})$/,
  );
  if (rangeMatch && rangeMatch[1] && rangeMatch[2]) {
    const start = new Date(rangeMatch[1]);
    const end = new Date(rangeMatch[2]);
    end.setHours(23, 59, 59, 999); // Include entire end date

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error(`Invalid date range: ${filter}`);
    }

    if (start > end) {
      throw new Error(`Start date must be before end date: ${filter}`);
    }

    return { start, end };
  }

  // Single date: "YYYY-MM-DD" or "YYYY-MM" (month)
  const isoMatch = normalized.match(/^(\d{4}-\d{2}(?:-\d{2})?)$/);
  if (isoMatch && isoMatch[1]) {
    const dateStr = isoMatch[1];

    // Month only (YYYY-MM)
    if (dateStr.match(/^\d{4}-\d{2}$/)) {
      const start = new Date(`${dateStr}-01`);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      end.setDate(0); // Last day of month
      end.setHours(23, 59, 59, 999);

      if (isNaN(start.getTime())) {
        throw new Error(`Invalid date: ${filter}`);
      }

      return { start, end };
    }

    // Full date (YYYY-MM-DD)
    const start = new Date(dateStr);
    const end = new Date(dateStr);
    end.setHours(23, 59, 59, 999);

    if (isNaN(start.getTime())) {
      throw new Error(`Invalid date: ${filter}`);
    }

    return { start, end };
  }

  throw new Error(
    `Unrecognized date filter format: ${filter}. Supported formats: "today", "yesterday", "last N days/weeks/months", "YYYY-MM-DD", "YYYY-MM", "YYYY-MM-DD to YYYY-MM-DD"`,
  );
}

/**
 * Filter search results by date range
 * @param results Array of search results with timestamp field (milliseconds since epoch)
 * @param dateRange DateRange to filter by
 * @returns Filtered array containing only results within the date range
 */
export function filterByDate<T extends { timestamp: number }>(
  results: T[],
  dateRange: DateRange,
): T[] {
  return results.filter((result) => {
    const timestamp = new Date(result.timestamp);
    return timestamp >= dateRange.start && timestamp <= dateRange.end;
  });
}
