import type { CreateEventInput, EventDetail, EventRecord, EventSummary, ParticipantResponseRecord, RepositoryMode, SubmitResponseInput } from "./domain";
import { createEventMock, getEventDetailMock, listEventSummariesMock, saveParticipantResponseMock } from "./repository-mock";
import {
  createEventSupabase,
  getEventDetailSupabase,
  listEventSummariesSupabase,
  saveParticipantResponseSupabase,
} from "./repository-supabase";
import { hasSupabaseConfig } from "./supabase";

const repositoryMode: RepositoryMode = hasSupabaseConfig() ? "supabase" : "demo";

export function getRepositoryMode(): RepositoryMode {
  return repositoryMode;
}

export async function listEventSummaries(): Promise<EventSummary[]> {
  return repositoryMode === "supabase" ? listEventSummariesSupabase() : listEventSummariesMock();
}

export async function createEvent(input: CreateEventInput): Promise<EventRecord> {
  return repositoryMode === "supabase" ? createEventSupabase(input) : createEventMock(input);
}

export async function getEventDetail(eventId: string): Promise<EventDetail | null> {
  return repositoryMode === "supabase" ? getEventDetailSupabase(eventId) : getEventDetailMock(eventId);
}

export async function saveParticipantResponse(
  eventId: string,
  input: SubmitResponseInput,
): Promise<ParticipantResponseRecord> {
  return repositoryMode === "supabase" ? saveParticipantResponseSupabase(eventId, input) : saveParticipantResponseMock(eventId, input);
}
