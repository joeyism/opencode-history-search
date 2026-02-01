import { describe, test, expect } from "bun:test";
import { parseDateFilter, filterByDate, type DateRange } from "./date-filter";

describe("parseDateFilter", () => {
  test("parses 'today' to current day range", () => {
    const result = parseDateFilter("today");
    const now = new Date();

    expect(result.start.getFullYear()).toBe(now.getFullYear());
    expect(result.start.getMonth()).toBe(now.getMonth());
    expect(result.start.getDate()).toBe(now.getDate());
    expect(result.start.getHours()).toBe(0);
    expect(result.start.getMinutes()).toBe(0);

    expect(result.end.getFullYear()).toBe(now.getFullYear());
    expect(result.end.getMonth()).toBe(now.getMonth());
    expect(result.end.getDate()).toBe(now.getDate());
    expect(result.end.getHours()).toBe(23);
    expect(result.end.getMinutes()).toBe(59);
  });

  test("parses 'yesterday' to previous day range", () => {
    const result = parseDateFilter("yesterday");
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    expect(result.start.getFullYear()).toBe(yesterday.getFullYear());
    expect(result.start.getMonth()).toBe(yesterday.getMonth());
    expect(result.start.getDate()).toBe(yesterday.getDate());
    expect(result.start.getHours()).toBe(0);

    expect(result.end.getFullYear()).toBe(yesterday.getFullYear());
    expect(result.end.getMonth()).toBe(yesterday.getMonth());
    expect(result.end.getDate()).toBe(yesterday.getDate());
    expect(result.end.getHours()).toBe(23);
  });

  test("parses 'last N days' correctly", () => {
    const result = parseDateFilter("last 7 days");
    const now = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    expect(result.start.getDate()).toBe(sevenDaysAgo.getDate());
    expect(result.start.getHours()).toBe(0);
    expect(result.end.getTime()).toBeGreaterThanOrEqual(now.getTime() - 1000);
  });

  test("parses 'last N weeks' correctly", () => {
    const result = parseDateFilter("last 2 weeks");
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    expect(result.start.getDate()).toBe(fourteenDaysAgo.getDate());
    expect(result.start.getHours()).toBe(0);
  });

  test("parses 'last N months' correctly", () => {
    const result = parseDateFilter("last 3 months");
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    expect(result.start.getMonth()).toBe(threeMonthsAgo.getMonth());
    expect(result.start.getHours()).toBe(0);
  });

  test("handles singular 'last 1 day'", () => {
    const result = parseDateFilter("last 1 day");
    expect(result.start).toBeDefined();
    expect(result.end).toBeDefined();
  });

  test("parses ISO date YYYY-MM-DD to single day range", () => {
    const result = parseDateFilter("2024-01-15");

    expect(result.start.getFullYear()).toBe(2024);
    expect(result.start.getMonth()).toBe(0);
    expect(result.start.getDate()).toBe(15);
    expect(result.start.getHours()).toBe(0);

    expect(result.end.getFullYear()).toBe(2024);
    expect(result.end.getMonth()).toBe(0);
    expect(result.end.getDate()).toBe(15);
    expect(result.end.getHours()).toBe(23);
    expect(result.end.getMinutes()).toBe(59);
  });

  test("parses ISO month YYYY-MM to entire month range", () => {
    const result = parseDateFilter("2024-02");

    expect(result.start.getFullYear()).toBe(2024);
    expect(result.start.getMonth()).toBe(1);
    expect(result.start.getDate()).toBe(1);
    expect(result.start.getHours()).toBe(0);

    expect(result.end.getFullYear()).toBe(2024);
    expect(result.end.getMonth()).toBe(1);
    expect(result.end.getDate()).toBe(29);
    expect(result.end.getHours()).toBe(23);
  });

  test("parses date range 'YYYY-MM-DD to YYYY-MM-DD'", () => {
    const result = parseDateFilter("2024-01-01 to 2024-01-31");

    expect(result.start.getFullYear()).toBe(2024);
    expect(result.start.getMonth()).toBe(0);
    expect(result.start.getDate()).toBe(1);

    expect(result.end.getFullYear()).toBe(2024);
    expect(result.end.getMonth()).toBe(0);
    expect(result.end.getDate()).toBe(31);
    expect(result.end.getHours()).toBe(23);
  });

  test("throws error for invalid date format", () => {
    expect(() => parseDateFilter("invalid")).toThrow(
      /Unrecognized date filter format/,
    );
  });

  test("throws error for invalid ISO date", () => {
    expect(() => parseDateFilter("2024-13-45")).toThrow(/Invalid date/);
  });

  test("throws error for reversed date range", () => {
    expect(() => parseDateFilter("2024-12-31 to 2024-01-01")).toThrow(
      /Start date must be before end date/,
    );
  });

  test("is case-insensitive", () => {
    expect(() => parseDateFilter("TODAY")).not.toThrow();
    expect(() => parseDateFilter("Yesterday")).not.toThrow();
    expect(() => parseDateFilter("LAST 7 DAYS")).not.toThrow();
  });

  test("handles extra whitespace", () => {
    const result = parseDateFilter("  today  ");
    expect(result.start).toBeDefined();
    expect(result.end).toBeDefined();
  });
});

describe("filterByDate", () => {
  const mockResults = [
    { id: "1", timestamp: "2024-01-15T10:00:00.000Z", content: "First" },
    { id: "2", timestamp: "2024-01-16T14:30:00.000Z", content: "Second" },
    { id: "3", timestamp: "2024-01-17T09:15:00.000Z", content: "Third" },
    { id: "4", timestamp: "2024-02-01T12:00:00.000Z", content: "Fourth" },
  ];

  test("filters results within date range", () => {
    const range: DateRange = {
      start: new Date("2024-01-15"),
      end: new Date("2024-01-17T23:59:59.999Z"),
    };

    const filtered = filterByDate(mockResults, range);
    expect(filtered.length).toBe(3);
    expect(filtered.map((r) => r.id)).toEqual(["1", "2", "3"]);
  });

  test("filters results for single day", () => {
    const range: DateRange = {
      start: new Date("2024-01-16T00:00:00.000Z"),
      end: new Date("2024-01-16T23:59:59.999Z"),
    };

    const filtered = filterByDate(mockResults, range);
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe("2");
  });

  test("returns empty array when no results match", () => {
    const range: DateRange = {
      start: new Date("2024-03-01"),
      end: new Date("2024-03-31T23:59:59.999Z"),
    };

    const filtered = filterByDate(mockResults, range);
    expect(filtered.length).toBe(0);
  });

  test("includes results exactly at range boundaries", () => {
    const range: DateRange = {
      start: new Date("2024-01-15T10:00:00.000Z"),
      end: new Date("2024-01-16T14:30:00.000Z"),
    };

    const filtered = filterByDate(mockResults, range);
    expect(filtered.length).toBe(2);
    expect(filtered.map((r) => r.id)).toEqual(["1", "2"]);
  });

  test("preserves original array when all results match", () => {
    const range: DateRange = {
      start: new Date("2024-01-01"),
      end: new Date("2024-12-31T23:59:59.999Z"),
    };

    const filtered = filterByDate(mockResults, range);
    expect(filtered.length).toBe(4);
  });

  test("returns empty array for empty input", () => {
    const range: DateRange = {
      start: new Date("2024-01-01"),
      end: new Date("2024-01-31T23:59:59.999Z"),
    };

    const filtered = filterByDate([], range);
    expect(filtered.length).toBe(0);
  });
});
