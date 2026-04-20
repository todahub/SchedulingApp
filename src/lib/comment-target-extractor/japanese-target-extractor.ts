import type {
  EventDateRange,
  ExtractCommentTimeFeaturesOptions,
  ExtractedTimeTargetCandidate,
  ExtractedTimeTargetKind,
  ExtractedTimeTargetMetadata,
} from "./types";

type DateIndex = {
  uniqueDayMap: Map<string, string | null>;
  uniqueMonthDayMap: Map<string, string | null>;
};

type ProtectedSpan = {
  start: number;
  end: number;
};

const ASCII_OR_FULL_WIDTH_DIGIT = "[0-9０-９]";

const DAY_RANGE_SOURCE = `${ASCII_OR_FULL_WIDTH_DIGIT}{1,2}(?:日)?\\s*(?:[~〜-]|から)\\s*${ASCII_OR_FULL_WIDTH_DIGIT}{1,2}(?:日)?(?:まで)?`;
const DATE_WITH_SLASH_SOURCE = `${ASCII_OR_FULL_WIDTH_DIGIT}{1,2}\\/${ASCII_OR_FULL_WIDTH_DIGIT}{1,2}`;
const DATE_WITH_MONTH_SOURCE = `${ASCII_OR_FULL_WIDTH_DIGIT}{1,2}月\\s*${ASCII_OR_FULL_WIDTH_DIGIT}{1,2}日?`;
const DATE_WITH_DAY_SOURCE = `${ASCII_OR_FULL_WIDTH_DIGIT}{1,2}日`;
const TWO_DIGIT_BARE_DAY_SOURCE = `${ASCII_OR_FULL_WIDTH_DIGIT}{2}`;
const DATE_LIST_ITEM_SOURCE = `(?:${DATE_WITH_SLASH_SOURCE}|${DATE_WITH_MONTH_SOURCE}|${DATE_WITH_DAY_SOURCE}|${TWO_DIGIT_BARE_DAY_SOURCE})`;
const DATE_LIST_CONNECTOR_SOURCE = `(?:、|,|，|と|か|or|OR|Or)`;
const DATE_LIST_SOURCE = `${DATE_LIST_ITEM_SOURCE}(?:\\s*${DATE_LIST_CONNECTOR_SOURCE}\\s*${DATE_LIST_ITEM_SOURCE})+`;

const BARE_DAY_CONTEXT_SOURCE = `(?<![0-9０-９\\/-〜~,、と])${ASCII_OR_FULL_WIDTH_DIGIT}{1,2}(?=\\s*(?:は|が|なら|だけ|しか|以外|より|じゃないと|じゃなきゃ|いける|行ける|いけます|行けます|いけそう|行けそう|大丈夫|だいじょうぶ|OK|ok|Ok|oK|参加できる|参加できます|参加したい|行きたい|いきたい|空いてる|空いてます|あいてる|あいてます|無理ではない|無理|むり|厳しい|きつい|ダメ|だめ|嫌|いや|やだ|がいい(?:です)?|の方がいい(?:です)?|方がいい(?:です)?|が理想|がベスト|が一番いい|が第一希望|が嬉しい|がうれしい|が助かる|がありがたい|が都合いい|だと嬉しい|だとうれしい|だと助かる|だとありがたい(?:です)?|だと都合いい|第一希望|優先))`;
const PREFERENCE_BARE_DAY_SOURCE = `(?<![0-9０-９\\/-])${ASCII_OR_FULL_WIDTH_DIGIT}{1,2}(?=(?:の方がいい(?:です)?|方がいい(?:です)?|がいい(?:です)?|が希望|希望(?:です)?))`;
const PREFIXED_BARE_DAY_SOURCE = `(?:できれば|できたら|可能なら|なるべく)\\s*(${ASCII_OR_FULL_WIDTH_DIGIT}{1,2})(?![0-9０-９\\/-〜~])`;
const POST_CONDITION_BARE_DAY_SOURCE = `(?:なら|ならば|だったら)\\s*(${ASCII_OR_FULL_WIDTH_DIGIT}{1,2})(?=\\s*(?:$|[、,，。！？!?]))`;
const BARE_WEEKDAY_CONTEXT_SOURCE = `(?<![0-9０-９A-Za-zぁ-んァ-ヶー])([月火水木金土日])(?!曜|曜日)(?=\\s*(?:は|が|なら|だけ|しか|より|の方が|方が|夜|午前|午後|朝|昼|夕方|終日|一日中|いける|行ける|いけます|行けます|大丈夫|無理|厳しい|きつい|がいい(?:です)?|が理想|がベスト|が一番いい|が第一希望|が嬉しい|がうれしい|が助かる|がありがたい|が都合いい|嬉しい|うれしい|助かる|ありがたい|都合いい|第一希望|優先|ベスト|理想|$))`;
const WEEKDAY_PAIR_SOURCE = `(?<![0-9０-９A-Za-zぁ-んァ-ヶー])([月火水木金土日]{2})(?=\\s*(?:なら|は|が|より|の方が|方が|夜|午前|午後|朝|昼|夕方|いける|行ける|いけます|行けます|大丈夫|無理|厳しい|きつい|がいい(?:です)?|が理想|がベスト|が一番いい|が第一希望|が嬉しい|がうれしい|が助かる|がありがたい|が都合いい|嬉しい|うれしい|助かる|ありがたい|都合いい|第一希望|優先|ベスト|理想|$))`;
const DATE_ITEM_REGEX = new RegExp(DATE_LIST_ITEM_SOURCE, "gu");

