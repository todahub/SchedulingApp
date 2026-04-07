import { DEFAULT_RESULT_MODE } from "./config";
import { demoCandidates, demoEvents, demoResponses } from "./demo-data";
import type {
  CreateEventInput,
  EventCandidateRecord,
  EventDetail,
  EventRecord,
  EventSummary,
  ParticipantResponseRecord,
  SubmitResponseInput,
} from "./domain";
import { sortCandidatesByDate } from "./utils";

type MockStore = {
  events: EventRecord[];
  candidates: EventCandidateRecord[];
  responses: ParticipantResponseRecord[];
};

declare global {
  var __awaseSchedulerMockStore: MockStore | undefined;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function createInitialStore(): MockStore {
  return {
    events: clone(demoEvents),
    candidates: clone(demoCandidates),
    responses: clone(demoResponses),
  };
}

function getStore() {
  if (!globalThis.__awaseSchedulerMockStore) {
    globalThis.__awaseSchedulerMockStore = createInitialStore();
  }

  return globalThis.__awaseSchedulerMockStore;
}

export async function listEventSummariesMock(): Promise<EventSummary[]> {
  const store = getStore();

  return clone(
    store.events
      .map((event) => ({
        id: event.id,
        title: event.title,
        candidateCount: store.candidates.filter((candidate) => candidate.eventId === event.id).length,
        participantCount: store.responses.filter((response) => response.eventId === event.id).length,
        createdAt: event.createdAt,
      }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
  );
}

export async function createEventMock(input: CreateEventInput): Promise<EventRecord> {
  const store = getStore();
  const eventId = `event-${crypto.randomUUID().slice(0, 8)}`;

  const event: EventRecord = {
    id: eventId,
    title: input.title.trim(),
    createdAt: new Date().toISOString(),
    defaultResultMode: DEFAULT_RESULT_MODE,
  };

  const candidates: EventCandidateRecord[] = sortCandidatesByDate(
    input.candidates.map((candidate, index) => ({
      id: `candidate-${crypto.randomUUID().slice(0, 8)}`,
      eventId,
      date: candidate.date,
      timeSlotKey: candidate.timeSlotKey,
      note: candidate.note?.trim() || null,
      sortOrder: (index + 1) * 10,
    })),
  );

  store.events.unshift(event);
  store.candidates.push(...candidates);

  return clone(event);
}

export async function getEventDetailMock(eventId: string): Promise<EventDetail | null> {
  const store = getStore();
  const event = store.events.find((item) => item.id === eventId);

  if (!event) {
    return null;
  }

  const candidates = sortCandidatesByDate(store.candidates.filter((candidate) => candidate.eventId === eventId));
  const responses = clone(
    store.responses
      .filter((response) => response.eventId === eventId)
      .sort((left, right) => left.submittedAt.localeCompare(right.submittedAt)),
  );

  return {
    event: clone(event),
    candidates,
    responses,
  };
}

export async function saveParticipantResponseMock(
  eventId: string,
  input: SubmitResponseInput,
): Promise<ParticipantResponseRecord> {
  const store = getStore();
  const event = store.events.find((item) => item.id === eventId);

  if (!event) {
    throw new Error("イベントが見つかりません。");
  }

  const candidateIds = new Set(store.candidates.filter((candidate) => candidate.eventId === eventId).map((candidate) => candidate.id));

  const invalidAnswer = input.answers.find((answer) => !candidateIds.has(answer.candidateId));
  if (invalidAnswer) {
    throw new Error("存在しない候補日への回答が含まれています。");
  }

  const normalizedName = input.participantName.trim().toLowerCase();
  const existingIndex = store.responses.findIndex(
    (response) => response.eventId === eventId && response.participantName.trim().toLowerCase() === normalizedName,
  );

  const record: ParticipantResponseRecord = {
    id: existingIndex >= 0 ? store.responses[existingIndex].id : `response-${crypto.randomUUID().slice(0, 8)}`,
    eventId,
    participantName: input.participantName.trim(),
    note: input.note?.trim() || null,
    submittedAt: new Date().toISOString(),
    answers: clone(input.answers),
  };

  if (existingIndex >= 0) {
    store.responses.splice(existingIndex, 1, record);
  } else {
    store.responses.push(record);
  }

  return clone(record);
}
