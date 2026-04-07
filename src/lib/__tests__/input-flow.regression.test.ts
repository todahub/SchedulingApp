/**
 * This test protects existing scheduling behavior. Do not weaken or rewrite it unless the product specification explicitly changes.
 */

import { describe, expect, it } from "vitest";
import { sortCandidatesByDate } from "@/lib/utils";
import { parseCreateEventPayload, parseSubmitResponsePayload } from "@/lib/validation";

describe("input flow regression", () => {
  it("keeps minimal event creation payloads valid and trims the event title", () => {
    expect(
      parseCreateEventPayload({
        title: "  4月ごはん会  ",
        candidates: [{ date: "2026-04-18", timeSlotKey: "night" }],
      }),
    ).toEqual({
      title: "4月ごはん会",
      candidates: [{ date: "2026-04-18", timeSlotKey: "night" }],
    });
  });

  it("keeps invalid event creation payloads blocked when title or time slot is broken", () => {
    expect(() =>
      parseCreateEventPayload({
        title: "",
        candidates: [{ date: "2026-04-18", timeSlotKey: "night" }],
      }),
    ).toThrow("イベント名を入力してください。");

    expect(() =>
      parseCreateEventPayload({
        title: "4月ごはん会",
        candidates: [{ date: "2026-04-18", timeSlotKey: "late-night" }],
      }),
    ).toThrow("候補 1 の時間帯が不正です。");
  });

  it("keeps submit payloads requiring one answer per candidate and trims participant fields", () => {
    expect(
      parseSubmitResponsePayload(
        {
          participantName: "  田中  ",
          note: "  夜だと少し遅れる  ",
          answers: [
            { candidateId: "cand-1", availabilityKey: "yes" },
            { candidateId: "cand-2", availabilityKey: "maybe" },
          ],
        },
        ["cand-1", "cand-2"],
      ),
    ).toEqual({
      participantName: "田中",
      note: "夜だと少し遅れる",
      answers: [
        { candidateId: "cand-1", availabilityKey: "yes" },
        { candidateId: "cand-2", availabilityKey: "maybe" },
      ],
    });
  });

  it("keeps incomplete and duplicated submit payloads rejected", () => {
    expect(() =>
      parseSubmitResponsePayload(
        {
          participantName: "田中",
          answers: [{ candidateId: "cand-1", availabilityKey: "yes" }],
        },
        ["cand-1", "cand-2"],
      ),
    ).toThrow("すべての候補日に回答してください。");

    expect(() =>
      parseSubmitResponsePayload(
        {
          participantName: "田中",
          answers: [
            { candidateId: "cand-1", availabilityKey: "yes" },
            { candidateId: "cand-1", availabilityKey: "maybe" },
          ],
        },
        ["cand-1", "cand-2"],
      ),
    ).toThrow("同じ候補日に対する回答が重複しています。");
  });

  it("keeps invalid availability values rejected", () => {
    expect(() =>
      parseSubmitResponsePayload(
        {
          participantName: "田中",
          answers: [{ candidateId: "cand-1", availabilityKey: "one-chance" }],
        },
        ["cand-1"],
      ),
    ).toThrow("参加可否の値が不正です。");
  });

  it("keeps candidate sorting stable by date and then by time slot order", () => {
    expect(
      sortCandidatesByDate([
        { id: "3", date: "2026-04-19", timeSlotKey: "all_day", sortOrder: 30 },
        { id: "2", date: "2026-04-18", timeSlotKey: "night", sortOrder: 20 },
        { id: "1", date: "2026-04-18", timeSlotKey: "day", sortOrder: 10 },
      ]),
    ).toEqual([
      { id: "1", date: "2026-04-18", timeSlotKey: "day", sortOrder: 10 },
      { id: "2", date: "2026-04-18", timeSlotKey: "night", sortOrder: 20 },
      { id: "3", date: "2026-04-19", timeSlotKey: "all_day", sortOrder: 30 },
    ]);
  });
});
