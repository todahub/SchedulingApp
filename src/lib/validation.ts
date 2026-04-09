import { AVAILABILITY_LEVELS, TIME_SLOT_OPTIONS } from "./config";
import type { CreateEventInput, EventCandidateRecord, SubmitResponseInput } from "./domain";
import {
  deriveTimeSlotKeyFromCandidate,
  getCandidateDateValues,
  getTimeSlotByKey,
  isDateString,
  isTimeRangeValid,
  isTimeString,
  normalizeCandidate,
} from "./utils";

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

      const legacyDate = "date" in candidate && typeof candidate.date === "string" ? candidate.date : "";
      const legacyTimeSlotKey = "timeSlotKey" in candidate && typeof candidate.timeSlotKey === "string" ? candidate.timeSlotKey : "";
      const selectionMode =
        "selectionMode" in candidate && (candidate.selectionMode === "range" || candidate.selectionMode === "discrete")
          ? candidate.selectionMode
          : "selectedDates" in candidate && Array.isArray(candidate.selectedDates) && candidate.selectedDates.length > 0
            ? "discrete"
            : "range";
      const rawSelectedDates: string[] =
        "selectedDates" in candidate && Array.isArray(candidate.selectedDates)
          ? candidate.selectedDates.filter((value: unknown): value is string => typeof value === "string")
          : [];
      const selectedDates: string[] = [...new Set(rawSelectedDates.filter((value) => isDateString(value)))].sort((left, right) =>
        left.localeCompare(right),
      );

      const rawStartDate =
        "startDate" in candidate && typeof candidate.startDate === "string" ? candidate.startDate : legacyDate;
      const rawEndDate =
        "endDate" in candidate && typeof candidate.endDate === "string" ? candidate.endDate : rawStartDate;

      const startDate = selectionMode === "discrete" ? selectedDates[0] ?? "" : rawStartDate;
      const endDate = selectionMode === "discrete" ? selectedDates[selectedDates.length - 1] ?? "" : rawEndDate;

      if (selectionMode === "discrete") {
        if (selectedDates.length === 0) {
          throw new Error(`候補 ${index + 1} は日付を1日以上選択してください。`);
        }
      } else {
        if (!isDateString(startDate)) {
          throw new Error(`候補 ${index + 1} の開始日が不正です。`);
        }

        if (!isDateString(endDate)) {
          throw new Error(`候補 ${index + 1} の終了日が不正です。`);
        }

        if (startDate > endDate) {
          throw new Error(`候補 ${index + 1} は開始日を終了日より前にしてください。`);
        }
      }

      const explicitTimeSlotKey = "timeSlotKey" in candidate && typeof candidate.timeSlotKey === "string" ? candidate.timeSlotKey : "";
      const rawTimeType =
        "timeType" in candidate && (candidate.timeType === "fixed" || candidate.timeType === "all_day" || candidate.timeType === "unspecified")
          ? candidate.timeType
          : legacyTimeSlotKey === "all_day"
            ? "all_day"
            : legacyTimeSlotKey === "unspecified"
              ? "unspecified"
              : "fixed";
      const fallbackStartTime =
        "startTime" in candidate && typeof candidate.startTime === "string" ? candidate.startTime : null;
      const fallbackEndTime =
        "endTime" in candidate && typeof candidate.endTime === "string" ? candidate.endTime : null;
      const derivedTimeSlotKey =
        explicitTimeSlotKey ||
        legacyTimeSlotKey ||
        deriveTimeSlotKeyFromCandidate({
          timeType: rawTimeType,
          startTime: rawTimeType === "fixed" ? fallbackStartTime : null,
          endTime: rawTimeType === "fixed" ? fallbackEndTime : null,
        });

      if (!timeSlotKeys.has(derivedTimeSlotKey)) {
        throw new Error(`候補 ${index + 1} の時間帯が不正です。`);
      }

      const slot = getTimeSlotByKey(derivedTimeSlotKey);
      const timeType =
        derivedTimeSlotKey === "all_day" ? "all_day" : derivedTimeSlotKey === "unspecified" ? "unspecified" : "fixed";
      const startTime =
        derivedTimeSlotKey === "custom"
          ? fallbackStartTime
          : timeType === "fixed"
            ? slot.startsAt
            : null;
      const endTime =
        derivedTimeSlotKey === "custom"
          ? fallbackEndTime
          : timeType === "fixed"
            ? slot.endsAt
            : null;

      if (derivedTimeSlotKey === "custom" && !isTimeRangeValid(startTime, endTime)) {
        throw new Error(`候補 ${index + 1} の開始時刻と終了時刻を正しく入力してください。`);
      }

      if ((timeType === "all_day" || timeType === "unspecified") && ((startTime && isTimeString(startTime)) || (endTime && isTimeString(endTime)))) {
        throw new Error(`候補 ${index + 1} の時間入力は不要です。`);
      }

      const dateType =
        "dateType" in candidate && (candidate.dateType === "single" || candidate.dateType === "range")
          ? candidate.dateType
          : startDate === endDate && selectedDates.length <= 1
            ? "single"
            : "range";

      return {
        date: startDate,
        timeSlotKey: derivedTimeSlotKey,
        selectionMode,
        dateType: selectionMode === "discrete" ? (selectedDates.length > 1 ? "range" : "single") : dateType,
        startDate,
        endDate: selectionMode === "discrete" ? endDate : dateType === "single" ? startDate : endDate,
        selectedDates: selectionMode === "discrete" ? selectedDates : [],
        timeType,
        startTime,
        endTime,
      };
    }),
  };
}

