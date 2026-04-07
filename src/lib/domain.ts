export type ResultMode = "strict_all" | "maximize_attendance";

export type AvailabilityTone = "yes" | "maybe" | "no";

export type RepositoryMode = "demo" | "supabase";

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
  note: string | null;
  sortOrder: number;
};

export type ParticipantAnswerRecord = {
  candidateId: string;
  availabilityKey: string;
};

export type ParticipantResponseRecord = {
  id: string;
  eventId: string;
  participantName: string;
  note: string | null;
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
    note?: string | null;
  }>;
};

export type SubmitResponseInput = {
  participantName: string;
  note?: string | null;
  answers: Array<{
    candidateId: string;
    availabilityKey: string;
  }>;
};

export type RankedParticipantStatus = {
  participantName: string;
  availabilityKey: string;
  label: string;
  weight: number;
};

export type RankedCandidate = {
  candidate: EventCandidateRecord;
  totalScore: number;
  yesCount: number;
  maybeCount: number;
  noCount: number;
  statusGroups: Record<string, string[]>;
  participantStatuses: RankedParticipantStatus[];
};

export type AdjustmentSuggestion = {
  candidateId: string;
  title: string;
  body: string;
};
