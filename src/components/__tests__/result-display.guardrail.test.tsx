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
import type { EventCandidateRecord, EventDetail, EventRecord, ParticipantResponseRecord } from "@/lib/domain";
import { makeDemoEventDetail, makeFlexibleEventDetail } from "@/test/fixtures";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
    React.createElement("a", { ...props, href }, children),
}));

function buildCandidate(overrides: Partial<EventCandidateRecord> = {}): EventCandidateRecord {
  return {
    id: "candidate",
    eventId: "custom-event",
    date: "2026-04-18",
    timeSlotKey: "day",
    selectionMode: "range",
    dateType: "single",
    startDate: "2026-04-18",
    endDate: "2026-04-18",
    selectedDates: [],
    timeType: "fixed",
    startTime: "12:00",
    endTime: "17:00",
    note: null,
    sortOrder: 10,
    ...overrides,
  };
}

function buildDetail({
  event,
  candidates,
  responses,
}: {
  event?: Partial<EventRecord>;
  candidates: EventCandidateRecord[];
  responses: ParticipantResponseRecord[];
}): EventDetail {
  return {
    event: {
      id: "custom-event",
      title: "custom-event",
      createdAt: "2026-04-07T00:00:00+09:00",
      defaultResultMode: "strict_all",
      ...event,
    },
    candidates,
    responses,
  };
}

describe("result display guardrails", () => {
  it("shows one AI recommendation first and no longer exposes the old result-mode tabs", () => {
    render(<OrganizerDashboard detail={makeDemoEventDetail()} repositoryMode="demo" />);

    expect(screen.getByText("AI Recommendation")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "回答一覧" })).toBeInTheDocument();
    expect(screen.getAllByText(/第一候補|最有力候補/u).length).toBeGreaterThan(0);
    expect(screen.queryByRole("tab", { name: "全員参加優先モード" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "できるだけ全員参加モード" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "候補一覧" })).not.toBeInTheDocument();
  });

  it("keeps secondary candidates behind a disclosure instead of leading with a ranking list", async () => {
    const user = userEvent.setup();
    render(<OrganizerDashboard detail={makeDemoEventDetail()} repositoryMode="demo" />);

    expect(screen.getByRole("heading", { name: "他の候補を見る" })).toBeInTheDocument();
    const disclosure = screen.getByText("代替候補を開く").closest("details");
    expect(disclosure).not.toBeNull();
    expect(disclosure).not.toHaveAttribute("open");

    await user.click(screen.getByText("代替候補を開く"));

    expect(disclosure).toHaveAttribute("open");
    expect(screen.getAllByRole("heading", { level: 3 }).length).toBeGreaterThan(0);
  });

  it("shows a confirmation prompt when the AI recommendation depends on an unresolved condition", () => {
    const april11 = buildCandidate({
      id: "candidate-11",
      date: "2026-04-11",
      startDate: "2026-04-11",
      endDate: "2026-04-11",
      timeSlotKey: "all_day",
      timeType: "all_day",
      startTime: null,
      endTime: null,
      sortOrder: 10,
    });

    const detail = buildDetail({
      candidates: [april11],
      responses: [
        {
          id: "response-conditional",
          eventId: "custom-event",
          participantName: "Aki",
          note: "みんなが行ける日がこの日しかないなら11なら行ける",
          parsedConstraints: [],
          autoInterpretation: {
            status: "success",
            sourceComment: "みんなが行ける日がこの日しかないなら11なら行ける",
            rules: [],
            resolvedCandidateStatuses: [],
            preferences: [],
            conditions: [
              {
                targetTokenIndexes: [0],
                targetText: "11",
                targetLabels: ["target_date"],
                targetNormalizedTexts: ["2026-04-11"],
                conditionTokenIndexes: [1],
                markerTokenIndexes: [1],
                supportingClauseIndexes: [0],
                kind: "outcome_condition",
                resolverType: "unique_unanimous_candidate",
                participantScope: "self_only",
                requiredAvailabilityLevels: ["strong_yes"],
                unresolvedBehavior: "blocked",
                resolvedAvailabilityLevel: "strong_yes",
                resolvedPreferenceLevel: null,
                threshold: null,
                sourceComment: "みんなが行ける日がこの日しかないなら11なら行ける",
                confidence: "high",
              },
            ],
            targetContexts: [],
            comparisonPreferenceSignals: [],
            ambiguities: [],
            failureReason: null,
          },
          submittedAt: "2026-04-07T09:00:00+09:00",
          answers: [],
        },
      ],
    });

    render(<OrganizerDashboard detail={detail} repositoryMode="demo" />);

    expect(screen.getByText("この確認ができれば、全員参加にかなり近づきます")).toBeInTheDocument();
    expect(screen.getByText("Akiさんに確認したいこと")).toBeInTheDocument();
    expect(screen.getAllByText(/みんなが行ける日がこの日しかないなら11なら行ける/u).length).toBeGreaterThan(0);
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

  it("keeps comment interpretation transparency available when AI scoring used parsed comments", async () => {
    const user = userEvent.setup();
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

    expect(screen.getByRole("heading", { name: "AI が見ていたコメント解釈" })).toBeInTheDocument();

    await user.click(screen.getByText("解釈の内訳を見る"));

    expect(
      screen.getAllByText((_, element) => (element?.textContent ?? "").includes("Aki 05/16 昼 → 条件付きで参加可能")).length,
    ).toBeGreaterThan(0);
  });

  it("shows auto-llm counts on the AI recommendation card from parsed constraints", () => {
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

    const recommendationPanel = screen.getByText("AI Recommendation").closest("section");
    expect(recommendationPanel).not.toBeNull();
    expect(within(recommendationPanel!).getByText("参加可能 1人")).toBeInTheDocument();
    expect(within(recommendationPanel!).getByText("条件付き 0人")).toBeInTheDocument();
    expect(within(recommendationPanel!).getByText("不明 0人")).toBeInTheDocument();
    expect(within(recommendationPanel!).getByText("不可 0人")).toBeInTheDocument();
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

    expect(screen.getAllByText((text) => /5\/12.*夜/u.test(text)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/5\/12.*5\/14/u)).not.toBeInTheDocument();
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

    expect(
      screen.queryByText("コメントは受け取りましたが自動解釈できなかったため、結果集計では全候補を微妙として扱っています。"),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("参加可能").length).toBeGreaterThan(0);
  });
});
