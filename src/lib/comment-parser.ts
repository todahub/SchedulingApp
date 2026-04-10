import type {
  EventCandidateRecord,
  ParsedCommentConstraint,
  ParsedConstraintLevel,
  ParsedConstraintPolarity,
  ParticipantAnswerRecord,
  ParticipantResponseRecord,
} from "./domain";
import { formatDate, getCandidateDateValues, normalizeCandidate } from "./utils";

type SupportedTimeKey = "all_day" | "morning" | "day" | "night";
type WeekdayValue = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday" | "weekday" | "weekend";
type ClauseContext = {
  lastDateValue: string | null;
  lastWeekValue: string | null;
  lastWeekdays: WeekdayValue[];
};
type ClauseSegment = {
  parseText: string;
  reasonText: string;
  forcedDateValues: string[] | null;
};
type DateIndex = {
  uniqueDayMap: Map<string, string | null>;
  uniqueMonthDayMap: Map<string, string>;
  singleWeekValue: string | null;
};
type DerivedResponseResult = {
  parsedConstraints: ParsedCommentConstraint[];
  usedDefault: boolean;
  defaultReason: "empty" | "unparsed" | null;
  answers: ParticipantAnswerRecord[];
};
type ResponseInterpretationMode = "manual" | "parsed_comment" | "unparsed_default";

export const COMMENT_SCORE_MAP: Record<ParsedConstraintLevel, number> = {
  hard_no: -100,
  soft_no: -30,
  unknown: 0,
  conditional: 10,
  soft_yes: 25,
  strong_yes: 40,
};

const WEEKDAY_INDEX: Record<Exclude<WeekdayValue, "weekday" | "weekend">, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const WEEKDAY_LABELS: Record<WeekdayValue, string> = {
  monday: "月曜",
  tuesday: "火曜",
  wednesday: "水曜",
  thursday: "木曜",
  friday: "金曜",
  saturday: "土曜",
  sunday: "日曜",
  weekday: "平日",
  weekend: "週末",
};

const TIME_LABELS: Record<SupportedTimeKey, string> = {
  all_day: "全日",
  morning: "朝",
  day: "昼",
  night: "夜",
};

const LEVEL_LABELS: Record<ParsedConstraintLevel, string> = {
  hard_no: "参加不可",
  soft_no: "できれば避けたい",
  unknown: "未定",
  conditional: "条件付きで参加可能",
  soft_yes: "たぶん参加可能",
  strong_yes: "参加可能",
};

export function formatConstraintLevelLabel(level: ParsedConstraintLevel) {
  return LEVEL_LABELS[level];
}

const BASE_CONTEXT: ClauseContext = {
  lastDateValue: null,
  lastWeekValue: null,
  lastWeekdays: [],
};

function padDateLabel(value: string) {
  return `${value.slice(5, 7)}/${value.slice(8, 10)}`;
}

