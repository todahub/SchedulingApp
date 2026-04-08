import { demoCandidates, demoEvents, demoResponses } from "@/lib/demo-data";
import type { EventDetail } from "@/lib/domain";
import { sortCandidatesByDate } from "@/lib/utils";

export function makeDemoEventDetail(eventId = "demo-team-dinner"): EventDetail {
  const event = demoEvents.find((item) => item.id === eventId);

  if (!event) {
    throw new Error(`Unknown demo event: ${eventId}`);
  }

  return {
    event: structuredClone(event),
    candidates: sortCandidatesByDate(demoCandidates.filter((candidate) => candidate.eventId === eventId)),
    responses: structuredClone(demoResponses.filter((response) => response.eventId === eventId)),
  };
}

export function makeFlexibleEventDetail(): EventDetail {
  return {
    event: {
      id: "flex-event",
      title: "拡張候補テストイベント",
      createdAt: "2026-04-07T12:00:00+09:00",
      defaultResultMode: "strict_all",
    },
    candidates: sortCandidatesByDate([
      {
        id: "flex-candidate-1",
        eventId: "flex-event",
        date: "2026-05-10",
        timeSlotKey: "morning",
        selectionMode: "range",
        dateType: "single",
        startDate: "2026-05-10",
        endDate: "2026-05-10",
        selectedDates: [],
        timeType: "fixed",
        startTime: "09:00",
        endTime: "12:00",
        note: null,
        sortOrder: 10,
      },
      {
        id: "flex-candidate-2",
        eventId: "flex-event",
        date: "2026-05-12",
        timeSlotKey: "all_day",
        selectionMode: "range",
        dateType: "range",
        startDate: "2026-05-12",
        endDate: "2026-05-14",
        selectedDates: [],
        timeType: "all_day",
        startTime: null,
        endTime: null,
        note: null,
        sortOrder: 20,
      },
      {
        id: "flex-candidate-3",
        eventId: "flex-event",
        date: "2026-05-16",
        timeSlotKey: "unspecified",
        selectionMode: "range",
        dateType: "single",
        startDate: "2026-05-16",
        endDate: "2026-05-16",
        selectedDates: [],
        timeType: "unspecified",
        startTime: null,
        endTime: null,
        note: null,
        sortOrder: 30,
      },
      {
        id: "flex-candidate-4",
        eventId: "flex-event",
        date: "2026-05-20",
        timeSlotKey: "night",
        selectionMode: "discrete",
        dateType: "range",
        startDate: "2026-05-20",
        endDate: "2026-05-24",
        selectedDates: ["2026-05-20", "2026-05-22", "2026-05-24"],
        timeType: "fixed",
        startTime: "18:00",
        endTime: "22:00",
        note: null,
        sortOrder: 40,
      },
    ]),
    responses: [
      {
        id: "flex-response-1",
        eventId: "flex-event",
        participantName: "Aki",
        note: "時間指定なし候補は午後なら調整しやすいです。",
        parsedConstraints: [],
        submittedAt: "2026-04-07T13:00:00+09:00",
        answers: [
          {
            candidateId: "flex-candidate-1",
            availabilityKey: "yes",
            selectedDates: [],
            preferredTimeSlotKey: null,
            dateTimePreferences: {},
            availableStartTime: null,
            availableEndTime: null,
          },
          {
            candidateId: "flex-candidate-2",
            availabilityKey: "maybe",
            selectedDates: ["2026-05-12", "2026-05-14"],
            preferredTimeSlotKey: null,
            dateTimePreferences: {},
            availableStartTime: null,
            availableEndTime: null,
          },
          {
            candidateId: "flex-candidate-3",
            availabilityKey: "yes",
            selectedDates: ["2026-05-16"],
            preferredTimeSlotKey: null,
            dateTimePreferences: {
              "2026-05-16": "day",
            },
            availableStartTime: null,
            availableEndTime: null,
          },
          {
            candidateId: "flex-candidate-4",
            availabilityKey: "yes",
            selectedDates: ["2026-05-20", "2026-05-24"],
            preferredTimeSlotKey: null,
            dateTimePreferences: {},
            availableStartTime: null,
            availableEndTime: null,
          },
        ],
      },
    ],
  };
}
