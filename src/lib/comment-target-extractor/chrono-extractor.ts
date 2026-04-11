import * as chrono from "chrono-node";
import type {
  ExtractCommentTimeFeaturesOptions,
  ExtractedTimeTargetCandidate,
  ExtractedTimeTargetMetadata,
} from "./types";

function toIsoDate(year: number | null, month: number | null, day: number | null) {
  if (year === null || month === null || day === null) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getReferenceDate(options?: ExtractCommentTimeFeaturesOptions) {
  if (options?.eventDateRange?.start) {
    return new Date(`${options.eventDateRange.start}T12:00:00+09:00`);
  }

  return new Date();
}

function getChronoDateValues(components: chrono.ParsedComponents) {
  return {
    year: components.get("year"),
    month: components.get("month"),
    day: components.get("day"),
    weekday: components.get("weekday"),
  };
}

function getWeekdayKey(weekday: number | null) {
  if (weekday === 0) return "sunday";
  if (weekday === 1) return "monday";
  if (weekday === 2) return "tuesday";
  if (weekday === 3) return "wednesday";
  if (weekday === 4) return "thursday";
  if (weekday === 5) return "friday";
  if (weekday === 6) return "saturday";
  return null;
}

function classifyChronoCandidate(
  result: chrono.ParsedResult,
): Omit<ExtractedTimeTargetCandidate, "source" | "text" | "start" | "end"> | null {
  const startValues = getChronoDateValues(result.start);
  const endValues = result.end ? getChronoDateValues(result.end) : null;
  const startDate = toIsoDate(startValues.year, startValues.month, startValues.day);
  const endDate = endValues ? toIsoDate(endValues.year, endValues.month, endValues.day) : null;
  const weekdayKey = getWeekdayKey(startValues.weekday);
  const metadata: ExtractedTimeTargetMetadata = {
    isRelativeLike: /今日|明日|明後日|昨日|一昨日|今週|来週|再来週|先週|今月|来月/u.test(result.text),
    resolvedDate: startDate,
    resolvedEndDate: endDate,
    weekday: weekdayKey,
  };

  if (startDate && endDate && startDate !== endDate) {
    return {
      kind: "date_range",
      normalizedValue: `${startDate}..${endDate}`,
      metadata,
    };
  }

  if (startDate) {
    return {
      kind: "date",
      normalizedValue: startDate,
      metadata,
    };
  }

  if (weekdayKey) {
    return {
      kind: "weekday",
      normalizedValue: weekdayKey,
      metadata,
    };
  }

  return null;
}

export function extractChronoTimeTargetCandidates(
  normalizedText: string,
  options?: ExtractCommentTimeFeaturesOptions,
) {
  const results = chrono.ja.parse(normalizedText, getReferenceDate(options));

  return results.flatMap((result) => {
    const classified = classifyChronoCandidate(result);

    if (!classified) {
      return [];
    }

    const candidate: ExtractedTimeTargetCandidate = {
      ...classified,
      source: "chrono",
      text: result.text,
      start: result.index,
      end: result.index + result.text.length,
    };

    return [candidate];
  });
}