function getWeekStart(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00`);
  const diff = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - diff);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeText(note: string) {
  return note
    .replace(/\r\n?/gu, "\n")
    .replace(/[　\t]/gu, " ")
    .replace(/[，､]/gu, "、")
    .replace(/[．。]/gu, "。")
    .replace(/[！!]/gu, "！")
    .replace(/[？?]/gu, "？")
    .replace(/\s+/gu, " ")
    .trim();
}

function splitIntoClauses(note: string) {
  const normalized = normalizeText(note);

  if (!normalized) {
    return [];
  }

  return normalized
    .split(/[。！？\n]+/u)
    .flatMap((segment) => segment.split(/(?:(?<!\d)[、,]|[、,](?=[^0-9は]))+/u))
    .flatMap((segment) => segment.split(/(?:だけど|けれど|けど|でも|ただし|ただ)(?=[^ぁ-んァ-ヶーa-zA-Z0-9]|$|[^\s])/u))
    .flatMap((segment) =>
      segment.split(
        /\s+(?=(?:(?:それ以外|あとは?|残り)(?:は|の)?|(?:\d{1,2}\/\d{1,2}|\d{1,2}月\s*\d{1,2}日?|\d{1,2}日?)(?:\s*(?:と|、|,)\s*(?:\d{1,2}\/\d{1,2}|\d{1,2}月\s*\d{1,2}日?|\d{1,2}))*(?:\s*[、,])?\s*は))/u,
      ),
    )
    .map((segment) => segment.replace(/^[、,\s]+|[、,\s]+$/gu, "").trim())
    .filter(Boolean);
}

function extractDateTokens(text: string) {
  return [...text.matchAll(/(\d{1,2}\/\d{1,2}|\d{1,2}月\s*\d{1,2}日?|\d{1,2}日?|\d{1,2})/gu)].map((match) => match[1]!);
}

function buildDateIndex(candidates: EventCandidateRecord[]): DateIndex {
  const uniqueDates = [...new Set(candidates.flatMap((candidate) => getCandidateDateValues(candidate)))].sort((left, right) =>
    left.localeCompare(right),
  );
  const uniqueDayMap = new Map<string, string | null>();
  const uniqueMonthDayMap = new Map<string, string>();

  for (const dateValue of uniqueDates) {
    const dayKey = String(Number(dateValue.slice(8, 10)));
    const monthDayKey = `${Number(dateValue.slice(5, 7))}/${Number(dateValue.slice(8, 10))}`;
    uniqueMonthDayMap.set(monthDayKey, dateValue);
    uniqueDayMap.set(dayKey, uniqueDayMap.has(dayKey) && uniqueDayMap.get(dayKey) !== dateValue ? null : dateValue);
  }

  const weekValues = [...new Set(uniqueDates.map((dateValue) => getWeekStart(dateValue)))];

  return {
    uniqueDayMap,
    uniqueMonthDayMap,
    singleWeekValue: weekValues.length === 1 ? weekValues[0] ?? null : null,
  };
}

function resolveDayOnlyDate(day: string, index: DateIndex) {
  return index.uniqueDayMap.get(String(Number(day))) ?? null;
}

function resolveMonthDayDate(month: string, day: string, index: DateIndex) {
  const key = `${Number(month)}/${Number(day)}`;
  return index.uniqueMonthDayMap.get(key) ?? null;
}

function resolveDateValue(rawDate: string, index: DateIndex) {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(rawDate)) {
    return rawDate;
  }

  const slashMatch = rawDate.match(/(\d{1,2})\/(\d{1,2})/u);

  if (slashMatch) {
    return resolveMonthDayDate(slashMatch[1]!, slashMatch[2]!, index);
  }

  const monthMatch = rawDate.match(/(\d{1,2})月\s*(\d{1,2})日?/u);

  if (monthMatch) {
    return resolveMonthDayDate(monthMatch[1]!, monthMatch[2]!, index);
  }

  const dayMatch = rawDate.match(/^(\d{1,2})$/u);

  if (dayMatch) {
    return resolveDayOnlyDate(dayMatch[1]!, index);
  }

  return null;
}

function detectExplicitDateValues(clause: string, index: DateIndex) {
  const values = extractDateTokens(clause)
    .map((token) => resolveDateValue(token.replace(/日$/u, ""), index))
    .filter((value): value is string => Boolean(value));

  return [...new Set(values)];
}

function buildClauseSegments(clause: string, index: DateIndex): ClauseSegment[] {
  const leadingListMatch = clause.match(
    /^((?:\d{1,2}\/\d{1,2}|\d{1,2}月\s*\d{1,2}日?|\d{1,2}日?|\d{1,2})(?:\s*(?:と|、|,)\s*(?:\d{1,2}\/\d{1,2}|\d{1,2}月\s*\d{1,2}日?|\d{1,2}日?|\d{1,2}))+)(?:\s*[、,])?\s*は\s*(.+)$/u,
  );

  if (!leadingListMatch) {
    return [
      {
        parseText: clause,
        reasonText: clause,
        forcedDateValues: null,
      },
    ];
  }

  const listDateValues = extractDateTokens(leadingListMatch[1]!)
    .map((token) => resolveDateValue(token.replace(/日$/u, ""), index))
    .filter((value): value is string => Boolean(value));
  const uniqueListDateValues = [...new Set(listDateValues)];
  const remainder = leadingListMatch[2]!.trim();

  if (uniqueListDateValues.length <= 1 || !remainder) {
    return [
      {
        parseText: clause,
        reasonText: clause,
        forcedDateValues: uniqueListDateValues.length > 1 ? uniqueListDateValues : null,
      },
    ];
  }

  const scopedMatches = [...remainder.matchAll(/(\d{1,2}\/\d{1,2}|\d{1,2}月\s*\d{1,2}日?|\d{1,2}日?|\d{1,2})\s*は/gu)];

  if (scopedMatches.length === 0) {
    return [
      {
        parseText: remainder,
        reasonText: clause,
        forcedDateValues: uniqueListDateValues,
      },
    ];
  }

  const segments: ClauseSegment[] = [];

  for (const [indexOfMatch, match] of scopedMatches.entries()) {
    const start = match.index ?? 0;
    const end = indexOfMatch + 1 < scopedMatches.length ? (scopedMatches[indexOfMatch + 1]!.index ?? remainder.length) : remainder.length;
    const segmentText = remainder
      .slice(start, end)
      .replace(/^[、,\s]+|[、,\s]+$/gu, "")
      .trim();
    const dateValue = resolveDateValue(match[1]!.replace(/日$/u, ""), index);

    if (!segmentText || !dateValue) {
      continue;
    }

    segments.push({
      parseText: segmentText,
      reasonText: segmentText,
      forcedDateValues: [dateValue],
    });
  }

  return segments.length > 0
    ? segments
    : [
        {
          parseText: remainder,
          reasonText: clause,
          forcedDateValues: uniqueListDateValues,
        },
      ];
}

function detectWeekValue(clause: string, index: DateIndex, context: ClauseContext) {
  if (!/その週/u.test(clause)) {
    return null;
  }

  if (context.lastWeekValue) {
    return context.lastWeekValue;
  }

  return index.singleWeekValue ?? "relative";
}

function detectWeekdays(clause: string) {
  const values: WeekdayValue[] = [];

  if (/土日/u.test(clause)) {
    return ["saturday", "sunday"] as WeekdayValue[];
  }

  if (/平日/u.test(clause)) {
    values.push("weekday");
  }

  if (/週末/u.test(clause)) {
    values.push("weekend");
  }

  const weekdayMatches = [...clause.matchAll(/([月火水木金土日])(?:曜|曜日)/gu)];
  const seen = new Set<WeekdayValue>(values);

  for (const match of weekdayMatches) {
    const value =
      match[1] === "月"
        ? "monday"
        : match[1] === "火"
          ? "tuesday"
          : match[1] === "水"
            ? "wednesday"
            : match[1] === "木"
              ? "thursday"
              : match[1] === "金"
                ? "friday"
                : match[1] === "土"
                  ? "saturday"
                  : "sunday";

    if (!seen.has(value)) {
      values.push(value);
      seen.add(value);
    }
  }

  return values;
}

function detectTimeKey(clause: string): SupportedTimeKey | null {
  if (/一日中|終日/u.test(clause)) {
    return "all_day";
  }

  if (/夜遅め|夜遅く|夕方|夜/u.test(clause)) {
    return "night";
  }

  if (/昼過ぎ|昼|午後/u.test(clause)) {
    return "day";
  }

  if (/午前|朝/u.test(clause)) {
    return "morning";
  }

  return null;
}

function inferLevel(clause: string): ParsedConstraintLevel | null {
  const text = normalizeText(clause);

  if (!text) {
    return null;
  }

  const hasConditionalMarker = /(?:なら|であれば|ならば|次第|条件付き|行けたら)/u.test(text);
  const hasDoubleNegative = /(?:行けなくはない|いけなくはない|行けないことはない|いけないことはない|無理ではない)/u.test(text);
  const hasStrongYes = /(?:確実に|絶対(?:に)?行ける|必ず行ける|問題なく行ける|余裕で行ける)/u.test(text);
  const hasHardNo =
    /(?:絶対無理|どうしても無理|完全に無理|絶対(?:に)?やめてほしい|(?:行け|いけ)ない|参加できない|無理(?:です|だ|でした|かも)?)/u.test(text) &&
    !hasDoubleNegative;
  const hasSoftNo =
    /(?:厳しい|微妙|難しい|避けたい|できれば避けたい|なるべく避けたい|本当は避けたい)/u.test(text) && !hasHardNo;
  const hasPlainGoPositive = /(?:行ける|いける|行けます|いけます)/u.test(text);
  const hasSoftPositive =
    /(?:行けて|いけて|大丈夫|参加できる|行けそう|いけそう|いいよ|良いよ|いける気がする|行ける気がする|いける気がします|行ける気がします)/u.test(text) ||
    hasPlainGoPositive ||
    hasStrongYes;
  const hasHedgedPositive = /(?:たぶん|だいたい|気がする|気がします|かも|まあ)/u.test(text) && hasSoftPositive;
  const hasUnknown = /(?:未定|わからない|わかんない|未確定|まだ予定|まだ分からない|たぶん|だいたい)/u.test(text);

  if (hasHardNo) {
    return "hard_no";
  }

  if (hasDoubleNegative) {
    return hasConditionalMarker ? "conditional" : "soft_yes";
  }

  if (hasConditionalMarker && (hasSoftPositive || /(?:終日|一日中|朝|午前|昼|午後|夕方|夜)/u.test(text))) {
    return "conditional";
  }

  if (hasStrongYes) {
    return "strong_yes";
  }

  if (hasSoftNo) {
    return "soft_no";
  }

  if (hasHedgedPositive) {
    return "soft_yes";
  }

  if (hasUnknown) {
    return "unknown";
  }

  if (hasPlainGoPositive) {
    return "strong_yes";
  }

  if (hasSoftPositive) {
    return "soft_yes";
  }

  return null;
}

function getPolarity(level: ParsedConstraintLevel): ParsedConstraintPolarity {
  if (level === "hard_no" || level === "soft_no") {
    return "negative";
  }

  if (level === "unknown") {
    return "neutral";
  }

  return "positive";
}

function pushConstraint(
  constraints: ParsedCommentConstraint[],
  constraint: ParsedCommentConstraint,
  seen: Set<string>,
) {
  const key = JSON.stringify(constraint);

  if (!seen.has(key)) {
    constraints.push(constraint);
    seen.add(key);
  }
}

function buildTargetedConstraints(
  level: ParsedConstraintLevel,
  reasonText: string,
  target: {
    dateValues: string[];
    weekValue: string | null;
    weekdays: WeekdayValue[];
    timeKey: SupportedTimeKey | null;
  },
  seen: Set<string>,
) {
  const constraints: ParsedCommentConstraint[] = [];
  const polarity = getPolarity(level);

  if (target.dateValues.length > 0 && target.timeKey) {
    for (const dateValue of target.dateValues) {
      pushConstraint(
        constraints,
        {
          targetType: "date_time",
          targetValue: `${dateValue}_${target.timeKey}`,
          polarity,
          level,
          reasonText,
        },
        seen,
      );
    }

    return constraints;
  }

  if (target.dateValues.length > 0) {
    for (const dateValue of target.dateValues) {
      pushConstraint(
        constraints,
        {
          targetType: "date",
          targetValue: dateValue,
          polarity,
          level,
          reasonText,
        },
        seen,
      );
    }

    return constraints;
  }

  if (target.weekValue && target.timeKey) {
    pushConstraint(
      constraints,
      {
        targetType: "date_time",
        targetValue: `week:${target.weekValue}_${target.timeKey}`,
        polarity,
        level,
        reasonText,
      },
      seen,
    );
    return constraints;
  }

  if (target.weekValue) {
    pushConstraint(
      constraints,
      {
        targetType: "date",
        targetValue: `week:${target.weekValue}`,
        polarity,
        level,
        reasonText,
      },
      seen,
    );
    return constraints;
  }

  if (target.weekdays.length > 0 && target.timeKey) {
    for (const weekday of target.weekdays) {
      pushConstraint(
        constraints,
        {
          targetType: "date_time",
          targetValue: `${weekday}_${target.timeKey}`,
          polarity,
          level,
          reasonText,
        },
        seen,
      );
    }

    return constraints;
  }

  if (target.weekdays.length > 0) {
    for (const weekday of target.weekdays) {
      pushConstraint(
        constraints,
        {
          targetType: "weekday",
          targetValue: weekday,
          polarity,
          level,
          reasonText,
        },
        seen,
      );
    }

    return constraints;
  }

  if (target.timeKey) {
    pushConstraint(
      constraints,
      {
        targetType: "time",
        targetValue: target.timeKey,
        polarity,
        level,
        reasonText,
      },
      seen,
    );
    return constraints;
  }

  pushConstraint(
    constraints,
    {
      targetType: "time",
      targetValue: "all_day",
      polarity,
      level,
      reasonText,
    },
    seen,
  );
  return constraints;
}

function buildConstraintFromCandidate(
  candidate: EventCandidateRecord,
  level: ParsedConstraintLevel,
  reasonText: string,
): ParsedCommentConstraint {
  const normalized = normalizeCandidate(candidate);
  const dateValue = getCandidateDateValues(normalized)[0] ?? normalized.startDate;
  const polarity = getPolarity(level);

  if (normalized.timeSlotKey === "all_day" || normalized.timeType === "unspecified") {
    return {
      targetType: "date",
      targetValue: dateValue,
      polarity,
      level,
      reasonText,
    };
  }

  return {
    targetType: "date_time",
    targetValue: `${dateValue}_${normalized.timeSlotKey}`,
    polarity,
    level,
    reasonText,
  };
}

function getCoveredCandidateIds(constraints: ParsedCommentConstraint[], candidates: EventCandidateRecord[]) {
  const covered = new Set<string>();

  for (const candidate of candidates) {
    if (constraints.some((constraint) => doesConstraintMatchCandidate(constraint, candidate))) {
      covered.add(candidate.id);
    }
  }

  return covered;
}

function buildComplementConstraints(
  level: ParsedConstraintLevel,
  reasonText: string,
  candidates: EventCandidateRecord[],
  priorConstraints: ParsedCommentConstraint[],
  futureExplicitDateValues: Set<string>,
  seen: Set<string>,
) {
  const coveredCandidateIds = getCoveredCandidateIds(priorConstraints, candidates);
  const uncoveredCandidates = candidates.filter((candidate) => {
    const candidateDates = getCandidateDateValues(candidate);
    const reservedForFuture = candidateDates.some((dateValue) => futureExplicitDateValues.has(dateValue));

    return !coveredCandidateIds.has(candidate.id) && !reservedForFuture;
  });

  const constraints: ParsedCommentConstraint[] = [];

  for (const candidate of uncoveredCandidates) {
    pushConstraint(constraints, buildConstraintFromCandidate(candidate, level, reasonText), seen);
  }

  return constraints;
}

export function parseCommentConstraints(note: string, candidates: EventCandidateRecord[]) {
  const clauses = splitIntoClauses(note);

  if (clauses.length === 0) {
    return [];
  }

  const index = buildDateIndex(candidates);
  const constraints: ParsedCommentConstraint[] = [];
  const seen = new Set<string>();
  const context = { ...BASE_CONTEXT };
  const clauseSegments = clauses.flatMap((clause) => buildClauseSegments(clause, index));

  function getSegmentExplicitDateValues(segment: ClauseSegment) {
    return segment.forcedDateValues ?? detectExplicitDateValues(segment.parseText, index);
  }

  for (const [segmentIndex, segment] of clauseSegments.entries()) {
      const level = inferLevel(segment.parseText);
      const explicitDateValues = getSegmentExplicitDateValues(segment);
      const explicitDateValue = explicitDateValues[0] ?? null;
      const explicitWeekValue = detectWeekValue(segment.parseText, index, context);
      const explicitWeekdays = detectWeekdays(segment.parseText);
      const explicitTimeKey = detectTimeKey(segment.parseText);
      const hasElseReference = /(?:それ以外|あとは?|残り)/u.test(segment.parseText);
      const futureExplicitDateValues = new Set(clauseSegments.slice(segmentIndex + 1).flatMap((item) => getSegmentExplicitDateValues(item)));
      const dateValues =
        explicitDateValues.length > 0
          ? explicitDateValues
          : /その日/u.test(segment.parseText) && context.lastDateValue
            ? [context.lastDateValue]
            : [];
      const weekValue = explicitWeekValue;
      const weekdays = explicitWeekdays.length > 0 ? explicitWeekdays : [];
      const timeKey = explicitTimeKey;

      if (explicitDateValue) {
        context.lastDateValue = explicitDateValue;
        context.lastWeekValue = getWeekStart(explicitDateValue);
      } else if (weekValue) {
        context.lastWeekValue = weekValue === "relative" ? context.lastWeekValue : weekValue;
      }

      if (weekdays.length > 0) {
        context.lastWeekdays = weekdays;
      }

      if (!level) {
        continue;
      }

      const hasExplicitTarget = Boolean(dateValues.length > 0 || weekValue || weekdays.length > 0 || timeKey || hasElseReference);

      if (!hasExplicitTarget && level === "unknown" && clauseSegments.length > 1) {
        continue;
      }

      if (hasElseReference && constraints.length > 0) {
        const complementConstraints = buildComplementConstraints(level, segment.reasonText, candidates, constraints, futureExplicitDateValues, seen);

        if (complementConstraints.length > 0) {
          constraints.push(...complementConstraints);
        }

        continue;
      }

      const targetedConstraints = buildTargetedConstraints(
        level,
        segment.reasonText,
        {
          dateValues,
          weekValue,
          weekdays: weekdays.length > 0 ? weekdays : /その日/u.test(segment.parseText) && context.lastWeekdays.length > 0 ? context.lastWeekdays : [],
          timeKey,
        },
        seen,
      );

      constraints.push(...targetedConstraints);
  }

  return constraints;
}

function getCandidateWeekdayValue(dateValue: string): Exclude<WeekdayValue, "weekday" | "weekend"> {
  const weekdayIndex = new Date(`${dateValue}T00:00:00`).getDay();

  return weekdayIndex === 0
    ? "sunday"
    : weekdayIndex === 1
      ? "monday"
      : weekdayIndex === 2
        ? "tuesday"
        : weekdayIndex === 3
          ? "wednesday"
          : weekdayIndex === 4
            ? "thursday"
            : weekdayIndex === 5
              ? "friday"
              : "saturday";
}

function matchesWeekdayValue(targetValue: string, dateValue: string) {
  const weekday = getCandidateWeekdayValue(dateValue);

  if (targetValue === "weekday") {
    return WEEKDAY_INDEX[weekday] >= 1 && WEEKDAY_INDEX[weekday] <= 5;
  }

  if (targetValue === "weekend") {
    return weekday === "saturday" || weekday === "sunday";
  }

  return weekday === targetValue;
}

function matchesDateValue(targetValue: string, dateValue: string) {
  if (!targetValue.startsWith("week:")) {
    return targetValue === dateValue;
  }

  const weekValue = targetValue.slice(5);

  if (!weekValue || weekValue === "relative") {
    return true;
  }

  return getWeekStart(dateValue) === weekValue;
}

function matchesTimeValue(targetValue: string, candidate: EventCandidateRecord) {
  const normalized = normalizeCandidate(candidate);

  if (targetValue === "all_day") {
    return true;
  }

  if (normalized.timeSlotKey === "all_day") {
    return true;
  }

  if (normalized.timeType === "unspecified") {
    return true;
  }

  return normalized.timeSlotKey === targetValue;
}

function splitDateTimeTargetValue(targetValue: string) {
  const separatorIndex = targetValue.lastIndexOf("_");

  if (separatorIndex < 0) {
    return null;
  }

  return {
    baseValue: targetValue.slice(0, separatorIndex),
    timeValue: targetValue.slice(separatorIndex + 1),
  };
}

function doesConstraintApplyToDate(constraint: ParsedCommentConstraint, candidate: EventCandidateRecord, dateValue: string) {
  if (constraint.targetType === "date") {
    return matchesDateValue(constraint.targetValue, dateValue);
  }

  if (constraint.targetType === "weekday") {
    return matchesWeekdayValue(constraint.targetValue, dateValue);
  }

  if (constraint.targetType === "time") {
    return matchesTimeValue(constraint.targetValue, candidate);
  }

  if (constraint.targetType === "date_time") {
    const parsed = splitDateTimeTargetValue(constraint.targetValue);

    if (!parsed) {
      return false;
    }

    const matchesDatePart = parsed.baseValue.startsWith("week:")
      ? matchesDateValue(parsed.baseValue, dateValue)
      : parsed.baseValue.includes("-")
        ? matchesDateValue(parsed.baseValue, dateValue)
        : matchesWeekdayValue(parsed.baseValue, dateValue);

    if (!matchesDatePart) {
      return false;
    }

    return parsed.timeValue === "all_day" ? true : matchesTimeValue(parsed.timeValue, candidate);
  }

  return false;
}

export function doesConstraintMatchCandidate(constraint: ParsedCommentConstraint, candidate: EventCandidateRecord) {
  return getCandidateDateValues(candidate).some((dateValue) => doesConstraintApplyToDate(constraint, candidate, dateValue));
}

export function getConstraintScoreForCandidate(constraint: ParsedCommentConstraint, candidate: EventCandidateRecord) {
  return doesConstraintMatchCandidate(constraint, candidate) ? COMMENT_SCORE_MAP[constraint.level] : 0;
}

export function hasHardNoConstraintForCandidate(constraints: ParsedCommentConstraint[], candidate: EventCandidateRecord) {
  return constraints.some((constraint) => constraint.level === "hard_no" && doesConstraintMatchCandidate(constraint, candidate));
}

function getDateValuesMatchedByConstraint(constraint: ParsedCommentConstraint, candidate: EventCandidateRecord) {
  return getCandidateDateValues(candidate).filter((dateValue) => doesConstraintApplyToDate(constraint, candidate, dateValue));
}

function deriveAvailabilityKey(constraints: ParsedCommentConstraint[]) {
  if (constraints.some((constraint) => constraint.level === "hard_no")) {
    return "no";
  }

  if (constraints.some((constraint) => constraint.level === "soft_no")) {
    return "maybe";
  }

  if (constraints.some((constraint) => constraint.level === "conditional" || constraint.level === "unknown")) {
    return "maybe";
  }

  return "yes";
}

export function deriveAvailabilityKeyFromConstraints(constraints: ParsedCommentConstraint[]) {
  return deriveAvailabilityKey(constraints);
}

function buildDefaultAnswer(candidate: EventCandidateRecord): ParticipantAnswerRecord {
  return {
    candidateId: candidate.id,
    availabilityKey: "yes",
    selectedDates: getCandidateDateValues(candidate),
    preferredTimeSlotKey: normalizeCandidate(candidate).timeType === "unspecified" ? "all_day" : null,
    dateTimePreferences: {},
    availableStartTime: null,
    availableEndTime: null,
  };
}

export function buildDefaultAnswers(candidates: EventCandidateRecord[]) {
  return candidates.map((candidate) => buildDefaultAnswer(candidate));
}

function buildDerivedAnswer(candidate: EventCandidateRecord, constraints: ParsedCommentConstraint[]): ParticipantAnswerRecord {
  const matchingConstraints = constraints.filter((constraint) => doesConstraintMatchCandidate(constraint, candidate));
  const matchingAvailabilityConstraints = matchingConstraints.filter((constraint) => constraint.intent !== "preference");

  if (matchingAvailabilityConstraints.length === 0) {
    return buildDefaultAnswer(candidate);
  }

  const candidateDates = getCandidateDateValues(candidate);
  const positiveConstraints = matchingAvailabilityConstraints.filter((constraint) =>
    constraint.level === "conditional" || constraint.level === "soft_yes" || constraint.level === "strong_yes",
  );
  const negativeConstraints = matchingAvailabilityConstraints.filter((constraint) =>
    constraint.level === "hard_no" || constraint.level === "soft_no",
  );

  const positiveDates = sortDateValues(
    positiveConstraints.flatMap((constraint) => getDateValuesMatchedByConstraint(constraint, candidate)),
  );
  const negativeDates = new Set(negativeConstraints.flatMap((constraint) => getDateValuesMatchedByConstraint(constraint, candidate)));
  const hasExplicitPositiveDates = positiveDates.length > 0;
  const availabilityKey = deriveAvailabilityKey(matchingAvailabilityConstraints);
  let selectedDates =
    availabilityKey === "no"
      ? []
      : hasExplicitPositiveDates
        ? positiveDates
        : candidateDates.filter((dateValue) => !negativeDates.has(dateValue));

  if (selectedDates.length === 0 && availabilityKey !== "no") {
    selectedDates = candidateDates;
  }

  const normalized = normalizeCandidate(candidate);
  const dateTimePreferences: Record<string, string> = {};
  let preferredTimeSlotKey: string | null = null;

  if (normalized.timeType === "unspecified") {
    for (const constraint of positiveConstraints) {
      if (constraint.targetType !== "date_time" && constraint.targetType !== "time") {
        continue;
      }

      const parsed = constraint.targetType === "date_time" ? splitDateTimeTargetValue(constraint.targetValue) : null;
      const timeValue = constraint.targetType === "time" ? constraint.targetValue : parsed?.timeValue;

      if (!timeValue || timeValue === "all_day") {
        preferredTimeSlotKey = preferredTimeSlotKey ?? "all_day";
        continue;
      }

      const matchedDates = getDateValuesMatchedByConstraint(constraint, candidate);

      for (const dateValue of matchedDates) {
        dateTimePreferences[dateValue] = timeValue;
      }
    }

    if (!preferredTimeSlotKey && Object.keys(dateTimePreferences).length === 0 && selectedDates.length > 0) {
      preferredTimeSlotKey = "all_day";
    }
  }

  return {
    candidateId: candidate.id,
    availabilityKey,
    selectedDates,
    preferredTimeSlotKey,
    dateTimePreferences,
    availableStartTime: null,
    availableEndTime: null,
  };
}

export function buildAnswersFromConstraints(candidates: EventCandidateRecord[], constraints: ParsedCommentConstraint[]) {
  return candidates.map((candidate) => buildDerivedAnswer(candidate, constraints));
}

function sortDateValues(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function buildDerivedResponseFromComment(note: string, candidates: EventCandidateRecord[]): DerivedResponseResult {
  const trimmed = normalizeText(note);
  const parsedConstraints = parseCommentConstraints(trimmed, candidates);

  if (!trimmed) {
    return {
      parsedConstraints,
      usedDefault: true,
      defaultReason: "empty",
      answers: buildDefaultAnswers(candidates),
    };
  }

  if (parsedConstraints.length === 0) {
    return {
      parsedConstraints,
      usedDefault: true,
      defaultReason: "unparsed",
      answers: buildDefaultAnswers(candidates),
    };
  }

  return {
    parsedConstraints,
    usedDefault: false,
    defaultReason: null,
    answers: buildAnswersFromConstraints(candidates, parsedConstraints),
  };
}

function normalizeAnswersForCompare(answers: ParticipantResponseRecord["answers"]) {
  return [...answers]
    .map((answer) => ({
      ...answer,
      selectedDates: [...answer.selectedDates].sort((left, right) => left.localeCompare(right)),
      dateTimePreferences: Object.fromEntries(
        Object.entries(answer.dateTimePreferences ?? {}).sort(([left], [right]) => left.localeCompare(right)),
      ),
    }))
    .sort((left, right) => left.candidateId.localeCompare(right.candidateId));
}

export function inferResponseInterpretationMode(
  response: Pick<ParticipantResponseRecord, "note" | "answers" | "parsedConstraints">,
  candidates: EventCandidateRecord[],
): ResponseInterpretationMode {
  const note = response.note?.trim() ?? "";
  const constraints = response.parsedConstraints ?? [];

  if (!note) {
    return "manual";
  }

  if (constraints.some((constraint) => constraint.source === "auto_llm")) {
    return "parsed_comment";
  }

  const defaultAnswers = buildDefaultAnswers(candidates);
  const hasNoConstraints = constraints.length === 0;
  const answersMatchDefault =
    JSON.stringify(normalizeAnswersForCompare(response.answers)) === JSON.stringify(normalizeAnswersForCompare(defaultAnswers));

  if (hasNoConstraints && answersMatchDefault) {
    return "unparsed_default";
  }

  if (constraints.length > 0) {
    const derivedAnswers = buildAnswersFromConstraints(candidates, constraints);
    const answersMatchDerived =
      JSON.stringify(normalizeAnswersForCompare(response.answers)) === JSON.stringify(normalizeAnswersForCompare(derivedAnswers));

    if (answersMatchDerived) {
      return "parsed_comment";
    }
  }

  return "manual";
}

function formatTargetLabel(targetType: ParsedCommentConstraint["targetType"], targetValue: string) {
  if (targetType === "date") {
    if (targetValue === "week:relative") {
      return "その週";
    }

    if (targetValue.startsWith("week:")) {
      const weekValue = targetValue.slice(5);
      return weekValue ? `${formatDate(weekValue)} の週` : "その週";
    }

    return padDateLabel(targetValue);
  }

  if (targetType === "weekday") {
    return WEEKDAY_LABELS[targetValue as WeekdayValue] ?? targetValue;
  }

  if (targetType === "time") {
    return TIME_LABELS[targetValue as SupportedTimeKey] ?? targetValue;
  }

  const parsed = splitDateTimeTargetValue(targetValue);

  if (!parsed) {
    return targetValue;
  }

  const baseLabel = parsed.baseValue.startsWith("week:")
    ? parsed.baseValue === "week:relative"
      ? "その週"
      : `${formatDate(parsed.baseValue.slice(5))} の週`
    : parsed.baseValue.includes("-")
      ? padDateLabel(parsed.baseValue)
      : WEEKDAY_LABELS[parsed.baseValue as WeekdayValue] ?? parsed.baseValue;
  const timeLabel = TIME_LABELS[parsed.timeValue as SupportedTimeKey] ?? parsed.timeValue;

  return `${baseLabel} ${timeLabel}`;
}

export function formatParsedConstraintLabel(constraint: ParsedCommentConstraint) {
  if (constraint.intent === "preference") {
    const preferenceLabel = constraint.level === "conditional" ? "できれば希望" : "希望";

    return `${formatTargetLabel(constraint.targetType, constraint.targetValue)} → ${preferenceLabel}`;
  }

  return `${formatTargetLabel(constraint.targetType, constraint.targetValue)} → ${formatConstraintLevelLabel(constraint.level)}`;
}
