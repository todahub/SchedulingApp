import type { CreateEventInput, EventDetail, EventRecord, EventSummary, ParticipantResponseRecord, RepositoryMode, SubmitResponseInput } from "./domain";
import { createEventMock, getEventDetailMock, listEventSummariesMock, saveParticipantResponseMock } from "./repository-mock";
import {
  createEventSupabase,
  getEventDetailSupabase,
  listEventSummariesSupabase,
  saveParticipantResponseSupabase,
} from "./repository-supabase";
import { resolveRepositoryMode } from "./runtime-environment";
import { hasSupabaseConfig } from "./supabase";

function getResolvedRepositoryMode(): RepositoryMode {
  return resolveRepositoryMode(hasSupabaseConfig());
}

export function getRepositoryMode(): RepositoryMode {
  return getResolvedRepositoryMode();
}

export async function listEventSummaries(): Promise<EventSummary[]> {
  const repositoryMode = getResolvedRepositoryMode();
  return repositoryMode === "supabase" ? listEventSummariesSupabase() : listEventSummariesMock();
}

export async function createEvent(input: CreateEventInput): Promise<EventRecord> {
  const repositoryMode = getResolvedRepositoryMode();
  return repositoryMode === "supabase" ? createEventSupabase(input) : createEventMock(input);
}

export async function getEventDetail(eventId: string): Promise<EventDetail | null> {
  const repositoryMode = getResolvedRepositoryMode();
  return repositoryMode === "supabase" ? getEventDetailSupabase(eventId) : getEventDetailMock(eventId);
}

export async function saveParticipantResponse(
  eventId: string,
  input: SubmitResponseInput,
): Promise<ParticipantResponseRecord> {
  const repositoryMode = getResolvedRepositoryMode();
  return repositoryMode === "supabase" ? saveParticipantResponseSupabase(eventId, input) : saveParticipantResponseMock(eventId, input);
}
