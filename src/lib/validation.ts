import { AVAILABILITY_LEVELS, TIME_SLOT_OPTIONS } from "./config";
import type { CreateEventInput, SubmitResponseInput } from "./domain";

function isDateString(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function parseCreateEventPayload(payload: unknown): CreateEventInput {
  if (!payload || typeof payload !== "object") {
    throw new Error("イベント作成データが不正です。");
  }

  const title = "title" in payload && typeof payload.title === "string" ? payload.title.trim() : "";
  const candidates =
    "candidates" in payload && Array.isArray(payload.candidates)
      ? payload.candidates
      : [];

  if (!title) {
    throw new Error("イベント名を入力してください。");
  }

  if (title.length > 120) {
    throw new Error("イベント名は120文字以内で入力してください。");
  }

  if (candidates.length === 0) {
    throw new Error("候補日を1件以上追加してください。");
  }

  if (candidates.length > 30) {
    throw new Error("候補日は30件以内にしてください。");
  }

  const timeSlotKeys = new Set(TIME_SLOT_OPTIONS.map((slot) => slot.key));

  return {
    title,
    candidates: candidates.map((candidate, index) => {
      if (!candidate || typeof candidate !== "object") {
        throw new Error(`候補 ${index + 1} の形式が不正です。`);
      }

      const date = "date" in candidate && typeof candidate.date === "string" ? candidate.date : "";
      const timeSlotKey =
        "timeSlotKey" in candidate && typeof candidate.timeSlotKey === "string" ? candidate.timeSlotKey : "";

      if (!isDateString(date)) {
        throw new Error(`候補 ${index + 1} の日付が不正です。`);
      }

      if (!timeSlotKeys.has(timeSlotKey)) {
        throw new Error(`候補 ${index + 1} の時間帯が不正です。`);
      }

      return {
        date,
        timeSlotKey,
      };
    }),
  };
}

export function parseSubmitResponsePayload(payload: unknown, candidateIds: string[]): SubmitResponseInput {
  if (!payload || typeof payload !== "object") {
    throw new Error("回答データが不正です。");
  }

  const participantName =
    "participantName" in payload && typeof payload.participantName === "string" ? payload.participantName.trim() : "";
  const note = "note" in payload && typeof payload.note === "string" ? payload.note.trim() : "";
  const answers =
    "answers" in payload && Array.isArray(payload.answers)
      ? payload.answers
      : [];

  if (!participantName) {
    throw new Error("名前を入力してください。");
  }

  if (participantName.length > 48) {
    throw new Error("名前は48文字以内で入力してください。");
  }

  if (answers.length !== candidateIds.length) {
    throw new Error("すべての候補日に回答してください。");
  }

  const availabilityKeys = new Set(AVAILABILITY_LEVELS.map((level) => level.key));
  const candidateIdSet = new Set(candidateIds);
  const seenCandidateIds = new Set<string>();

  return {
    participantName,
    note,
    answers: answers.map((answer, index) => {
      if (!answer || typeof answer !== "object") {
        throw new Error(`回答 ${index + 1} の形式が不正です。`);
      }

      const candidateId =
        "candidateId" in answer && typeof answer.candidateId === "string" ? answer.candidateId : "";
      const availabilityKey =
        "availabilityKey" in answer && typeof answer.availabilityKey === "string" ? answer.availabilityKey : "";

      if (!candidateIdSet.has(candidateId)) {
        throw new Error("存在しない候補日が含まれています。");
      }

      if (seenCandidateIds.has(candidateId)) {
        throw new Error("同じ候補日に対する回答が重複しています。");
      }

      if (!availabilityKeys.has(availabilityKey)) {
        throw new Error("参加可否の値が不正です。");
      }

      seenCandidateIds.add(candidateId);

      return {
        candidateId,
        availabilityKey,
      };
    }),
  };
}
