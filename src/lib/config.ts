import type {
  AvailabilityLevel,
  AvailabilityTone,
  CandidateDateType,
  CandidateSelectionMode,
  ResultMode,
  TimeSlotOption,
} from "./domain";

export const AVAILABILITY_LEVELS: AvailabilityLevel[] = [
  { key: "yes", label: "行ける", weight: 1, tone: "yes", sortOrder: 10 },
  { key: "maybe", label: "微妙", weight: 0.5, tone: "maybe", sortOrder: 20 },
  { key: "no", label: "無理", weight: 0, tone: "no", sortOrder: 30 },
];

export const TIME_SLOT_OPTIONS: TimeSlotOption[] = [
  { key: "all_day", label: "一日中", description: "その日ならいつでもよい", startsAt: null, endsAt: null, sortOrder: 10 },
  { key: "morning", label: "朝", description: "09:00-12:00 ごろ", startsAt: "09:00", endsAt: "12:00", sortOrder: 20 },
  { key: "day", label: "昼", description: "12:00-17:00 ごろ", startsAt: "12:00", endsAt: "17:00", sortOrder: 30 },
  { key: "night", label: "夜", description: "18:00-22:00 ごろ", startsAt: "18:00", endsAt: "22:00", sortOrder: 40 },
  { key: "unspecified", label: "指定なし", description: "まず日だけ聞きたい", startsAt: null, endsAt: null, sortOrder: 50 },
  { key: "custom", label: "固定時間", description: "既存データ用の詳細時間", startsAt: null, endsAt: null, sortOrder: 90 },
];

export const CANDIDATE_SELECTION_MODE_OPTIONS: Array<{
  key: CandidateSelectionMode;
  label: string;
  description: string;
}> = [
  { key: "range", label: "期間で聞く", description: "開始日から終了日までの中で行ける日を聞く" },
  { key: "discrete", label: "個別に聞く", description: "飛び飛びの日付を選んで聞く" },
];

export const CANDIDATE_DATE_TYPE_OPTIONS: Array<{
  key: CandidateDateType;
  label: string;
  description: string;
}> = [
  { key: "single", label: "単一日", description: "1日だけ候補として追加" },
  { key: "range", label: "期間", description: "開始日から終了日までの候補をまとめて追加" },
];

export const CANDIDATE_TIME_PREFERENCE_OPTIONS = TIME_SLOT_OPTIONS.filter((option) => option.key !== "custom");

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
