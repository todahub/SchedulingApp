/**
 * This test protects existing scheduling behavior. Do not weaken or rewrite it unless the product specification explicitly changes.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ParticipantForm } from "@/components/participant-form";
import { makeDemoEventDetail } from "@/test/fixtures";

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
  it("keeps each candidate row interactive so strength can differ by date and time slot", async () => {
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

  it("keeps required input validation in place before a participant can submit", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ParticipantForm detail={makeDemoEventDetail()} repositoryMode="demo" />);

    await user.click(screen.getByRole("button", { name: "回答を送信する" }));
    expect(screen.getByText("名前を入力してください。")).toBeInTheDocument();

    await user.type(screen.getByLabelText("名前"), "田中");
    await user.click(screen.getByRole("button", { name: "回答を送信する" }));

    expect(screen.getByText("すべての候補日に回答してください。")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the current answer payload and success flow stable after minimum valid input", async () => {
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
      answers: Array<{ candidateId: string; availabilityKey: string }>;
    };

    expect(url).toBe(`/api/events/${detail.event.id}/responses`);
    expect(body.participantName).toBe("田中");
    expect(body.note).toBe("夜は少し遅れるかも");
    expect(body.answers).toEqual([
      { candidateId: detail.candidates[0].id, availabilityKey: "yes" },
      { candidateId: detail.candidates[1].id, availabilityKey: "maybe" },
      { candidateId: detail.candidates[2].id, availabilityKey: "no" },
      { candidateId: detail.candidates[3].id, availabilityKey: "yes" },
    ]);

    expect(screen.getByText("回答を保存しました。同じ名前で再送すると上書きされます。")).toBeInTheDocument();
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
  });
});
