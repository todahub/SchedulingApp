import { AVAILABILITY_LEVELS, TIME_SLOT_OPTIONS } from "./config";
import type { AvailabilityLevel, EventCandidateRecord } from "./domain";

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

export function formatCandidateLabel(candidate: EventCandidateRecord) {
  const slot = getTimeSlotByKey(candidate.timeSlotKey);
  return `${formatDate(candidate.date)} ${slot.label}`;
}

export function sortCandidatesByDate<T extends { date: string; timeSlotKey: string; sortOrder: number }>(candidates: T[]) {
  return [...candidates].sort((left, right) => {
    if (left.date !== right.date) {
      return left.date.localeCompare(right.date);
    }

    const leftSlot = getTimeSlotByKey(left.timeSlotKey).sortOrder;
    const rightSlot = getTimeSlotByKey(right.timeSlotKey).sortOrder;

    if (leftSlot !== rightSlot) {
      return leftSlot - rightSlot;
    }

    return left.sortOrder - right.sortOrder;
  });
}
