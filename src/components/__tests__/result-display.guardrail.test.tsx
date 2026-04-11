/**
 * This test protects existing scheduling behavior. Do not weaken or rewrite it unless the product specification explicitly changes.
 */

import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OrganizerDashboard } from "@/components/organizer-dashboard";
import {
  buildAutoInterpretationResult,
  buildAvailabilityInterpretationExecutionInput,
  buildDerivedResponseFromAvailabilityInterpretation,
} from "@/lib/availability-comment-interpretation";
import { makeDemoEventDetail, makeFlexibleEventDetail } from "@/test/fixtures";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
    React.createElement("a", { ...props, href }, children),
}));

describe("result display guardrails", () => {
  it("keeps the default strict mode focused on days everyone can definitely attend", () => {
    render(<OrganizerDashboard detail={makeDemoEventDetail()} repositoryMode="demo" />);

    expect(screen.getByRole("tab", { name: "全員参加優先モード" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("最上位候補")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByText("Aki").length).toBeGreaterThan(0);
    expect(screen.getByText("全員が参加可能な候補はまだありません。")).toBeInTheDocument();
    expect(screen.queryByText(/少し調整すると良くなりそうな候補/u)).not.toBeInTheDocument();
  });

  it("shows maximize attendance mode only for the top three ranks and keeps tie-style rank labels", async () => {
    const user = userEvent.setup();
    render(<OrganizerDashboard detail={makeDemoEventDetail()} repositoryMode="demo" />);

    await user.click(screen.getByRole("tab", { name: "できるだけ全員参加モード" }));

    const candidateHeadings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent ?? "");
    expect(candidateHeadings.length).toBeGreaterThanOrEqual(3);
    expect(candidateHeadings[0]).toMatch(/4\/18.*昼/u);
    expect(candidateHeadings[1]).toMatch(/4\/19.*昼/u);
    expect(candidateHeadings[2]).toMatch(/4\/18.*夜/u);
    expect(screen.getByText("1位")).toBeInTheDocument();
    expect(screen.getByText("2位")).toBeInTheDocument();
    expect(screen.getByText("3位")).toBeInTheDocument();
    expect(
      screen.getByText(
        "ラベル重みから計算したスコア順の上位3順位までを表示し、同率順位はまとめて表示しています。コメントで明示的に触れられた候補は、順位外でも確認できるように表示します。",
      ),
    ).toBeInTheDocument();
  });

  it("keeps candidate reasons and participant breakdown aligned with the chosen result mode", async () => {
    const user = userEvent.setup();
    render(<OrganizerDashboard detail={makeDemoEventDetail()} repositoryMode="demo" />);

    await user.click(screen.getByRole("tab", { name: "できるだけ全員参加モード" }));

    const rankedCandidatesSection = screen.getByRole("heading", { name: "候補一覧" }).closest("section");
    expect(rankedCandidatesSection).not.toBeNull();

    const candidateCards = within(rankedCandidatesSection!).getAllByRole("heading", { level: 3 }).map((heading) => heading.closest("article"));
    const secondCandidateCard = candidateCards[1];

    expect(secondCandidateCard).not.toBeNull();
    expect(within(secondCandidateCard!).getByText("無理")).toBeInTheDocument();
    expect(within(secondCandidateCard!).getByText("Sora")).toBeInTheDocument();
    expect(within(secondCandidateCard!).getByText("Mina")).toBeInTheDocument();
  });

  it("keeps participant answer details visible for range and unspecified-time candidates", () => {
    render(<OrganizerDashboard detail={makeFlexibleEventDetail()} repositoryMode="demo" />);

    expect(
      screen.getAllByText(
        (_, element) =>
          (element?.textContent ?? "").includes("選択日:") &&
          (element?.textContent ?? "").includes("5/12") &&
          (element?.textContent ?? "").includes("5/14"),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        (_, element) =>
          (element?.textContent ?? "").includes("日付ごとの時間帯:") &&
          (element?.textContent ?? "").includes("5/16") &&
          (element?.textContent ?? "").includes("昼"),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("keeps parsed comment interpretations visible in the organizer response table", () => {
    const detail = makeFlexibleEventDetail();
    detail.responses[0]!.parsedConstraints = [
      {
        targetType: "date_time",
        targetValue: "2026-05-16_day",
        polarity: "positive",
        level: "conditional",
        reasonText: "16日昼ならいける",
      },
    ];

    render(<OrganizerDashboard detail={detail} repositoryMode="demo" />);

    expect(screen.getByText("05/16 昼 → 条件付きで参加可能")).toBeInTheDocument();
  });

  it("shows how parsed comments affect each candidate score on the organizer page", () => {
    const detail = makeFlexibleEventDetail();
    detail.responses[0]!.parsedConstraints = [
      {
        targetType: "date_time",
        targetValue: "2026-05-16_day",
        polarity: "positive",
        level: "conditional",
        reasonText: "16日昼ならいける",
      },
      {
        targetType: "weekday",
        targetValue: "friday",
        polarity: "negative",
        level: "soft_no",
        reasonText: "金曜はできれば避けたい",
      },
    ];

    render(<OrganizerDashboard detail={detail} repositoryMode="demo" />);

    expect(screen.getByRole("heading", { name: "コメントの反映" })).toBeInTheDocument();
    expect(screen.queryByText(/回答スコア/u)).not.toBeInTheDocument();
    expect(screen.getAllByText((_, element) => (element?.textContent ?? "").includes("Aki 05/16 昼 → 条件付きで参加可能")).length).toBeGreaterThan(0);
    expect(screen.queryByText((_, element) => (element?.textContent ?? "").includes("Aki 金曜 → できれば避けたい (-30)"))).not.toBeInTheDocument();
  });

  it("shows auto-llm ranking counts from parsed constraints instead of default derived yes answers", async () => {
    const user = userEvent.setup();
    const detail = makeFlexibleEventDetail();
    detail.candidates = detail.candidates.slice(0, 2).map((candidate, index) => ({
      ...candidate,
      id: `auto-candidate-${index + 1}`,
      date: index === 0 ? "2026-05-10" : "2026-05-12",
      startDate: index === 0 ? "2026-05-10" : "2026-05-12",
      endDate: index === 0 ? "2026-05-10" : "2026-05-12",
      selectionMode: "range",
      dateType: "single",
      selectedDates: [],
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: (index + 1) * 10,
    }));
    const executionInput = buildAvailabilityInterpretationExecutionInput("10日はいける", detail.candidates);
    const derived = buildDerivedResponseFromAvailabilityInterpretation(
      executionInput,
      {
        links: [
          {
            relation: "applies_to",
            targetTokenIndexes: executionInput.grouping.targetGroups[0]!.tokenIndexes,
            availabilityTokenIndexes: executionInput.grouping.availabilityGroups[0]!.tokenIndexes,
            confidence: "high",
          },
        ],
      },
      detail.candidates,
    );

    detail.responses = [
      {
        id: "auto-response-1",
        eventId: detail.event.id,
        participantName: "Aki",
        note: "10日はいける",
        parsedConstraints: derived.parsedConstraints,
        submittedAt: "2026-04-07T13:00:00+09:00",
        answers: derived.answers,
      },
    ];

    render(<OrganizerDashboard detail={detail} repositoryMode="demo" />);

    await user.click(screen.getByRole("tab", { name: "できるだけ全員参加モード" }));

    const candidateHeadings = screen.getAllByRole("heading", { level: 3 });
    const headingTexts = candidateHeadings.map((heading) => heading.textContent ?? "");
    const candidateCards = candidateHeadings.map((heading) => heading.closest("article")).filter(Boolean);
    const explicitCard = candidateCards.find((card) => within(card as HTMLElement).queryByText("参加可能"));

    expect(explicitCard).toBeTruthy();
    expect(candidateHeadings).toHaveLength(2);
    expect(headingTexts.some((text) => /5\/10/u.test(text))).toBe(true);
    expect(headingTexts.some((text) => /5\/12/u.test(text))).toBe(true);
    expect(within(explicitCard as HTMLElement).getByText("参加可能")).toBeInTheDocument();
    expect(within(explicitCard as HTMLElement).getByText("参加可能 1人")).toBeInTheDocument();
    expect(within(explicitCard as HTMLElement).getByText("条件付き 0人")).toBeInTheDocument();
    expect(within(explicitCard as HTMLElement).getByText("不明 0人")).toBeInTheDocument();
    expect(within(explicitCard as HTMLElement).getByText("不可 0人")).toBeInTheDocument();
    expect(within(explicitCard as HTMLElement).getByText("合計スコア 3")).toBeInTheDocument();
    expect(within(explicitCard as HTMLElement).queryByText("この候補への明示ラベルがないため、結果集計では微妙として扱っています。")).not.toBeInTheDocument();
  });

  it("shows conditional, unknown, unavailable counts and total score on each ranked candidate card", async () => {
    const user = userEvent.setup();
    render(<OrganizerDashboard detail={makeDemoEventDetail()} repositoryMode="demo" />);

    await user.click(screen.getByRole("tab", { name: "できるだけ全員参加モード" }));

    const firstCard = screen.getAllByRole("heading", { level: 3 })[0]?.closest("article");
    expect(firstCard).not.toBeNull();
    expect(within(firstCard!).getByText(/条件付き \d+人/u)).toBeInTheDocument();
    expect(within(firstCard!).getByText(/不明 \d+人/u)).toBeInTheDocument();
    expect(within(firstCard!).getByText(/不可 \d+人/u)).toBeInTheDocument();
    expect(within(firstCard!).getByText(/合計スコア -?\d+/u)).toBeInTheDocument();
  });

  it("shows multi-day auto-llm results as concrete dates instead of one whole-period candidate", () => {
    const detail = makeFlexibleEventDetail();
    detail.candidates = [
      {
        id: "range-candidate",
        eventId: detail.event.id,
        date: "2026-05-12",
        timeSlotKey: "unspecified",
        selectionMode: "range",
        dateType: "range",
        startDate: "2026-05-12",
        endDate: "2026-05-14",
        selectedDates: [],
        timeType: "unspecified",
        startTime: null,
        endTime: null,
        note: null,
        sortOrder: 10,
      },
    ];
    const executionInput = buildAvailabilityInterpretationExecutionInput("12日の夜ならいける", detail.candidates);
    const derived = buildDerivedResponseFromAvailabilityInterpretation(
      executionInput,
      {
        links: [
          {
            relation: "applies_to",
            targetTokenIndexes: executionInput.grouping.targetGroups[0]!.tokenIndexes,
            availabilityTokenIndexes: executionInput.grouping.availabilityGroups[0]!.tokenIndexes,
            confidence: "high",
          },
        ],
      },
      detail.candidates,
    );

    detail.responses = [
      {
        id: "auto-response-range",
        eventId: detail.event.id,
        participantName: "Aki",
        note: "12日の夜ならいける",
        parsedConstraints: derived.parsedConstraints,
        submittedAt: "2026-04-07T13:00:00+09:00",
        answers: derived.answers,
      },
    ];

    render(<OrganizerDashboard detail={detail} repositoryMode="demo" />);

    const candidateHeadings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent ?? "");
    expect(candidateHeadings.some((heading) => /5\/12.*夜/u.test(heading))).toBe(true);
    expect(candidateHeadings.some((heading) => /5\/12.*5\/14/u.test(heading))).toBe(false);
  });

  it("does not show the unparsed-default warning when auto interpretation succeeded without parsed constraints", () => {
    const detail = makeFlexibleEventDetail();
    detail.candidates = detail.candidates.slice(0, 3).map((candidate, index) => ({
      ...candidate,
      id: `holiday-candidate-${index + 1}`,
      date: index === 0 ? "2026-04-12" : index === 1 ? "2026-04-19" : "2026-04-20",
      startDate: index === 0 ? "2026-04-12" : index === 1 ? "2026-04-19" : "2026-04-20",
      endDate: index === 0 ? "2026-04-12" : index === 1 ? "2026-04-19" : "2026-04-20",
      selectionMode: "range",
      dateType: "single",
      selectedDates: [],
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: (index + 1) * 10,
    }));

    const executionInput = buildAvailabilityInterpretationExecutionInput("休日行ける", detail.candidates);
    const builtAutoInterpretation = buildAutoInterpretationResult(
      executionInput,
      {
        links: [
          {
            relation: "applies_to",
            targetTokenIndexes: executionInput.grouping.targetGroups[0]!.tokenIndexes,
            availabilityTokenIndexes: executionInput.grouping.availabilityGroups[0]!.tokenIndexes,
            confidence: "high",
          },
        ],
      },
      detail.candidates,
    );
    const autoInterpretation = {
      ...builtAutoInterpretation,
      rules: [],
    };

    detail.responses = [
      {
        id: "holiday-response-1",
        eventId: detail.event.id,
        participantName: "Aki",
        note: "休日行ける",
        parsedConstraints: [],
        autoInterpretation,
        submittedAt: "2026-04-07T13:00:00+09:00",
        answers: [],
      },
    ];

    render(<OrganizerDashboard detail={detail} repositoryMode="demo" />);

    expect(screen.queryByText("コメントは受け取りましたが自動解釈できなかったため、結果集計では全候補を微妙として扱っています。")).not.toBeInTheDocument();
    expect(screen.getAllByText("参加可能").length).toBeGreaterThan(0);
  });

  it("keeps explicitly interpreted candidates visible even when maximize mode would otherwise hide them below the top three", async () => {
    const user = userEvent.setup();
    const detail = makeFlexibleEventDetail();
    detail.candidates = [
      {
        id: "candidate-april-day",
        eventId: detail.event.id,
        date: "2026-04-01",
        timeSlotKey: "day",
        selectionMode: "range",
        dateType: "range",
        startDate: "2026-04-01",
        endDate: "2026-04-05",
        selectedDates: [],
        timeType: "fixed",
        startTime: "12:00",
        endTime: "17:00",
        note: null,
        sortOrder: 10,
      },
    ];
    const executionInput = buildAvailabilityInterpretationExecutionInput("4/1夜なら行けるよ", detail.candidates);
    const targetTokenIndexes = executionInput.tokens
      .filter((token) => token.label === "target_date" || token.label === "target_time_of_day")
      .map((token) => token.index);
    const graph = {
      links: [
        {
          relation: "applies_to" as const,
          targetTokenIndexes,
          availabilityTokenIndexes: executionInput.grouping.availabilityGroups[0]!.tokenIndexes,
          confidence: "high" as const,
        },
      ],
    };
    const autoInterpretation = buildAutoInterpretationResult(executionInput, graph, detail.candidates);
    const derived = buildDerivedResponseFromAvailabilityInterpretation(executionInput, graph, detail.candidates);

    detail.responses = [
      {
        id: "response-explicit-time-mismatch",
        eventId: detail.event.id,
        participantName: "Aki",
        note: "4/1夜なら行けるよ",
        parsedConstraints: derived.parsedConstraints,
        autoInterpretation,
        submittedAt: "2026-04-07T13:00:00+09:00",
        answers: derived.answers,
      },
    ];

    render(<OrganizerDashboard detail={detail} repositoryMode="demo" />);

    await user.click(screen.getByRole("tab", { name: "できるだけ全員参加モード" }));

    expect(screen.getByRole("heading", { name: /4\/1.*昼/u })).toBeInTheDocument();
    const explicitCard = screen.getByRole("heading", { name: /4\/1.*昼/u }).closest("article");
    expect(explicitCard).not.toBeNull();
    expect(within(explicitCard!).getByText("無理")).toBeInTheDocument();
    expect(
      screen.getByText(
        "この候補はコメントで指定された別の時間帯なら参加可能と解釈されているため、結果集計では参加不可として扱っています。",
      ),
    ).toBeInTheDocument();
  });
});
