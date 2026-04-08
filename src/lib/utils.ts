import { AVAILABILITY_LEVELS, TIME_SLOT_OPTIONS } from "./config";
import type {
  AvailabilityLevel,
  CandidateTimeType,
  EventCandidateRecord,
  ParticipantAnswerRecord,
} from "./domain";

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  weekday: "short",
});

const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(date: string) {
  return dateFormatter.format(new Date(`${date}T00:00:00`));
}

export function formatDateTime(value: string) {
  return dateTimeFormatter.format(new Date(value));
}

export function getTimeSlotByKey(key: string | undefined) {
  return TIME_SLOT_OPTIONS.find((slot) => slot.key === key) ?? TIME_SLOT_OPTIONS[0];
}

export function getLevelByKey(key: string | undefined): AvailabilityLevel {
  return AVAILABILITY_LEVELS.find((level) => level.key === key) ?? AVAILABILITY_LEVELS[AVAILABILITY_LEVELS.length - 1];
}

export function isDateString(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isTimeString(value: string) {
  return /^\d{2}:\d{2}$/.test(value);
}

export function isTimeRangeValid(startTime: string | null | undefined, endTime: string | null | undefined) {
  return Boolean(startTime && endTime && isTimeString(startTime) && isTimeString(endTime) && startTime < endTime);
}

export function normalizeCandidate(candidate: EventCandidateRecord): EventCandidateRecord {
  const startDate = candidate.startDate || candidate.date;
  const endDate = candidate.endDate || startDate;
  const selectedDates =
    Array.isArray(candidate.selectedDates) && candidate.selectedDates.length > 0
      ? [...new Set(candidate.selectedDates.filter((value) => typeof value === "string" && isDateString(value)))].sort((left, right) =>
          left.localeCompare(right),
        )
      : [];
  const selectionMode = candidate.selectionMode || (selectedDates.length > 0 ? "discrete" : "range");
  const dateType = candidate.dateType || (startDate === endDate ? "single" : "range");
  const derivedTimeType: CandidateTimeType =
    candidate.timeType ||
    (candidate.timeSlotKey === "all_day" ? "all_day" : candidate.timeSlotKey === "unspecified" ? "unspecified" : "fixed");
  const slot = getTimeSlotByKey(candidate.timeSlotKey);
  const startTime = candidate.startTime ?? (derivedTimeType === "fixed" ? slot.startsAt : null);
  const endTime = candidate.endTime ?? (derivedTimeType === "fixed" ? slot.endsAt : null);

  return {
    ...candidate,
    date: startDate,
    selectionMode,
    dateType,
    startDate,
    endDate,
    selectedDates,
    timeType: derivedTimeType,
    startTime,
    endTime,
  };
}

export function getCandidateDateValues(candidate: EventCandidateRecord) {
  const normalized = normalizeCandidate(candidate);

  if (normalized.selectionMode === "discrete" && normalized.selectedDates.length > 0) {
    return normalized.selectedDates;
  }

  const values: string[] = [];
  const cursor = new Date(`${normalized.startDate}T00:00:00`);
  const end = new Date(`${normalized.endDate}T00:00:00`);

  while (cursor <= end) {
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, "0");
    const day = String(cursor.getDate()).padStart(2, "0");
    values.push(`${year}-${month}-${day}`);
    cursor.setDate(cursor.getDate() + 1);
  }

  return values;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateSegments(dates: string[]) {
  if (dates.length === 0) {
    return "";
  }

  const segments: Array<{ start: string; end: string }> = [];
  let segmentStart = dates[0];
  let previous = dates[0];

  for (const current of dates.slice(1)) {
    if (current === addDays(previous, 1)) {
      previous = current;
      continue;
    }

    segments.push({ start: segmentStart, end: previous });
    segmentStart = current;
    previous = current;
  }

  segments.push({ start: segmentStart, end: previous });

  return segments
    .map((segment) => (segment.start === segment.end ? formatDate(segment.start) : `${formatDate(segment.start)}〜${formatDate(segment.end)}`))
    .join(", ");
}

export function getCandidateDateLabel(candidate: EventCandidateRecord) {
  return formatDateSegments(getCandidateDateValues(candidate));
}

export function getCandidateTimeLabel(candidate: EventCandidateRecord) {
  const normalized = normalizeCandidate(candidate);

  const slot = getTimeSlotByKey(normalized.timeSlotKey);
  if (normalized.timeSlotKey !== "custom") {
    return slot.label;
  }

  if (normalized.startTime && normalized.endTime) {
    return `${normalized.startTime}〜${normalized.endTime}`;
  }

  return "固定時間";
}

export function formatCandidateLabel(candidate: EventCandidateRecord) {
  return `${getCandidateDateLabel(candidate)} ${getCandidateTimeLabel(candidate)}`;
}

export function formatCandidateTypeSummary(candidate: EventCandidateRecord) {
  const normalized = normalizeCandidate(candidate);
  const dateTypeLabel =
    normalized.selectionMode === "discrete"
      ? "個別日候補"
      : getCandidateDateValues(normalized).length > 1
        ? "期間候補"
        : "単一日候補";

  return `${dateTypeLabel} / ${getCandidateTimeLabel(normalized)}`;
}

export function formatSelectedDatesLabel(selectedDates: string[]) {
  return selectedDates.map((date) => formatDate(date)).join(", ");
}

export function formatAnswerDetail(answer: ParticipantAnswerRecord, candidate: EventCandidateRecord) {
  const normalized = normalizeCandidate(candidate);
  const details: string[] = [];

  if (getCandidateDateValues(normalized).length > 1 && answer.selectedDates.length > 0) {
    details.push(`選択日: ${formatSelectedDatesLabel(answer.selectedDates)}`);
  }

  if (normalized.timeType === "unspecified" && answer.preferredTimeSlotKey) {
    details.push(`希望時間帯: ${getTimeSlotByKey(answer.preferredTimeSlotKey).label}`);
  }

  const dateTimeEntries = Object.entries(answer.dateTimePreferences ?? {})
    .filter(([date, key]) => isDateString(date) && typeof key === "string" && key.length > 0)
    .sort(([left], [right]) => left.localeCompare(right));

  if (dateTimeEntries.length > 0) {
    details.push(
      `日付ごとの時間帯: ${dateTimeEntries
        .map(([date, key]) => `${formatDate(date)} ${getTimeSlotByKey(key).label}`)
        .join(", ")}`,
    );
  }

  if (
    normalized.timeType === "unspecified" &&
    answer.availableStartTime &&
    answer.availableEndTime &&
    isTimeRangeValid(answer.availableStartTime, answer.availableEndTime)
  ) {
    details.push(`参加可能時間: ${answer.availableStartTime}〜${answer.availableEndTime}`);
  }

  return details;
}

export function isAnswerComplete(candidate: EventCandidateRecord, answer: Partial<ParticipantAnswerRecord> | undefined) {
  const normalized = normalizeCandidate(candidate);
  const availabilityKey = answer?.availabilityKey;

  if (!availabilityKey) {
    return false;
  }

  if (availabilityKey === "no") {
    return true;
  }

  if (getCandidateDateValues(normalized).length > 1 && (!answer?.selectedDates || answer.selectedDates.length === 0)) {
    return false;
  }

  if (normalized.timeType === "unspecified") {
    const requiredDates =
      answer?.selectedDates && answer.selectedDates.length > 0 ? answer.selectedDates : getCandidateDateValues(normalized).slice(0, 1);
    const hasPerDateSlots =
      requiredDates.length > 0 &&
      requiredDates.every((date) => typeof answer?.dateTimePreferences?.[date] === "string" && answer.dateTimePreferences[date].length > 0);

    if (hasPerDateSlots) {
      return true;
    }

    if (answer?.preferredTimeSlotKey) {
      return true;
    }

    if (!isTimeRangeValid(answer?.availableStartTime ?? null, answer?.availableEndTime ?? null)) {
      return false;
    }
  }

  return true;
}

export function deriveTimeSlotKeyFromCandidate(candidate: {
  timeType: CandidateTimeType;
  startTime: string | null;
  endTime: string | null;
}) {
  if (candidate.timeType === "all_day") {
    return "all_day";
  }

  if (candidate.timeType === "unspecified") {
    return "unspecified";
  }

  const matchedSlot = TIME_SLOT_OPTIONS.find(
    (slot) =>
      slot.startsAt === candidate.startTime &&
      slot.endsAt === candidate.endTime &&
      (slot.key === "morning" || slot.key === "day" || slot.key === "night"),
  );

  return matchedSlot?.key ?? "custom";
}

function getSortDateValue(candidate: { date?: string; startDate?: string }) {
  return candidate.startDate ?? candidate.date ?? "";
}

function getSortEndDateValue(candidate: { endDate?: string; date?: string; startDate?: string }) {
  return candidate.endDate ?? candidate.startDate ?? candidate.date ?? "";
}

function getSortTimeOrder(candidate: { timeType?: CandidateTimeType; timeSlotKey: string; startTime?: string | null }) {
  if (candidate.timeType === "fixed" && candidate.startTime) {
    return 1000 + Number(candidate.startTime.replace(":", ""));
  }

  if (candidate.timeType === "all_day" || candidate.timeSlotKey === "all_day") {
    return 3000;
  }

  if (candidate.timeType === "unspecified" || candidate.timeSlotKey === "unspecified") {
    return 4000;
  }

  return getTimeSlotByKey(candidate.timeSlotKey).sortOrder;
}

export function sortCandidatesByDate<
  T extends {
    date?: string;
    startDate?: string;
    endDate?: string;
    timeType?: CandidateTimeType;
    timeSlotKey: string;
    startTime?: string | null;
    sortOrder: number;
  },
>(candidates: T[]) {
  return [...candidates].sort((left, right) => {
    const leftDate = getSortDateValue(left);
    const rightDate = getSortDateValue(right);

    if (leftDate !== rightDate) {
      return leftDate.localeCompare(rightDate);
    }

    const leftEndDate = getSortEndDateValue(left);
    const rightEndDate = getSortEndDateValue(right);

    if (leftEndDate !== rightEndDate) {
      return leftEndDate.localeCompare(rightEndDate);
    }

    const leftSlot = getSortTimeOrder(left);
    const rightSlot = getSortTimeOrder(right);

    if (leftSlot !== rightSlot) {
      return leftSlot - rightSlot;
    }

    return left.sortOrder - right.sortOrder;
  });
}
