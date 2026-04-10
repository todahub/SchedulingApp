/**
 * This test protects existing scheduling behavior. Do not weaken or rewrite it unless the product specification explicitly changes.
 */

import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OrganizerDashboard } from "@/components/organizer-dashboard";
import {
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

  it("keeps the maximize attendance mode limited to full-attendance candidates and near misses", async () => {
    const user = userEvent.setup();
    render(<OrganizerDashboard detail={makeDemoEventDetail()} repositoryMode="demo" />);

    await user.click(screen.getByRole("tab", { name: "できるだけ全員参加モード" }));

    const candidateHeadings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent ?? "");
    expect(candidateHeadings).toHaveLength(3);
    expect(candidateHeadings[0]).toMatch(/4\/18.*昼/u);
    expect(candidateHeadings[1]).toMatch(/4\/19.*昼/u);
    expect(candidateHeadings[2]).toMatch(/4\/18.*夜/u);
    expect(candidateHeadings.some((heading) => /4\/20.*一日中/u.test(heading))).toBe(false);

    expect(screen.getByText(/4\/19.*はあと一歩/u)).toBeInTheDocument();
    expect(screen.getByText(/4\/18.*夜.*はあと一歩/u)).toBeInTheDocument();
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
    expect(within(secondCandidateCard!).getByText("無理 1人")).toBeInTheDocument();
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
    const firstCard = candidateHeadings[0]!.closest("article");

    expect(firstCard).not.toBeNull();
    expect(candidateHeadings).toHaveLength(1);
    expect(within(firstCard!).getByText("参加可能 1人")).toBeInTheDocument();
    expect(screen.queryByText("この候補への明示ラベルがないため、結果集計では微妙として扱っています。")).not.toBeInTheDocument();
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
});
