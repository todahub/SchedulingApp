export type ResultMode = "strict_all" | "maximize_attendance";

export type AvailabilityTone = "yes" | "maybe" | "no";

export type RepositoryMode = "demo" | "supabase";

export type CandidateDateType = "single" | "range";

export type CandidateSelectionMode = "range" | "discrete";

export type CandidateTimeType = "fixed" | "all_day" | "unspecified";

export type ParsedConstraintTargetType = "date" | "weekday" | "time" | "date_time";

export type ParsedConstraintPolarity = "positive" | "negative" | "neutral";

export type ParsedConstraintLevel = "hard_no" | "soft_no" | "unknown" | "conditional" | "soft_yes" | "strong_yes";

export type ParsedCommentConstraint = {
  targetType: ParsedConstraintTargetType;
  targetValue: string;
  polarity: ParsedConstraintPolarity;
  level: ParsedConstraintLevel;
  reasonText: string;
};

export type AutoInterpretationStatus = "success" | "failed" | "skipped";

export type AutoInterpretationRule = {
  targetTokenIndexes: number[];
  targetText: string;
  targetLabels: string[];
  targetNormalizedTexts: string[];
  availabilityTokenIndexes: number[];
  availabilityText: string;
  availabilityLabel: "availability_positive" | "availability_negative" | "availability_unknown";
  modifierTokenIndexes: number[];
  modifierTexts: string[];
  modifierLabels: string[];
  residualOfTokenIndexes: number[];
  exceptionTargetTokenIndexes: number[];
  contrastClauseTokenIndexes: number[];
  notes: string[];
  sourceComment: string;
};

export type AutoInterpretationResult = {
  status: AutoInterpretationStatus;
  sourceComment: string;
  rules: AutoInterpretationRule[];
  ambiguities: string[];
  failureReason: string | null;
  debugGraphJson?: string | null;
};

export type AvailabilityLevel = {
  key: string;
  label: string;
  weight: number;
  tone: AvailabilityTone;
  sortOrder: number;
};

export type TimeSlotOption = {
  key: string;
  label: string;
  description: string;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
};

export type EventRecord = {
  id: string;
  title: string;
  createdAt: string;
  defaultResultMode: ResultMode;
};

export type EventCandidateRecord = {
  id: string;
  eventId: string;
  date: string;
  timeSlotKey: string;
  selectionMode: CandidateSelectionMode;
  dateType: CandidateDateType;
  startDate: string;
  endDate: string;
  selectedDates: string[];
  timeType: CandidateTimeType;
  startTime: string | null;
  endTime: string | null;
  note: string | null;
  sortOrder: number;
};

export type ParticipantAnswerRecord = {
  candidateId: string;
  availabilityKey: string;
  selectedDates: string[];
  preferredTimeSlotKey: string | null;
  dateTimePreferences: Record<string, string>;
  availableStartTime: string | null;
  availableEndTime: string | null;
};

export type ParticipantResponseRecord = {
  id: string;
  eventId: string;
  participantName: string;
  note: string | null;
  parsedConstraints: ParsedCommentConstraint[];
  submittedAt: string;
  answers: ParticipantAnswerRecord[];
};

export type EventDetail = {
  event: EventRecord;
  candidates: EventCandidateRecord[];
  responses: ParticipantResponseRecord[];
};

export type EventSummary = {
  id: string;
  title: string;
  candidateCount: number;
  participantCount: number;
  createdAt: string;
};

export type CreateEventInput = {
  title: string;
  candidates: Array<{
    date: string;
    timeSlotKey: string;
    selectionMode: CandidateSelectionMode;
    dateType: CandidateDateType;
    startDate: string;
    endDate: string;
    selectedDates: string[];
    timeType: CandidateTimeType;
    startTime: string | null;
    endTime: string | null;
    note?: string | null;
  }>;
};

export type SubmitResponseInput = {
  participantName: string;
  note?: string | null;
  parsedConstraints?: ParsedCommentConstraint[];
  answers: Array<{
    candidateId: string;
    availabilityKey: string;
    selectedDates: string[];
    preferredTimeSlotKey: string | null;
    dateTimePreferences: Record<string, string>;
    availableStartTime: string | null;
    availableEndTime: string | null;
  }>;
};

export type RankedParticipantStatus = {
  participantName: string;
  availabilityKey: string;
  label: string;
  weight: number;
};

export type RankedCommentImpact = {
  participantName: string;
  label: string;
  reasonText: string;
  score: number;
  level: ParsedConstraintLevel;
};

export type RankedCandidate = {
  candidate: EventCandidateRecord;
  baseScore: number;
  commentScore: number;
  totalScore: number;
  yesCount: number;
  maybeCount: number;
  noCount: number;
  statusGroups: Record<string, string[]>;
  participantStatuses: RankedParticipantStatus[];
  commentImpacts: RankedCommentImpact[];
  hasHardNoConstraint?: boolean;
};

export type AdjustmentSuggestion = {
  candidateId: string;
  title: string;
  body: string;
};
