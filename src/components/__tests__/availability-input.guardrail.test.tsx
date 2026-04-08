/**
 * This test protects existing scheduling behavior. Do not weaken or rewrite it unless the product specification explicitly changes.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ParticipantForm } from "@/components/participant-form";
import { makeDemoEventDetail, makeFlexibleEventDetail } from "@/test/fixtures";

const routerRefreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: routerRefreshMock,
  }),
}));

function getCandidateCard(index: number) {
  return screen.getAllByRole("heading", { level: 3 })[index]?.closest("article");
}

describe("availability input guardrails", () => {
  it("keeps the existing fixed-time candidate flow interactive for single-day candidates", async () => {
    const user = userEvent.setup();
    render(<ParticipantForm detail={makeDemoEventDetail()} repositoryMode="demo" />);

    const headings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent ?? "");
    expect(headings).toHaveLength(4);
    expect(headings[0]).toMatch(/4\/18.*昼/u);
    expect(headings[1]).toMatch(/4\/18.*夜/u);

    const firstCandidate = getCandidateCard(0);
    const secondCandidate = getCandidateCard(1);

    expect(firstCandidate).not.toBeNull();
    expect(secondCandidate).not.toBeNull();

    await user.click(within(firstCandidate!).getByRole("button", { name: /行ける/u }));
    await user.click(within(secondCandidate!).getByRole("button", { name: /微妙/u }));

    expect(within(firstCandidate!).getByRole("button", { name: /行ける/u })).toHaveClass("is-selected");
    expect(within(secondCandidate!).getByRole("button", { name: /微妙/u })).toHaveClass("is-selected");
    expect(screen.getByText("未回答の候補: 2件")).toBeInTheDocument();

    await user.click(within(firstCandidate!).getByRole("button", { name: /無理/u }));

    expect(within(firstCandidate!).getByRole("button", { name: /無理/u })).toHaveClass("is-selected");
    expect(within(firstCandidate!).getByRole("button", { name: /行ける/u })).not.toHaveClass("is-selected");
  });

  it("keeps range, discrete, and unspecified-time candidates easy to fill in the participant UI", async () => {
    const user = userEvent.setup();
    render(<ParticipantForm detail={makeFlexibleEventDetail()} repositoryMode="demo" />);

    const headings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent ?? "");
    expect(headings[0]).toMatch(/5\/10.*朝/u);
    expect(headings[1]).toMatch(/5\/12.*5\/14.*一日中/u);
    expect(headings[2]).toMatch(/5\/16.*指定なし/u);
    expect(headings[3]).toMatch(/5\/20.*5\/22.*5\/24.*夜/u);

    const [fixedCard, rangeCard, unspecifiedCard, discreteCard] = [
      getCandidateCard(0),
      getCandidateCard(1),
      getCandidateCard(2),
      getCandidateCard(3),
    ];
    expect(fixedCard).not.toBeNull();
    expect(rangeCard).not.toBeNull();
    expect(unspecifiedCard).not.toBeNull();
    expect(discreteCard).not.toBeNull();
    expect(within(rangeCard!).getByRole("button", { name: "個別選択" })).toBeInTheDocument();
    expect(within(rangeCard!).getByRole("button", { name: "範囲選択" })).toBeInTheDocument();
    expect(rangeCard!.querySelector('input[type="date"]')).toBeNull();
    expect(within(rangeCard!).getByText("2026年5月")).toBeInTheDocument();

    await user.click(within(fixedCard!).getByRole("button", { name: /行ける/u }));

    await user.click(within(rangeCard!).getByRole("button", { name: /微妙/u }));
    await user.click(within(rangeCard!).getByRole("button", { name: "範囲選択" }));
    await user.click(within(rangeCard!).getByRole("button", { name: /5\/12/u }));
    await user.click(within(rangeCard!).getByRole("button", { name: /5\/13/u }));
    await user.click(within(rangeCard!).getByRole("button", { name: "個別選択" }));
    await user.click(within(rangeCard!).getByRole("button", { name: /5\/14/u }));

    await user.click(within(unspecifiedCard!).getByRole("button", { name: /行ける/u }));
    await user.click(within(unspecifiedCard!).getAllByRole("button", { name: "昼" })[0]);

    await user.click(within(discreteCard!).getByRole("button", { name: /行ける/u }));
    await user.click(within(discreteCard!).getByRole("button", { name: /5\/20/u }));
    await user.click(within(discreteCard!).getByRole("button", { name: /5\/24/u }));

    expect(screen.getByText("未回答の候補: 0件")).toBeInTheDocument();
    expect(within(rangeCard!).getAllByText(/5\/12/u).length).toBeGreaterThan(0);
    expect(within(rangeCard!).getAllByText(/5\/14/u).length).toBeGreaterThan(0);
    expect(within(unspecifiedCard!).getAllByText(/5\/16/u).length).toBeGreaterThan(0);
    expect(within(unspecifiedCard!).getByRole("button", { name: "昼" })).toHaveClass("is-selected");
  });

  it("keeps participant validation blocking missing per-date time selection for unspecified candidates", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ParticipantForm detail={makeFlexibleEventDetail()} repositoryMode="demo" />);

    await user.type(screen.getByLabelText("名前"), "田中");

    const [fixedCard, rangeCard, unspecifiedCard, discreteCard] = [
      getCandidateCard(0),
      getCandidateCard(1),
      getCandidateCard(2),
      getCandidateCard(3),
    ];

    await user.click(within(fixedCard!).getByRole("button", { name: /無理/u }));
    await user.click(within(rangeCard!).getByRole("button", { name: /無理/u }));
    await user.click(within(discreteCard!).getByRole("button", { name: /無理/u }));
    await user.click(within(unspecifiedCard!).getByRole("button", { name: /行ける/u }));
    await user.click(within(unspecifiedCard!).getByRole("button", { name: /5\/16/u }));

    await user.click(screen.getByRole("button", { name: "回答を送信する" }));

    expect(screen.getByText("時間指定なし候補では日付ごとの時間帯を選ぶか、開始時刻と終了時刻を正しく入力してください。")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the answer payload stable for existing fixed candidates while carrying new answer fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    const detail = makeDemoEventDetail();
    const user = userEvent.setup();
    render(<ParticipantForm detail={detail} repositoryMode="demo" />);

    await user.type(screen.getByLabelText("名前"), "田中");
    await user.type(screen.getByLabelText("メモ（任意）"), "夜は少し遅れるかも");

    const candidateCards = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.closest("article"));
    await user.click(within(candidateCards[0]!).getByRole("button", { name: /行ける/u }));
    await user.click(within(candidateCards[1]!).getByRole("button", { name: /微妙/u }));
    await user.click(within(candidateCards[2]!).getByRole("button", { name: /無理/u }));
    await user.click(within(candidateCards[3]!).getByRole("button", { name: /行ける/u }));

    expect(screen.getByText("未回答の候補: 0件")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "回答を送信する" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      participantName: string;
      note: string;
      answers: Array<{
        candidateId: string;
        availabilityKey: string;
        selectedDates: string[];
        preferredTimeSlotKey: string | null;
        dateTimePreferences: Record<string, string>;
        availableStartTime: string | null;
        availableEndTime: string | null;
      }>;
    };

    expect(url).toBe(`/api/events/${detail.event.id}/responses`);
    expect(body.participantName).toBe("田中");
    expect(body.note).toBe("夜は少し遅れるかも");
    expect(body.answers).toEqual([
      { candidateId: detail.candidates[0].id, availabilityKey: "yes", selectedDates: ["2026-04-18"], preferredTimeSlotKey: null, dateTimePreferences: {}, availableStartTime: null, availableEndTime: null },
      { candidateId: detail.candidates[1].id, availabilityKey: "maybe", selectedDates: ["2026-04-18"], preferredTimeSlotKey: null, dateTimePreferences: {}, availableStartTime: null, availableEndTime: null },
      { candidateId: detail.candidates[2].id, availabilityKey: "no", selectedDates: [], preferredTimeSlotKey: null, dateTimePreferences: {}, availableStartTime: null, availableEndTime: null },
      { candidateId: detail.candidates[3].id, availabilityKey: "yes", selectedDates: ["2026-04-20"], preferredTimeSlotKey: null, dateTimePreferences: {}, availableStartTime: null, availableEndTime: null },
    ]);

    expect(screen.getByText("回答を保存しました。同じ名前で再送すると上書きされます。")).toBeInTheDocument();
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
  });

  it("runs comment interpretation on save and shows the structured understanding without breaking the form flow", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        response: {
          parsedConstraints: [
            {
              targetType: "date",
              targetValue: "2026-04-18",
              polarity: "negative",
              level: "hard_no",
              reasonText: "18日は無理",
            },
            {
              targetType: "date_time",
              targetValue: "2026-04-19_night",
              polarity: "positive",
              level: "conditional",
              reasonText: "19日夜ならいける",
            },
          ],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const detail = makeDemoEventDetail();
    const user = userEvent.setup();
    render(<ParticipantForm detail={detail} repositoryMode="demo" />);

    await user.type(screen.getByLabelText("名前"), "田中");
    await user.type(screen.getByLabelText("メモ（任意）"), "18日は無理。19日夜ならいける");

    const candidateCards = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.closest("article"));
    await user.click(within(candidateCards[0]!).getByRole("button", { name: /無理/u }));
    await user.click(within(candidateCards[1]!).getByRole("button", { name: /行ける/u }));
    await user.click(within(candidateCards[2]!).getByRole("button", { name: /無理/u }));
    await user.click(within(candidateCards[3]!).getByRole("button", { name: /無理/u }));

    await user.click(screen.getByRole("button", { name: "回答を送信する" }));

    await waitFor(() => {
      expect(screen.getByText("以下のように解釈しました")).toBeInTheDocument();
    });

    expect(screen.getByText("04/18 → 参加不可")).toBeInTheDocument();
    expect(screen.getByText("04/19 夜 → 条件付きで参加可能")).toBeInTheDocument();
  });
});
