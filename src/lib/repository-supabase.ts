import { DEFAULT_RESULT_MODE } from "./config";
import { createSupabaseAdminClient } from "./supabase";
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

function getClient() {
  const client = createSupabaseAdminClient();

  if (!client) {
    throw new Error("Supabase 環境変数が設定されていません。");
  }

  return client;
}

function mapEventRow(row: {
  id: string;
  title: string;
  created_at: string;
  default_result_mode: string | null;
}): EventRecord {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    defaultResultMode: (row.default_result_mode as EventRecord["defaultResultMode"]) ?? DEFAULT_RESULT_MODE,
  };
}

function mapCandidateRow(row: {
  id: string;
  event_id: string;
  date: string;
  time_slot_key: string;
  note: string | null;
  sort_order: number;
}): EventCandidateRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    date: row.date,
    timeSlotKey: row.time_slot_key,
    note: row.note,
    sortOrder: row.sort_order,
  };
}

function mapResponseRow(row: {
  id: string;
  event_id: string;
  participant_name: string;
  note: string | null;
  submitted_at: string;
  participant_candidate_answers?: Array<{
    candidate_id: string;
    availability_key: string;
  }>;
}): ParticipantResponseRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    participantName: row.participant_name,
    note: row.note,
    submittedAt: row.submitted_at,
    answers:
      row.participant_candidate_answers?.map((answer) => ({
        candidateId: answer.candidate_id,
        availabilityKey: answer.availability_key,
      })) ?? [],
  };
}

export async function listEventSummariesSupabase(): Promise<EventSummary[]> {
  const client = getClient();
  const { data: events, error } = await client.from("events").select("id,title,created_at").order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  if (!events || events.length === 0) {
    return [];
  }

  const eventIds = events.map((event) => event.id);

  const [{ data: candidates, error: candidateError }, { data: responses, error: responseError }] = await Promise.all([
    client.from("event_candidates").select("event_id,id").in("event_id", eventIds),
    client.from("participant_responses").select("event_id,id").in("event_id", eventIds),
  ]);

  if (candidateError) {
    throw new Error(candidateError.message);
  }

  if (responseError) {
    throw new Error(responseError.message);
  }

  return events.map((event) => ({
    id: event.id,
    title: event.title,
    createdAt: event.created_at,
    candidateCount: candidates?.filter((candidate) => candidate.event_id === event.id).length ?? 0,
    participantCount: responses?.filter((response) => response.event_id === event.id).length ?? 0,
  }));
}

export async function createEventSupabase(input: CreateEventInput): Promise<EventRecord> {
  const client = getClient();
  const { data: eventRow, error } = await client
    .from("events")
    .insert({ title: input.title.trim(), default_result_mode: DEFAULT_RESULT_MODE })
    .select("id,title,created_at,default_result_mode")
    .single();

  if (error || !eventRow) {
    throw new Error(error?.message ?? "イベントを作成できませんでした。");
  }

  const event = mapEventRow(eventRow);
  const orderedCandidates = sortCandidatesByDate(
    input.candidates.map((candidate, index) => ({
      date: candidate.date,
      timeSlotKey: candidate.timeSlotKey,
      note: candidate.note?.trim() || null,
      sortOrder: (index + 1) * 10,
    })),
  );
  const candidates = orderedCandidates.map((candidate) => ({
    event_id: event.id,
    date: candidate.date,
    time_slot_key: candidate.timeSlotKey,
    note: candidate.note,
    sort_order: candidate.sortOrder,
  }));

  const { error: candidateError } = await client.from("event_candidates").insert(candidates);

  if (candidateError) {
    throw new Error(candidateError.message);
  }

  return event;
}

export async function getEventDetailSupabase(eventId: string): Promise<EventDetail | null> {
  const client = getClient();
  const { data: eventRow, error: eventError } = await client
    .from("events")
    .select("id,title,created_at,default_result_mode")
    .eq("id", eventId)
    .maybeSingle();

  if (eventError) {
    throw new Error(eventError.message);
  }

  if (!eventRow) {
    return null;
  }

  const [{ data: candidateRows, error: candidateError }, { data: responseRows, error: responseError }] = await Promise.all([
    client
      .from("event_candidates")
      .select("id,event_id,date,time_slot_key,note,sort_order")
      .eq("event_id", eventId),
    client
      .from("participant_responses")
      .select(
        "id,event_id,participant_name,note,submitted_at,participant_candidate_answers(candidate_id,availability_key)",
      )
      .eq("event_id", eventId)
      .order("submitted_at", { ascending: true }),
  ]);

  if (candidateError) {
    throw new Error(candidateError.message);
  }

  if (responseError) {
    throw new Error(responseError.message);
  }

  return {
    event: mapEventRow(eventRow),
    candidates: sortCandidatesByDate((candidateRows ?? []).map(mapCandidateRow)),
    responses: (responseRows ?? []).map(mapResponseRow),
  };
}

export async function saveParticipantResponseSupabase(
  eventId: string,
  input: SubmitResponseInput,
): Promise<ParticipantResponseRecord> {
  const client = getClient();

  const { data: existingRow, error: existingError } = await client
    .from("participant_responses")
    .select("id")
    .eq("event_id", eventId)
    .eq("participant_name", input.participantName.trim())
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  let responseId = existingRow?.id;

  if (responseId) {
    const { error: updateError } = await client
      .from("participant_responses")
      .update({
        note: input.note?.trim() || null,
        submitted_at: new Date().toISOString(),
      })
      .eq("id", responseId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    const { error: deleteError } = await client
      .from("participant_candidate_answers")
      .delete()
      .eq("participant_response_id", responseId);

    if (deleteError) {
      throw new Error(deleteError.message);
    }
  } else {
    const { data: insertedRow, error: insertError } = await client
      .from("participant_responses")
      .insert({
        event_id: eventId,
        participant_name: input.participantName.trim(),
        note: input.note?.trim() || null,
      })
      .select("id")
      .single();

    if (insertError || !insertedRow) {
      throw new Error(insertError?.message ?? "回答を作成できませんでした。");
    }

    responseId = insertedRow.id;
  }

  const { error: answerError } = await client.from("participant_candidate_answers").insert(
    input.answers.map((answer) => ({
      participant_response_id: responseId,
      candidate_id: answer.candidateId,
      availability_key: answer.availabilityKey,
    })),
  );

  if (answerError) {
    throw new Error(answerError.message);
  }

  const { data: savedRow, error: savedError } = await client
    .from("participant_responses")
    .select(
      "id,event_id,participant_name,note,submitted_at,participant_candidate_answers(candidate_id,availability_key)",
    )
    .eq("id", responseId)
    .single();

  if (savedError || !savedRow) {
    throw new Error(savedError?.message ?? "保存した回答を取得できませんでした。");
  }

  return mapResponseRow(savedRow);
}