export function parseSubmitResponsePayload(payload: unknown, candidates: EventCandidateRecord[] | string[]): SubmitResponseInput {
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

  if (answers.length === 0) {
    return {
      participantName,
      note,
      answers: [],
    };
  }

  if (answers.length !== candidates.length) {
    throw new Error("すべての候補日に回答してください。");
  }

  const availabilityKeys = new Set(AVAILABILITY_LEVELS.map((level) => level.key));
  const answerTimeSlotKeys = new Set(TIME_SLOT_OPTIONS.filter((slot) => slot.key !== "custom").map((slot) => slot.key));
  const candidateRecords = new Map(
    candidates.map((candidate) =>
      typeof candidate === "string"
        ? [candidate, null]
        : [candidate.id, normalizeCandidate(candidate)],
    ),
  );
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
      const selectedDates =
        "selectedDates" in answer && Array.isArray(answer.selectedDates)
          ? answer.selectedDates.filter((value: unknown): value is string => typeof value === "string")
          : [];
      const preferredTimeSlotKey =
        "preferredTimeSlotKey" in answer && typeof answer.preferredTimeSlotKey === "string"
          ? answer.preferredTimeSlotKey
          : "timeSlotKey" in answer && typeof answer.timeSlotKey === "string"
            ? answer.timeSlotKey
            : null;
      const dateTimePreferences: Record<string, string> =
        "dateTimePreferences" in answer && answer.dateTimePreferences && typeof answer.dateTimePreferences === "object"
          ? (Object.fromEntries(
              Object.entries(answer.dateTimePreferences).filter(
                ([date, key]) => isDateString(date) && typeof key === "string" && key.length > 0,
              ),
            ) as Record<string, string>)
          : {};
      const availableStartTime =
        "availableStartTime" in answer && typeof answer.availableStartTime === "string" ? answer.availableStartTime : null;
      const availableEndTime =
        "availableEndTime" in answer && typeof answer.availableEndTime === "string" ? answer.availableEndTime : null;

      if (!candidateRecords.has(candidateId)) {
        throw new Error("存在しない候補日が含まれています。");
      }

      if (seenCandidateIds.has(candidateId)) {
        throw new Error("同じ候補日に対する回答が重複しています。");
      }

      if (!availabilityKeys.has(availabilityKey)) {
        throw new Error("参加可否の値が不正です。");
      }

      const candidateRecord = candidateRecords.get(candidateId);

      if (candidateRecord) {
        const allowedDates = new Set(getCandidateDateValues(candidateRecord));

        if (selectedDates.some((date: string) => !isDateString(date) || !allowedDates.has(date))) {
          throw new Error("候補期間に含まれない日付が選択されています。");
        }

        if (availabilityKey !== "no" && getCandidateDateValues(candidateRecord).length > 1 && selectedDates.length === 0) {
          throw new Error("複数日候補では少なくとも1日選択してください。");
        }

        if (candidateRecord.timeType === "unspecified") {
          if (availabilityKey === "no") {
            if (preferredTimeSlotKey || Object.keys(dateTimePreferences).length > 0 || availableStartTime || availableEndTime) {
              throw new Error("参加不可の候補には時間帯を入力できません。");
            }
          } else {
            const hasRoughSlot = Boolean(preferredTimeSlotKey && answerTimeSlotKeys.has(preferredTimeSlotKey));
            const hasDetailedTime = isTimeRangeValid(availableStartTime, availableEndTime);
            const requiredDates = selectedDates.length > 0 ? selectedDates : getCandidateDateValues(candidateRecord).slice(0, 1);
            const hasPerDateSlots =
              requiredDates.length > 0 &&
              requiredDates.every((date: string) => {
                const key = dateTimePreferences[date];
                return typeof key === "string" && answerTimeSlotKeys.has(key);
              });

            if (preferredTimeSlotKey && !answerTimeSlotKeys.has(preferredTimeSlotKey)) {
              throw new Error("希望時間帯の値が不正です。");
            }

            if (
              Object.entries(dateTimePreferences).some(
                ([date, key]) => !requiredDates.includes(date) || !answerTimeSlotKeys.has(key),
              )
            ) {
              throw new Error("日付ごとの時間帯に不正な値が含まれています。");
            }

            if (!hasPerDateSlots && !hasRoughSlot && !hasDetailedTime) {
              throw new Error("時間指定なし候補では日付ごとの時間帯を選ぶか、開始時刻と終了時刻を正しく入力してください。");
            }
          }
        }
      }

      seenCandidateIds.add(candidateId);

      return {
        candidateId,
        availabilityKey,
        selectedDates,
        preferredTimeSlotKey,
        dateTimePreferences,
        availableStartTime,
        availableEndTime,
      };
    }),
  };
}
