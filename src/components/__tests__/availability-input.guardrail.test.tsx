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

describe("availability input guardrails", () => {
  it("keeps the participant page readable while removing availability and time selection buttons", () => {
    render(<ParticipantForm detail={makeDemoEventDetail()} repositoryMode="demo" />);

    const headings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent ?? "");
    expect(headings).toHaveLength(4);
    expect(headings[0]).toMatch(/4\/18.*昼/u);
    expect(headings[1]).toMatch(/4\/18.*夜/u);

    expect(screen.queryByRole("button", { name: /行ける/u })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /微妙/u })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /無理/u })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "朝" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("コメント（任意）")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "コメントしたい日付を選ぶ" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /4\/18/u }).length).toBeGreaterThan(0);
  });

  it("inserts the clicked date into the comment while keeping submits comment-only", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        response: {
          parsedConstraints: [],
        },
        interpretation: {
          defaultReason: null,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const detail = makeFlexibleEventDetail();
    const user = userEvent.setup();
    render(<ParticipantForm detail={detail} repositoryMode="demo" />);

    const rangeHeading = screen.getByRole("heading", { level: 3, name: /5\/12.*一日中/u });
    const rangeCard = rangeHeading.closest("article");

    expect(rangeCard).not.toBeNull();

    if (!rangeCard) {
      throw new Error("candidate card not found");
    }

    await user.click(within(rangeCard).getByRole("button", { name: /5\/13/u }));

    await user.type(screen.getByLabelText("名前"), "田中");
    expect(screen.getByLabelText("コメント（任意）")).toHaveValue("5/13は ");
    await user.type(screen.getByLabelText("コメント（任意）"), "夜は少し遅れるかも");
    await user.click(screen.getByRole("button", { name: "回答を送信する" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      participantName: string;
      note: string;
      answers: unknown[];
    };

    expect(url).toBe(`/api/events/${detail.event.id}/responses`);
    expect(body.participantName).toBe("田中");
    expect(body.note).toBe("5/13は 夜は少し遅れるかも");
    expect(body.answers).toEqual([]);
    expect(screen.getByText("回答を保存しました。同じ名前で再送すると上書きされます。")).toBeInTheDocument();
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
  });

  it("does not duplicate the same date prefix when the same day is tapped again", async () => {
    const user = userEvent.setup();
    render(<ParticipantForm detail={makeFlexibleEventDetail()} repositoryMode="demo" />);

    const rangeHeading = screen.getByRole("heading", { level: 3, name: /5\/12.*一日中/u });
    const rangeCard = rangeHeading.closest("article");

    expect(rangeCard).not.toBeNull();

    if (!rangeCard) {
      throw new Error("candidate card not found");
    }

    const dayButton = within(rangeCard).getByRole("button", { name: /5\/13/u });

    await user.click(dayButton);
    await user.click(dayButton);

    expect(screen.getByLabelText("コメント（任意）")).toHaveValue("5/13は ");
  });

  it("keeps date-only helper input from becoming availability and falls back to the default interpretation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        response: {
          parsedConstraints: [],
        },
        interpretation: {
          defaultReason: "unparsed",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ParticipantForm detail={makeFlexibleEventDetail()} repositoryMode="demo" />);

    const rangeHeading = screen.getByRole("heading", { level: 3, name: /5\/12.*一日中/u });
    const rangeCard = rangeHeading.closest("article");

    expect(rangeCard).not.toBeNull();

    if (!rangeCard) {
      throw new Error("candidate card not found");
    }

    await user.click(within(rangeCard).getByRole("button", { name: /5\/13/u }));
    await user.type(screen.getByLabelText("名前"), "田中");
    await user.click(screen.getByRole("button", { name: "回答を送信する" }));

    await waitFor(() => {
      expect(screen.getByText("以下のように解釈しました")).toBeInTheDocument();
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { note: string; answers: unknown[] };

    expect(body.note).toBe("5/13は");
    expect(body.answers).toEqual([]);
    expect(screen.getByText("全日 → 参加可能（解釈できなかったためデフォルト）")).toBeInTheDocument();
  });

  it("prefers parsed comment results over the default interpretation when the comment is understood", async () => {
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
        interpretation: {
          defaultReason: null,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ParticipantForm detail={makeDemoEventDetail()} repositoryMode="demo" />);

    await user.type(screen.getByLabelText("名前"), "田中");
    const dayHeading = screen.getByRole("heading", { level: 3, name: /4\/18.*昼/u });
    const dayCard = dayHeading.closest("article");

    expect(dayCard).not.toBeNull();

    if (!dayCard) {
      throw new Error("candidate card not found");
    }

    await user.click(within(dayCard).getByRole("button", { name: /4\/18/u }));
    await waitFor(() => {
      expect(screen.getByLabelText("コメント（任意）")).toHaveValue("4/18は ");
    });
    await user.type(screen.getByLabelText("コメント（任意）"), "無理。4/19夜ならいける");
    await user.click(screen.getByRole("button", { name: "回答を送信する" }));

    await waitFor(() => {
      expect(screen.getByText("以下のように解釈しました")).toBeInTheDocument();
    });

    expect(screen.getByText("04/18 → 参加不可")).toBeInTheDocument();
    expect(screen.getByText("04/19 夜 → 条件付きで参加可能")).toBeInTheDocument();
  });

  it("keeps empty comments distinct from unparsed comments when default full participation is shown", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        response: {
          parsedConstraints: [],
        },
        interpretation: {
          defaultReason: "empty",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ParticipantForm detail={makeFlexibleEventDetail()} repositoryMode="demo" />);

    await user.type(screen.getByLabelText("名前"), "田中");
    await user.click(screen.getByRole("button", { name: "回答を送信する" }));

    await waitFor(() => {
      expect(screen.getByText("全日 → 参加可能（コメント未入力のためデフォルト）")).toBeInTheDocument();
    });
  });
});