function normalizeDigits(value: string) {
  return value.replace(/[０-９]/gu, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0));
}

function buildDateIndex(eventDateRange?: EventDateRange): DateIndex | null {
  if (!eventDateRange) {
    return null;
  }

  const current = new Date(`${eventDateRange.start}T00:00:00+09:00`);
  const end = new Date(`${eventDateRange.end}T00:00:00+09:00`);
  const uniqueDayMap = new Map<string, string | null>();
  const uniqueMonthDayMap = new Map<string, string | null>();

  while (current <= end) {
    const isoDate = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}`;
    const dayKey = String(current.getDate());
    const monthDayKey = `${current.getMonth() + 1}/${current.getDate()}`;

    uniqueDayMap.set(dayKey, uniqueDayMap.has(dayKey) && uniqueDayMap.get(dayKey) !== isoDate ? null : isoDate);
    uniqueMonthDayMap.set(
      monthDayKey,
      uniqueMonthDayMap.has(monthDayKey) && uniqueMonthDayMap.get(monthDayKey) !== isoDate ? null : isoDate,
    );

    current.setDate(current.getDate() + 1);
  }

  return { uniqueDayMap, uniqueMonthDayMap };
}

function createCandidate(params: {
  kind: ExtractedTimeTargetKind;
  text: string;
  start: number;
  end: number;
  normalizedValue?: string;
  metadata?: ExtractedTimeTargetMetadata;
}) {
  return {
    kind: params.kind,
    source: "japanese_rule" as const,
    text: params.text,
    start: params.start,
    end: params.end,
    normalizedValue: params.normalizedValue,
    metadata: params.metadata,
  } satisfies ExtractedTimeTargetCandidate;
}

function pushUnique(
  candidates: ExtractedTimeTargetCandidate[],
  candidate: ExtractedTimeTargetCandidate,
) {
  if (
    !candidates.some(
      (item) =>
        item.kind === candidate.kind &&
        item.start === candidate.start &&
        item.end === candidate.end &&
        item.normalizedValue === candidate.normalizedValue,
    )
  ) {
    candidates.push(candidate);
  }
}

function isProtected(start: number, end: number, protectedSpans: ProtectedSpan[]) {
  return protectedSpans.some((span) => start >= span.start && end <= span.end);
}

function addBareDayCandidate(params: {
  rawText: string;
  start: number;
  end: number;
  candidates: ExtractedTimeTargetCandidate[];
  protectedSpans: ProtectedSpan[];
  dateIndex: DateIndex | null;
  metadata?: ExtractedTimeTargetMetadata;
}) {
  if (isProtected(params.start, params.end, params.protectedSpans)) {
    return;
  }

  const resolved = resolveDateToken(`${params.rawText}日`, params.dateIndex);
  const candidate = createCandidate({
    kind: "date",
    text: params.rawText,
    start: params.start,
    end: params.end,
    normalizedValue: resolved.normalizedValue,
    metadata: params.metadata
      ? {
          ...resolved.metadata,
          ...params.metadata,
        }
      : resolved.metadata,
  });

  params.protectedSpans.push({ start: params.start, end: params.end });
  pushUnique(params.candidates, candidate);
}

function addDateCandidate(params: {
  rawText: string;
  start: number;
  end: number;
  candidates: ExtractedTimeTargetCandidate[];
  protectedSpans: ProtectedSpan[];
  dateIndex: DateIndex | null;
  metadata?: ExtractedTimeTargetMetadata;
}) {
  if (isProtected(params.start, params.end, params.protectedSpans)) {
    return;
  }

  const resolved = resolveDateToken(params.rawText, params.dateIndex);
  const candidate = createCandidate({
    kind: "date",
    text: params.rawText,
    start: params.start,
    end: params.end,
    normalizedValue: resolved.normalizedValue,
    metadata: params.metadata
      ? {
          ...resolved.metadata,
          ...params.metadata,
        }
      : resolved.metadata,
  });

  params.protectedSpans.push({ start: params.start, end: params.end });
  pushUnique(params.candidates, candidate);
}

function resolveDateToken(rawText: string, index: DateIndex | null) {
  const normalizedText = normalizeDigits(rawText).replace(/\s+/gu, "");
  const slashMatch = normalizedText.match(/^(\d{1,2})\/(\d{1,2})$/u);
  const monthDayMatch = normalizedText.match(/^(\d{1,2})月(\d{1,2})日?$/u);
  const dayMatch = normalizedText.match(/^(\d{1,2})日?$/u);

  if (slashMatch) {
    const key = `${Number(slashMatch[1])}/${Number(slashMatch[2])}`;
    return {
      normalizedValue: index?.uniqueMonthDayMap.get(key) ?? normalizedText,
      metadata: {
        rawDate: rawText,
        resolvedDate: index?.uniqueMonthDayMap.get(key) ?? null,
        resolutionKey: key,
      } satisfies ExtractedTimeTargetMetadata,
    };
  }

  if (monthDayMatch) {
    const key = `${Number(monthDayMatch[1])}/${Number(monthDayMatch[2])}`;
    return {
      normalizedValue: index?.uniqueMonthDayMap.get(key) ?? normalizedText,
      metadata: {
        rawDate: rawText,
        resolvedDate: index?.uniqueMonthDayMap.get(key) ?? null,
        resolutionKey: key,
      } satisfies ExtractedTimeTargetMetadata,
    };
  }

  if (dayMatch) {
    const key = String(Number(dayMatch[1]));
    return {
      normalizedValue: index?.uniqueDayMap.get(key) ?? normalizedText,
      metadata: {
        rawDate: rawText,
        resolvedDate: index?.uniqueDayMap.get(key) ?? null,
        resolutionKey: key,
      } satisfies ExtractedTimeTargetMetadata,
    };
  }

  return {
    normalizedValue: normalizedText,
    metadata: {
      rawDate: rawText,
      resolvedDate: null,
      resolutionKey: null,
    } satisfies ExtractedTimeTargetMetadata,
  };
}

function resolveDayRangeToken(rawText: string, index: DateIndex | null) {

  const normalizedText = normalizeDigits(rawText).replace(/\s+/gu, "");
  const match = normalizedText.match(/^(\d{1,2})(?:日)?(?:[~〜-]|から)(\d{1,2})(?:日)?(?:まで)?$/u);



  if (!match) {
    return null;
  }

  const startDay = Number(match[1]);
  const endDay = Number(match[2]);

  if (Number.isNaN(startDay) || Number.isNaN(endDay) || endDay < startDay) {
    return null;
  }

  const resolvedDates: string[] = [];
  let fullyResolved = true;

  for (let day = startDay; day <= endDay; day += 1) {
    const resolvedDate = index?.uniqueDayMap.get(String(day)) ?? null;

    if (!resolvedDate) {
      fullyResolved = false;
      break;
    }

    resolvedDates.push(resolvedDate);
  }

  return {
    normalizedValue:
      fullyResolved && resolvedDates.length > 0
        ? `${resolvedDates[0]}..${resolvedDates[resolvedDates.length - 1]}`
        : `${startDay}..${endDay}`,
    metadata: {
      rawDateRange: rawText,
      resolvedStartDate: resolvedDates[0] ?? null,
      resolvedEndDate: resolvedDates[resolvedDates.length - 1] ?? null,
      resolvedDates,
      resolutionKey: `${startDay}..${endDay}`,
    } satisfies ExtractedTimeTargetMetadata,
  };
}

function getWeekdayNormalizedValue(text: string) {
  if (text.startsWith("月")) return "monday";
  if (text.startsWith("火")) return "tuesday";
  if (text.startsWith("水")) return "wednesday";
  if (text.startsWith("木")) return "thursday";
  if (text.startsWith("金")) return "friday";
  if (text.startsWith("土")) return "saturday";
  return "sunday";
}

function getWeekdayGroupValue(text: string) {
  if (text === "平日") return "weekday";
  if (text === "土日") return "weekend_pair";
  return "weekend";
}

function getWeekdayPairValue(text: string) {
  return [...text].map((char) => getWeekdayNormalizedValue(char)).join("+");
}

function getRelativePeriodValue(text: string) {
  if (text === "今週") return "this_week";
  if (text === "来週") return "next_week";
  if (text === "再来週") return "week_after_next";
  if (text === "今月") return "this_month";
  return "next_month";
}

function getMonthPartValue(text: string) {
  if (text === "前半") return "first_half";
  if (text === "後半") return "second_half";
  if (text === "上旬") return "early_month";
  if (text === "中旬") return "mid_month";
  if (text === "下旬") return "late_month";
  if (text === "月初") return "month_start";
  return "month_end";
}

function getWeekOrdinalValue(text: string) {
  const normalized = normalizeDigits(text);
  const match = normalized.match(/(?:第)?(\d)週|(\d)周目/u);
  const value = match?.[1] ?? match?.[2] ?? null;

  return value ? `week_${value}` : normalized;
}

function getTimeOfDayValue(text: string) {
  if (text === "朝" || text === "午前") return "morning";
  if (text === "昼") return "noon";
  if (text === "午後") return "afternoon";
  if (text === "夕方") return "evening";
  if (text === "夜") return "night";
  if (text === "夜遅め") return "late_night";
  if (text === "終日" || text === "一日中") return "all_day";
  if (text === "オール") return "overnight";
  return "until_last_train";
}

function getHolidayRelatedValue(text: string) {
  if (text === "休日") return "holiday";
  if (text === "祝日") return "public_holiday";
  return "holiday_eve";
}

function createListItemCandidate(params: {
  rawText: string;
  start: number;
  end: number;
  candidates: ExtractedTimeTargetCandidate[];
  protectedSpans: ProtectedSpan[];
  dateIndex: DateIndex | null;
  metadata?: ExtractedTimeTargetMetadata;
}) {
  if (new RegExp(`^${TWO_DIGIT_BARE_DAY_SOURCE}$`, "u").test(params.rawText)) {
    addBareDayCandidate({
      rawText: params.rawText,
      start: params.start,
      end: params.end,
      candidates: params.candidates,
      protectedSpans: params.protectedSpans,
      dateIndex: params.dateIndex,
      metadata: params.metadata
        ? {
            inferredFromListContext: true,
            ...params.metadata,
          }
        : {
            inferredFromListContext: true,
          },
    });
    return;
  }

  addDateCandidate({
    rawText: params.rawText,
    start: params.start,
    end: params.end,
    candidates: params.candidates,
    protectedSpans: params.protectedSpans,
    dateIndex: params.dateIndex,
    metadata: params.metadata
      ? {
          inferredFromListContext: true,
          ...params.metadata,
        }
      : {
          inferredFromListContext: true,
        },
  });
}

export function extractJapaneseTimeTargetCandidates(
  normalizedText: string,
  options?: ExtractCommentTimeFeaturesOptions,
) {
  const candidates: ExtractedTimeTargetCandidate[] = [];
  const protectedSpans: ProtectedSpan[] = [];
  const dateIndex = buildDateIndex(options?.eventDateRange);

  for (const match of normalizedText.matchAll(new RegExp(DAY_RANGE_SOURCE, "gu"))) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const resolved = resolveDayRangeToken(match[0], dateIndex);

    if (!resolved) {
      continue;
    }

    const candidate = createCandidate({
      kind: "date_range",
      text: match[0],
      start,
      end,
      normalizedValue: resolved.normalizedValue,
      metadata: resolved.metadata,
    });
    protectedSpans.push({ start, end });
    pushUnique(candidates, candidate);
  }
  
  for (const match of normalizedText.matchAll(new RegExp(DATE_WITH_SLASH_SOURCE, "gu"))) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const resolved = resolveDateToken(match[0], dateIndex);
    const candidate = createCandidate({
      kind: "date",
      text: match[0],
      start,
      end,
      normalizedValue: resolved.normalizedValue,
      metadata: resolved.metadata,
    });
    protectedSpans.push({ start, end });
    pushUnique(candidates, candidate);
  }

  for (const match of normalizedText.matchAll(new RegExp(DATE_WITH_MONTH_SOURCE, "gu"))) {
    const start = match.index ?? 0;
    const end = start + match[0].length;

    if (isProtected(start, end, protectedSpans)) {
      continue;
    }

    const resolved = resolveDateToken(match[0], dateIndex);
    const candidate = createCandidate({
      kind: "date",
      text: match[0],
      start,
      end,
      normalizedValue: resolved.normalizedValue,
      metadata: resolved.metadata,
    });
    protectedSpans.push({ start, end });
    pushUnique(candidates, candidate);
  }

  for (const match of normalizedText.matchAll(new RegExp(DATE_WITH_DAY_SOURCE, "gu"))) {
    const start = match.index ?? 0;
    const end = start + match[0].length;

    if (isProtected(start, end, protectedSpans)) {
      continue;
    }

    const resolved = resolveDateToken(match[0], dateIndex);
    const candidate = createCandidate({
      kind: "date",
      text: match[0],
      start,
      end,
      normalizedValue: resolved.normalizedValue,
      metadata: resolved.metadata,
    });
    protectedSpans.push({ start, end });
    pushUnique(candidates, candidate);
  }

  for (const match of normalizedText.matchAll(new RegExp(PREFERENCE_BARE_DAY_SOURCE, "gu"))) {
    const start = match.index ?? 0;
    const end = start + match[0].length;

    addBareDayCandidate({
      rawText: match[0],
      start,
      end,
      candidates,
      protectedSpans,
      dateIndex,
      metadata: {
        inferredFromPreferenceContext: true,
      },
    });
  }

  for (const match of normalizedText.matchAll(new RegExp(BARE_DAY_CONTEXT_SOURCE, "gu"))) {
    const start = match.index ?? 0;
    const end = start + match[0].length;

    addBareDayCandidate({
      rawText: match[0],
      start,
      end,
      candidates,
      protectedSpans,
      dateIndex,
      metadata: {
        inferredFromContext: true,
      },
    });
  }

  for (const match of normalizedText.matchAll(new RegExp(PREFIXED_BARE_DAY_SOURCE, "gu"))) {
    const rawDay = match[1];

    if (!rawDay) {
      continue;
    }

    const start = (match.index ?? 0) + match[0].lastIndexOf(rawDay);
    const end = start + rawDay.length;

    addBareDayCandidate({
      rawText: rawDay,
      start,
      end,
      candidates,
      protectedSpans,
      dateIndex,
      metadata: {
        inferredFromPreferenceContext: true,
        inferredFromPrefixMarker: true,
      },
    });
  }

  for (const match of normalizedText.matchAll(new RegExp(POST_CONDITION_BARE_DAY_SOURCE, "gu"))) {
    const rawDay = match[1];

    if (!rawDay) {
      continue;
    }

    const start = (match.index ?? 0) + match[0].lastIndexOf(rawDay);
    const end = start + rawDay.length;

    addBareDayCandidate({
      rawText: rawDay,
      start,
      end,
      candidates,
      protectedSpans,
      dateIndex,
      metadata: {
        inferredFromConditionalTail: true,
      },
    });
  }

  for (const match of normalizedText.matchAll(new RegExp(DATE_LIST_SOURCE, "gu"))) {
    const phraseText = match[0];
    const phraseStart = match.index ?? 0;
    const items = [...phraseText.matchAll(DATE_ITEM_REGEX)];

    if (items.length < 2) {
      continue;
    }

    const listTexts = items.map((item) => item[0]);

    items.forEach((item, itemIndex) => {
      const rawText = item[0];
      const relativeStart = item.index ?? 0;
      const start = phraseStart + relativeStart;
      const end = start + rawText.length;
      const metadata = {
        listPhraseText: phraseText,
        listIndex: itemIndex,
        listLength: items.length,
        listItems: listTexts,
      } satisfies ExtractedTimeTargetMetadata;

      createListItemCandidate({
        rawText,
        start,
        end,
        candidates,
        protectedSpans,
        dateIndex,
        metadata,
      });
    });
  }

  for (const match of normalizedText.matchAll(/[月火水木金土日](?:曜|曜日)/gu)) {
    pushUnique(
      candidates,
      createCandidate({
        kind: "weekday",
        text: match[0],
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
        normalizedValue: getWeekdayNormalizedValue(match[0]),
      }),
    );
  }

  for (const match of normalizedText.matchAll(/平日|土日|週末/gu)) {
    pushUnique(
      candidates,
      createCandidate({
        kind: "weekday_group",
        text: match[0],
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
        normalizedValue: getWeekdayGroupValue(match[0]),
      }),
    );
  }

  for (const match of normalizedText.matchAll(new RegExp(WEEKDAY_PAIR_SOURCE, "gu"))) {
    if (match[0] === "土日") {
      continue;
    }

    pushUnique(
      candidates,
      createCandidate({
        kind: "weekday_group",
        text: match[0],
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
        normalizedValue: getWeekdayPairValue(match[0]),
        metadata: {
          weekdayValues: [...match[0]].map((char) => getWeekdayNormalizedValue(char)),
          inferredFromBareWeekdayPair: true,
        },
      }),
    );
  }

  for (const match of normalizedText.matchAll(new RegExp(BARE_WEEKDAY_CONTEXT_SOURCE, "gu"))) {
    const weekdayText = match[1];

    if (!weekdayText) {
      continue;
    }

    const start = (match.index ?? 0) + match[0].lastIndexOf(weekdayText);
    const end = start + weekdayText.length;

    pushUnique(
      candidates,
      createCandidate({
        kind: "weekday",
        text: weekdayText,
        start,
        end,
        normalizedValue: getWeekdayNormalizedValue(weekdayText),
        metadata: {
          inferredFromBareWeekdayContext: true,
        },
      }),
    );
  }

  for (const match of normalizedText.matchAll(/休日|祝日前|祝日/gu)) {
    pushUnique(
      candidates,
      createCandidate({
        kind: "holiday_related",
        text: match[0],
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
        normalizedValue: getHolidayRelatedValue(match[0]),
      }),
    );
  }

  for (const match of normalizedText.matchAll(/今週|来週|再来週|今月|来月/gu)) {
    pushUnique(
      candidates,
      createCandidate({
        kind: "relative_period",
        text: match[0],
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
        normalizedValue: getRelativePeriodValue(match[0]),
      }),
    );
  }

  for (const match of normalizedText.matchAll(/前半|後半|上旬|中旬|下旬|月初|月末/gu)) {
    pushUnique(
      candidates,
      createCandidate({
        kind: "month_part",
        text: match[0],
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
        normalizedValue: getMonthPartValue(match[0]),
      }),
    );
  }

  for (const match of normalizedText.matchAll(/(?<![0-9０-９,、])[1-4１-４]周目|(?<![0-9０-９,、])第[1-4１-４]週/gu)) {
    pushUnique(
      candidates,
      createCandidate({
        kind: "week_ordinal",
        text: match[0],
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
        normalizedValue: getWeekOrdinalValue(match[0]),
      }),
    );
  }

  for (const match of normalizedText.matchAll(/朝|午前|昼|午後|夕方|夜遅め|夜|終日|一日中|オール|終電まで/gu)) {
    pushUnique(
      candidates,
      createCandidate({
        kind: "time_of_day",
        text: match[0],
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
        normalizedValue: getTimeOfDayValue(match[0]),
      }),
    );
  }

  return candidates.sort((left, right) => left.start - right.start || left.end - right.end || left.text.localeCompare(right.text));
}
