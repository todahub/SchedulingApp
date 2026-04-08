import type { EventCandidateRecord, ParsedCommentConstraint, ParsedConstraintLevel, ParsedConstraintPolarity, ParsedConstraintTargetType } from "./domain";
import { getCandidateDateValues } from "./utils";

export const COMMENT_SCORE_MAP: Record<ParsedConstraintLevel, number> = {
  hard_no: -100,
  soft_no: -30,
  unknown: 0,
  conditional: 10,
  soft_yes: 25,
  strong_yes: 40,
};

const weekdayMap: Record<string, string> = {
  sunday: "sunday",
  monday: "monday",
  tuesday: "tuesday",
  wednesday: "wednesday",
  thursday: "thursday",
  friday: "friday",
  saturday: "saturday",
};

const weekdayJaMap: Record<string, string> = {
  日: "sunday",
  月: "monday",
  火: "tuesday",
  水: "wednesday",
  木: "thursday",
  金: "friday",
  土: "saturday",
};

const weekdayLabelMap: Record<string, string> = {
  monday: "月曜",
  tuesday: "火曜",
  wednesday: "水曜",
  thursday: "木曜",
  friday: "金曜",
  saturday: "土曜",
  sunday: "日曜",
};

const timeTokenPatterns = [
  { key: "all_day", pattern: /(?:一日中|終日)/u },
  { key: "morning", pattern: /朝/u },
  { key: "day", pattern: /(?:昼|午後)/u },
  { key: "night", pattern: /夜/u },
];

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function splitIntoClauses(text: string) {
  return text
    .replace(/だけど|けど|でも/gu, "。")
    .split(/[。！!？?\n、]/u)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function inferLevel(text: string): ParsedConstraintLevel | null {
  if (/(?:確実に|絶対(?:に)?(?:行ける|いける)|必ず(?:行ける|いける)|問題なく(?:行ける|いける))/u.test(text)) {
    return "strong_yes";
  }

  if (/(?:絶対無理|無理|行けない|参加できない)/u.test(text)) {
    return "hard_no";
  }

  if (/(?:厳しい|微妙|できれば避けたい|なるべく避けたい|避けたい)/u.test(text)) {
    return "soft_no";
  }

  if (/(?:なら(?:行ける|いける)|なら大丈夫|なら参加できる|次第|条件付き)/u.test(text)) {
    return "conditional";
  }

  if (/(?:たぶん|未定|わからない|わかんない)/u.test(text)) {
    return "unknown";
  }

  if (/(?:行ける|いける|大丈夫|参加できる|行けそう|いけそう)/u.test(text)) {
    return "soft_yes";
  }

  return null;
}

function inferPolarity(level: ParsedConstraintLevel): ParsedConstraintPolarity {
  if (level === "hard_no" || level === "soft_no") {
    return "negative";
  }

  if (level === "unknown") {
    return "neutral";
  }

  return "positive";
}

function buildCandidateDatePool(candidates: EventCandidateRecord[]) {
  return uniqueStrings(candidates.flatMap((candidate) => getCandidateDateValues(candidate))).sort((left, right) => left.localeCompare(right));
}

function resolveDateByMonthDay(candidates: EventCandidateRecord[], month: number, day: number) {
  const matched = buildCandidateDatePool(candidates).filter((date) => {
    const monthValue = Number(date.slice(5, 7));
    const dayValue = Number(date.slice(8, 10));
    return monthValue === month && dayValue === day;
  });

  return matched.length === 1 ? matched[0] : null;
}

function resolveDateByDayOnly(candidates: EventCandidateRecord[], day: number) {
  const matched = buildCandidateDatePool(candidates).filter((date) => Number(date.slice(8, 10)) === day);
  return matched.length === 1 ? matched[0] : null;
}

function detectDateValue(text: string, candidates: EventCandidateRecord[]) {
  const slashMatch = text.match(/(?<!\d)(\d{1,2})\/(\d{1,2})(?!\d)/u);
  if (slashMatch) {
    return resolveDateByMonthDay(candidates, Number(slashMatch[1]), Number(slashMatch[2]));
  }

  const monthDayMatch = text.match(/(\d{1,2})月(\d{1,2})日/u);
  if (monthDayMatch) {
    return resolveDateByMonthDay(candidates, Number(monthDayMatch[1]), Number(monthDayMatch[2]));
  }

  const dayOnlyMatch = text.match(/(?<!\d)(\d{1,2})日/u);
  if (dayOnlyMatch) {
    return resolveDateByDayOnly(candidates, Number(dayOnlyMatch[1]));
  }

  return null;
}

function detectWeekdays(text: string) {
  if (/土日/u.test(text)) {
    return ["saturday", "sunday"];
  }

  const matches = [...text.matchAll(/([月火水木金土日])(?:曜|曜日)/gu)].map((match) => weekdayJaMap[match[1] ?? ""]).filter(Boolean);
  return uniqueStrings(matches);
}

function detectTimeSlotKey(text: string) {
  const token = timeTokenPatterns.find((entry) => entry.pattern.test(text));
  return token?.key ?? null;
}

function makeConstraint(
  targetType: ParsedConstraintTargetType,
  targetValue: string,
  level: ParsedConstraintLevel,
  reasonText: string,
): ParsedCommentConstraint {
  return {
    targetType,
    targetValue,
    polarity: inferPolarity(level),
    level,
    reasonText,
  };
}

export function parseCommentConstraints(text: string | null | undefined, candidates: EventCandidateRecord[]): ParsedCommentConstraint[] {
  const note = text?.trim() ?? "";

  if (!note) {
    return [];
  }

  const constraints = splitIntoClauses(note).flatMap((clause) => {
    const level = inferLevel(clause);

    if (!level) {
      return [];
    }

    const resolvedDate = detectDateValue(clause, candidates);
    const weekdays = detectWeekdays(clause);
    const timeSlotKey = detectTimeSlotKey(clause);

    if (resolvedDate && timeSlotKey) {
      return [makeConstraint("date_time", `${resolvedDate}_${timeSlotKey}`, level, clause)];
    }

    if (resolvedDate) {
      return [makeConstraint("date", resolvedDate, level, clause)];
    }

    if (weekdays.length > 0 && timeSlotKey) {
      return weekdays.map((weekday) => makeConstraint("date_time", `${weekday}_${timeSlotKey}`, level, clause));
    }

    if (weekdays.length > 0) {
      return weekdays.map((weekday) => makeConstraint("weekday", weekday, level, clause));
    }

    if (timeSlotKey) {
      return [makeConstraint("time", timeSlotKey, level, clause)];
    }

    return [];
  });

  return uniqueStrings(constraints.map((constraint) => JSON.stringify(constraint))).map((value) =>
    JSON.parse(value) as ParsedCommentConstraint,
  );
}

function getWeekdayKey(date: string) {
  const day = new Date(`${date}T00:00:00`).getDay();
  return weekdayMap[["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][day] ?? "sunday"] ?? "sunday";
}

export function doesConstraintMatchCandidate(constraint: ParsedCommentConstraint, candidate: EventCandidateRecord) {
  const candidateDates = getCandidateDateValues(candidate);
  const matchesTime = (timeKey: string) => candidate.timeSlotKey === timeKey || candidate.timeSlotKey === "unspecified";

  if (constraint.targetType === "date") {
    return candidateDates.includes(constraint.targetValue);
  }

  if (constraint.targetType === "weekday") {
    return candidateDates.some((date) => getWeekdayKey(date) === constraint.targetValue);
  }

  if (constraint.targetType === "time") {
    return matchesTime(constraint.targetValue);
  }

  const [left, timeKey] = constraint.targetValue.split("_");
  if (!left || !timeKey) {
    return false;
  }

  const dateMatch = /^\d{4}-\d{2}-\d{2}$/.test(left)
    ? candidateDates.includes(left)
    : candidateDates.some((date) => getWeekdayKey(date) === left);

  return dateMatch && matchesTime(timeKey);
}

export function getConstraintScoreForCandidate(constraints: ParsedCommentConstraint[], candidate: EventCandidateRecord) {
  return constraints.reduce((sum, constraint) => {
    return doesConstraintMatchCandidate(constraint, candidate) ? sum + COMMENT_SCORE_MAP[constraint.level] : sum;
  }, 0);
}

export function hasHardNoConstraintForCandidate(constraints: ParsedCommentConstraint[], candidate: EventCandidateRecord) {
  return constraints.some((constraint) => constraint.level === "hard_no" && doesConstraintMatchCandidate(constraint, candidate));
}

export function formatParsedConstraintLabel(constraint: ParsedCommentConstraint) {
  const timeLabelMap: Record<string, string> = {
    all_day: "一日中",
    morning: "朝",
    day: "昼",
    night: "夜",
    unspecified: "指定なし",
  };

  const targetLabel =
    constraint.targetType === "date"
      ? constraint.targetValue.replace(/^(\d{4})-(\d{2})-(\d{2})$/u, "$2/$3")
      : constraint.targetType === "weekday"
        ? weekdayLabelMap[constraint.targetValue] ?? constraint.targetValue
        : constraint.targetType === "time"
          ? timeLabelMap[constraint.targetValue] ?? constraint.targetValue
          : constraint.targetValue.replace(/^(\d{4})-(\d{2})-(\d{2})_(.+)$/u, (_match, _year, month, day, time) => `${month}/${day} ${timeLabelMap[time] ?? time}`).replace(/^([a-z]+)_(.+)$/u, (_match, weekday, time) => `${weekdayLabelMap[weekday] ?? weekday} ${timeLabelMap[time] ?? time}`);

  const levelLabelMap: Record<ParsedConstraintLevel, string> = {
    hard_no: "参加不可",
    soft_no: "できれば避けたい",
    unknown: "未定",
    conditional: "条件付きで参加可能",
    soft_yes: "たぶん参加可能",
    strong_yes: "問題なく参加可能",
  };

  return `${targetLabel} → ${levelLabelMap[constraint.level]}`;
}
