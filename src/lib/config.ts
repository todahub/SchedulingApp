import type { AvailabilityLevel, AvailabilityTone, ResultMode, TimeSlotOption } from "./domain";

export const AVAILABILITY_LEVELS: AvailabilityLevel[] = [
  { key: "yes", label: "行ける", weight: 1, tone: "yes", sortOrder: 10 },
  { key: "maybe", label: "微妙", weight: 0.5, tone: "maybe", sortOrder: 20 },
  { key: "no", label: "無理", weight: 0, tone: "no", sortOrder: 30 },
];

export const TIME_SLOT_OPTIONS: TimeSlotOption[] = [
  { key: "day", label: "昼", description: "12:00-17:00", startsAt: "12:00", endsAt: "17:00", sortOrder: 10 },
  { key: "night", label: "夜", description: "18:00-22:00", startsAt: "18:00", endsAt: "22:00", sortOrder: 20 },
  { key: "all_day", label: "オール", description: "終日", startsAt: null, endsAt: null, sortOrder: 30 },
];

export const DEFAULT_RESULT_MODE: ResultMode = "strict_all";

export const RESULT_MODE_LABELS: Record<ResultMode, string> = {
  strict_all: "全員参加優先モード",
  maximize_attendance: "できるだけ全員参加モード",
};

export const availabilityLabelMap = Object.fromEntries(AVAILABILITY_LEVELS.map((level) => [level.key, level.label])) as Record<
  string,
  string
>;

export const timeSlotLabelMap = Object.fromEntries(TIME_SLOT_OPTIONS.map((slot) => [slot.key, slot.label])) as Record<string, string>;

export const availabilityToneClass: Record<AvailabilityTone, string> = {
  yes: "status-pill--yes",
  maybe: "status-pill--maybe",
  no: "status-pill--no",
};
