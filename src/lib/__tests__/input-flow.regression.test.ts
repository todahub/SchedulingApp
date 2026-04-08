/**
 * This test protects existing scheduling behavior. Do not weaken or rewrite it unless the product specification explicitly changes.
 */

import { describe, expect, it } from "vitest";
import type { EventCandidateRecord } from "@/lib/domain";
import { sortCandidatesByDate } from "@/lib/utils";
import { parseCreateEventPayload, parseSubmitResponsePayload } from "@/lib/validation";

const flexibleCandidates: EventCandidateRecord[] = [
  {
    id: "cand-1",
    eventId: "event-1",
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
    id: "cand-2",
    eventId: "event-1",
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
    id: "cand-3",
    eventId: "event-1",
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
    id: "cand-4",
    eventId: "event-1",
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
];

describe("input flow regression", () => {
  it("keeps legacy event creation payloads valid by normalizing them into the extended candidate structure", () => {
    expect(
      parseCreateEventPayload({
        title: "  4月ごはん会  ",
        candidates: [{ date: "2026-04-18", timeSlotKey: "night" }],
      }),
    ).toEqual({
      title: "4月ごはん会",
      candidates: [
        {
          date: "2026-04-18",
          timeSlotKey: "night",
          selectionMode: "range",
          dateType: "single",
          startDate: "2026-04-18",
          endDate: "2026-04-18",
          selectedDates: [],
          timeType: "fixed",
          startTime: "18:00",
          endTime: "22:00",
        },
      ],
    });
  });

  it("keeps range and discrete candidates valid when the new payload shape is used", () => {
    expect(
      parseCreateEventPayload({
        title: "拡張候補会",
        candidates: [
          {
            selectionMode: "range",
            startDate: "2026-05-10",
            endDate: "2026-05-14",
            timeSlotKey: "all_day",
          },
          {
            selectionMode: "discrete",
            selectedDates: ["2026-05-20", "2026-05-23", "2026-05-27"],
            timeSlotKey: "day",
          },
          {
            selectionMode: "range",
            startDate: "2026-05-16",
            endDate: "2026-05-16",
            timeSlotKey: "unspecified",
          },
        ],
      }),
    ).toEqual({
      title: "拡張候補会",
      candidates: [
        {
          date: "2026-05-10",
          timeSlotKey: "all_day",
          selectionMode: "range",
          dateType: "range",
          startDate: "2026-05-10",
          endDate: "2026-05-14",
          selectedDates: [],
          timeType: "all_day",
          startTime: null,
          endTime: null,
        },
        {
          date: "2026-05-20",
          timeSlotKey: "day",
          selectionMode: "discrete",
          dateType: "range",
          startDate: "2026-05-20",
          endDate: "2026-05-27",
          selectedDates: ["2026-05-20", "2026-05-23", "2026-05-27"],
          timeType: "fixed",
          startTime: "12:00",
          endTime: "17:00",
        },
        {
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
        },
      ],
    });
  });

  it("keeps invalid event creation payloads blocked for broken periods and empty discrete selections", () => {
    expect(() =>
      parseCreateEventPayload({
        title: "4月ごはん会",
        candidates: [
          {
            selectionMode: "range",
            startDate: "2026-05-12",
            endDate: "2026-05-10",
            timeSlotKey: "all_day",
          },
        ],
      }),
    ).toThrow("候補 1 は開始日を終了日より前にしてください。");

    expect(() =>
      parseCreateEventPayload({
        title: "4月ごはん会",
        candidates: [
          {
            selectionMode: "discrete",
            selectedDates: [],
            timeSlotKey: "day",
          },
        ],
      }),
    ).toThrow("候補 1 は日付を1日以上選択してください。");
  });

  it("keeps submit payloads requiring one answer per candidate and trims participant fields", () => {
    expect(
      parseSubmitResponsePayload(
        {
          participantName: "  田中  ",
          note: "  夜だと少し遅れる  ",
          answers: [
            { candidateId: "cand-1", availabilityKey: "yes", selectedDates: [], preferredTimeSlotKey: null, dateTimePreferences: {}, availableStartTime: null, availableEndTime: null },
            { candidateId: "cand-2", availabilityKey: "maybe", selectedDates: ["2026-05-12"], preferredTimeSlotKey: null, dateTimePreferences: {}, availableStartTime: null, availableEndTime: null },
            {
              candidateId: "cand-3",
              availabilityKey: "yes",
              selectedDates: ["2026-05-16"],
              preferredTimeSlotKey: null,
              dateTimePreferences: { "2026-05-16": "day" },
              availableStartTime: null,
              availableEndTime: null,
            },
            { candidateId: "cand-4", availabilityKey: "yes", selectedDates: ["2026-05-20", "2026-05-24"], preferredTimeSlotKey: null, dateTimePreferences: {}, availableStartTime: null, availableEndTime: null },
          ],
        },
        flexibleCandidates,
      ),
    ).toEqual({
      participantName: "田中",
      note: "夜だと少し遅れる",
      answers: [
        { candidateId: "cand-1", availabilityKey: "yes", selectedDates: [], preferredTimeSlotKey: null, dateTimePreferences: {}, availableStartTime: null, availableEndTime: null },
        { candidateId: "cand-2", availabilityKey: "maybe", selectedDates: ["2026-05-12"], preferredTimeSlotKey: null, dateTimePreferences: {}, availableStartTime: null, availableEndTime: null },
        {
          candidateId: "cand-3",
          availabilityKey: "yes",
          selectedDates: ["2026-05-16"],
          preferredTimeSlotKey: null,
          dateTimePreferences: { "2026-05-16": "day" },
          availableStartTime: null,
          availableEndTime: null,
        },
        { candidateId: "cand-4", availabilityKey: "yes", selectedDates: ["2026-05-20", "2026-05-24"], preferredTimeSlotKey: null, dateTimePreferences: {}, availableStartTime: null, availableEndTime: null },
      ],
    });
  });

  it("keeps incomplete and invalid multi-date or unspecified-time answers rejected", () => {
    expect(() =>
      parseSubmitResponsePayload(
        {
          participantName: "田中",
          answers: [
            { candidateId: "cand-1", availabilityKey: "yes", selectedDates: [], preferredTimeSlotKey: null, dateTimePreferences: {}, availableStartTime: null, availableEndTime: null },
            { candidateId: "cand-2", availabilityKey: "maybe", selectedDates: [], preferredTimeSlotKey: null, dateTimePreferences: {}, availableStartTime: null, availableEndTime: null },
            {
              candidateId: "cand-3",
              availabilityKey: "yes",
              selectedDates: ["2026-05-16"],
              preferredTimeSlotKey: null,
              dateTimePreferences: { "2026-05-16": "day" },
              availableStartTime: null,
              availableEndTime: null,
            },
            { candidateId: "cand-4", availabilityKey: "yes", selectedDates: ["2026-05-20"], preferredTimeSlotKey: null, dateTimePreferences: {}, availableStartTime: null, availableEndTime: null },
          ],
        },
        flexibleCandidates,
      ),
    ).toThrow("複数日候補では少なくとも1日選択してください。");

    expect(() =>
      parseSubmitResponsePayload(
        {
          participantName: "田中",
          answers: [
            { candidateId: "cand-1", availabilityKey: "yes", selectedDates: [], preferredTimeSlotKey: null, dateTimePreferences: {}, availableStartTime: null, availableEndTime: null },
            { candidateId: "cand-2", availabilityKey: "maybe", selectedDates: ["2026-05-12"], preferredTimeSlotKey: null, dateTimePreferences: {}, availableStartTime: null, availableEndTime: null },
            { candidateId: "cand-3", availabilityKey: "yes", selectedDates: ["2026-05-16"], preferredTimeSlotKey: null, dateTimePreferences: {}, availableStartTime: null, availableEndTime: null },
            { candidateId: "cand-4", availabilityKey: "yes", selectedDates: ["2026-05-20"], preferredTimeSlotKey: null, dateTimePreferences: {}, availableStartTime: null, availableEndTime: null },
          ],
        },
        flexibleCandidates,
      ),
    ).toThrow("時間指定なし候補では日付ごとの時間帯を選ぶか、開始時刻と終了時刻を正しく入力してください。");
  });

  it("keeps candidate sorting stable for range, discrete, and single candidates", () => {
    expect(
      sortCandidatesByDate([
        { id: "3", startDate: "2026-04-19", endDate: "2026-04-19", timeType: "all_day", timeSlotKey: "all_day", sortOrder: 30 },
        { id: "2", startDate: "2026-04-18", endDate: "2026-04-20", timeType: "all_day", timeSlotKey: "all_day", sortOrder: 20 },
        { id: "1", startDate: "2026-04-18", endDate: "2026-04-18", timeType: "fixed", timeSlotKey: "morning", startTime: "09:00", sortOrder: 10 },
      ]),
    ).toEqual([
      { id: "1", startDate: "2026-04-18", endDate: "2026-04-18", timeType: "fixed", timeSlotKey: "morning", startTime: "09:00", sortOrder: 10 },
      { id: "2", startDate: "2026-04-18", endDate: "2026-04-20", timeType: "all_day", timeSlotKey: "all_day", sortOrder: 20 },
      { id: "3", startDate: "2026-04-19", endDate: "2026-04-19", timeType: "all_day", timeSlotKey: "all_day", sortOrder: 30 },
    ]);
  });
});
