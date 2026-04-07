import { DEFAULT_RESULT_MODE } from "./config";
import type { EventCandidateRecord, EventRecord, ParticipantResponseRecord } from "./domain";

export const demoEvents: EventRecord[] = [
  {
    id: "demo-team-dinner",
    title: "4月チームごはん会",
    createdAt: "2026-04-06T12:30:00+09:00",
    defaultResultMode: DEFAULT_RESULT_MODE,
  },
  {
    id: "demo-retro-session",
    title: "春のふりかえり会",
    createdAt: "2026-04-05T19:00:00+09:00",
    defaultResultMode: DEFAULT_RESULT_MODE,
  },
];

export const demoCandidates: EventCandidateRecord[] = [
  {
    id: "cand-1",
    eventId: "demo-team-dinner",
    date: "2026-04-18",
    timeSlotKey: "day",
    note: null,
    sortOrder: 10,
  },
  {
    id: "cand-2",
    eventId: "demo-team-dinner",
    date: "2026-04-18",
    timeSlotKey: "night",
    note: null,
    sortOrder: 20,
  },
  {
    id: "cand-3",
    eventId: "demo-team-dinner",
    date: "2026-04-19",
    timeSlotKey: "day",
    note: null,
    sortOrder: 30,
  },
  {
    id: "cand-4",
    eventId: "demo-team-dinner",
    date: "2026-04-20",
    timeSlotKey: "all_day",
    note: null,
    sortOrder: 40,
  },
  {
    id: "cand-5",
    eventId: "demo-retro-session",
    date: "2026-04-22",
    timeSlotKey: "night",
    note: null,
    sortOrder: 10,
  },
  {
    id: "cand-6",
    eventId: "demo-retro-session",
    date: "2026-04-24",
    timeSlotKey: "day",
    note: null,
    sortOrder: 20,
  },
];

export const demoResponses: ParticipantResponseRecord[] = [
  {
    id: "resp-1",
    eventId: "demo-team-dinner",
    participantName: "Aki",
    note: "オールだと長めで少し厳しいです。",
    submittedAt: "2026-04-06T12:40:00+09:00",
    answers: [
      { candidateId: "cand-1", availabilityKey: "yes" },
      { candidateId: "cand-2", availabilityKey: "maybe" },
      { candidateId: "cand-3", availabilityKey: "yes" },
      { candidateId: "cand-4", availabilityKey: "no" },
    ],
  },
  {
    id: "resp-2",
    eventId: "demo-team-dinner",
    participantName: "Nao",
    note: null,
    submittedAt: "2026-04-06T12:41:00+09:00",
    answers: [
      { candidateId: "cand-1", availabilityKey: "yes" },
      { candidateId: "cand-2", availabilityKey: "yes" },
      { candidateId: "cand-3", availabilityKey: "maybe" },
      { candidateId: "cand-4", availabilityKey: "no" },
    ],
  },
  {
    id: "resp-3",
    eventId: "demo-team-dinner",
    participantName: "Sora",
    note: "夜は移動次第です。",
    submittedAt: "2026-04-06T12:42:00+09:00",
    answers: [
      { candidateId: "cand-1", availabilityKey: "maybe" },
      { candidateId: "cand-2", availabilityKey: "no" },
      { candidateId: "cand-3", availabilityKey: "yes" },
      { candidateId: "cand-4", availabilityKey: "maybe" },
    ],
  },
  {
    id: "resp-4",
    eventId: "demo-team-dinner",
    participantName: "Mina",
    note: null,
    submittedAt: "2026-04-06T12:44:00+09:00",
    answers: [
      { candidateId: "cand-1", availabilityKey: "yes" },
      { candidateId: "cand-2", availabilityKey: "maybe" },
      { candidateId: "cand-3", availabilityKey: "no" },
      { candidateId: "cand-4", availabilityKey: "yes" },
    ],
  },
];
