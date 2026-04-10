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
    expect(screen.queryByRole("button", { name: "範囲選択" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "個別選択" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("コメント（任意）")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "コメントしたい日付を選ぶ" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /4\/18/u }).length).toBeGreaterThan(0);
  });

  it("shows a share prompt when the participant page is opened right after event creation", () => {
    render(<ParticipantForm detail={makeDemoEventDetail()} repositoryMode="demo" sharePromptPath="/events/demo-event/join" />);

    expect(screen.getByText("参加者ページを共有")).toBeInTheDocument();
    expect(screen.getByText("このURLを参加者に送ってください。")).toBeInTheDocument();
    expect(screen.getByText("/events/demo-event/join")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "URLをコピー" })).toBeInTheDocument();
  });

  it("inserts the clicked date into the comment while keeping submits comment-only", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        interpretation: {
          usedDefault: false,
          defaultReason: null,
        },
        autoInterpretation: null,
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

  it("keeps only one helper date selected at a time", async () => {
    const user = userEvent.setup();
    render(<ParticipantForm detail={makeFlexibleEventDetail()} repositoryMode="demo" />);

    const rangeHeading = screen.getByRole("heading", { level: 3, name: /5\/12.*一日中/u });
    const rangeCard = rangeHeading.closest("article");

    expect(rangeCard).not.toBeNull();

    if (!rangeCard) {
      throw new Error("candidate card not found");
    }

    await user.click(within(rangeCard).getByRole("button", { name: /5\/12/u }));
    await user.click(within(rangeCard).getByRole("button", { name: /5\/14/u }));

    expect(screen.getByText("コメント補助として選択中: 5/14(木)")).toBeInTheDocument();
    expect(screen.queryByText("コメント補助として選択中: 5/12(火), 5/14(木)")).not.toBeInTheDocument();
    expect(screen.getByLabelText("コメント（任意）")).toHaveValue("5/12は\n5/14は ");
  });

  it("keeps date-only helper input from becoming availability and falls back to the default interpretation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        interpretation: {
          usedDefault: true,
          defaultReason: "unparsed",
        },
        autoInterpretation: {
          status: "failed",
          sourceComment: "5/13は",
          rules: [],
          ambiguities: [],
          failureReason: "可否トークンが見つからず、自動解釈を開始できませんでした。",
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
      expect(screen.getByText("解釈結果")).toBeInTheDocument();
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { note: string; answers: unknown[] };

    expect(body.note).toBe("5/13は");
    expect(body.answers).toEqual([]);
    expect(screen.queryByText("以下のように解釈しました")).not.toBeInTheDocument();
    expect(screen.getByText("自動解釈できませんでした。")).toBeInTheDocument();
    expect(screen.getByText("安全に候補へ反映できなかったため、今回は全候補を参加可能として扱います。")).toBeInTheDocument();
  });

  it("shows the auto interpretation result when the comment is understood", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        interpretation: {
          usedDefault: false,
          defaultReason: null,
        },
        autoInterpretation: {
          status: "success",
          sourceComment: "4/18は 無理。4/19夜ならいける",
          rules: [
            {
              targetTokenIndexes: [0],
              targetText: "4/18",
              targetLabels: ["target_date"],
              targetNormalizedTexts: ["2026-04-18"],
              availabilityTokenIndexes: [2],
              availabilityText: "無理",
              availabilityLabel: "availability_negative",
              modifierTokenIndexes: [],
              modifierTexts: [],
              modifierLabels: [],
              residualOfTokenIndexes: [],
              exceptionTargetTokenIndexes: [],
              contrastClauseTokenIndexes: [],
              notes: [],
              sourceComment: "4/18は 無理。4/19夜ならいける",
            },
            {
              targetTokenIndexes: [4, 5],
              targetText: "4/19 / 夜",
              targetLabels: ["target_date", "target_time_of_day"],
              targetNormalizedTexts: ["2026-04-19", "night"],
              availabilityTokenIndexes: [7],
              availabilityText: "いける",
              availabilityLabel: "availability_positive",
              modifierTokenIndexes: [],
              modifierTexts: [],
              modifierLabels: [],
              residualOfTokenIndexes: [],
              exceptionTargetTokenIndexes: [],
              contrastClauseTokenIndexes: [],
              notes: [],
              sourceComment: "4/18は 無理。4/19夜ならいける",
            },
          ],
          ambiguities: [],
          failureReason: null,
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
      expect(screen.getByText("解釈結果")).toBeInTheDocument();
    });

    expect(screen.queryByText("以下のように解釈しました")).not.toBeInTheDocument();
    expect(screen.getByText("4/18")).toBeInTheDocument();
    expect(screen.getByText("可否: 無理")).toBeInTheDocument();
    expect(screen.getByText("4/19 / 夜")).toBeInTheDocument();
    expect(screen.getByText("可否: いける")).toBeInTheDocument();
  });

  it("keeps empty comments distinct from unparsed comments when default full participation is shown", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        interpretation: {
          usedDefault: true,
          defaultReason: "empty",
        },
        autoInterpretation: {
          status: "skipped",
          sourceComment: "",
          rules: [],
          ambiguities: [],
          failureReason: "コメント未入力のため自動解釈を実行しませんでした。",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ParticipantForm detail={makeFlexibleEventDetail()} repositoryMode="demo" />);

    await user.type(screen.getByLabelText("名前"), "田中");
    await user.click(screen.getByRole("button", { name: "回答を送信する" }));

    await waitFor(() => {
      expect(screen.getByText("コメント未入力のため、今回は全候補を参加可能として扱います。")).toBeInTheDocument();
    });
  });

  it("shows the interpretation result from the auto interpretation pipeline", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        interpretation: {
          usedDefault: false,
          defaultReason: "unparsed",
        },
        autoInterpretation: {
          status: "success",
          sourceComment: "5日はたぶんいける、6日は無理ではない",
          rules: [
            {
              targetTokenIndexes: [0],
              targetText: "5日",
              targetLabels: ["target_date"],
              targetNormalizedTexts: ["2026-05-05"],
              availabilityTokenIndexes: [4],
              availabilityText: "いける",
              availabilityLabel: "availability_positive",
              modifierTokenIndexes: [2, 3],
              modifierTexts: ["たぶん", "たぶん"],
              modifierLabels: ["emphasis_marker", "uncertainty_marker"],
              residualOfTokenIndexes: [],
              exceptionTargetTokenIndexes: [],
              contrastClauseTokenIndexes: [],
              notes: [],
              sourceComment: "5日はたぶんいける、6日は無理ではない",
            },
            {
              targetTokenIndexes: [6],
              targetText: "6日",
              targetLabels: ["target_date"],
              targetNormalizedTexts: ["2026-05-06"],
              availabilityTokenIndexes: [8],
              availabilityText: "無理ではない",
              availabilityLabel: "availability_positive",
              modifierTokenIndexes: [],
              modifierTexts: [],
              modifierLabels: [],
              residualOfTokenIndexes: [],
              exceptionTargetTokenIndexes: [],
              contrastClauseTokenIndexes: [],
              notes: [],
              sourceComment: "5日はたぶんいける、6日は無理ではない",
            },
          ],
          ambiguities: [],
          failureReason: null,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ParticipantForm detail={makeFlexibleEventDetail()} repositoryMode="demo" />);

    await user.type(screen.getByLabelText("名前"), "田中");
    await user.type(screen.getByLabelText("コメント（任意）"), "5日はたぶんいける、6日は無理ではない");
    await user.click(screen.getByRole("button", { name: "回答を送信する" }));

    await waitFor(() => {
      expect(screen.getByText("解釈結果")).toBeInTheDocument();
    });

    expect(screen.queryByText("以下のように解釈しました")).not.toBeInTheDocument();
    expect(screen.getByText("5日")).toBeInTheDocument();
    expect(screen.getByText("可否: たぶん いける")).toBeInTheDocument();
    expect(screen.getByText("6日")).toBeInTheDocument();
    expect(screen.getByText("可否: 無理ではない")).toBeInTheDocument();
  });

  it("shows a safe failure message when auto interpretation fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        interpretation: {
          usedDefault: true,
          defaultReason: "unparsed",
        },
        autoInterpretation: {
          status: "failed",
          sourceComment: "あとはいける",
          rules: [],
          ambiguities: [],
          failureReason: "安全に表示できる自動解釈ルールを作れませんでした。",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ParticipantForm detail={makeFlexibleEventDetail()} repositoryMode="demo" />);

    await user.type(screen.getByLabelText("名前"), "田中");
    await user.type(screen.getByLabelText("コメント（任意）"), "あとはいける");
    await user.click(screen.getByRole("button", { name: "回答を送信する" }));

    await waitFor(() => {
      expect(screen.getByText("解釈結果")).toBeInTheDocument();
    });

    expect(screen.getByText("自動解釈できませんでした。")).toBeInTheDocument();
    expect(screen.getByText("安全に表示できる自動解釈ルールを作れませんでした。")).toBeInTheDocument();
    expect(screen.getByText("安全に候補へ反映できなかったため、今回は全候補を参加可能として扱います。")).toBeInTheDocument();
  });
});
