/**
 * This test protects existing scheduling behavior. Do not weaken or rewrite it unless the product specification explicitly changes.
 */

import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OrganizerDashboard } from "@/components/organizer-dashboard";
import { makeDemoEventDetail, makeFlexibleEventDetail } from "@/test/fixtures";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
    React.createElement("a", { ...props, href }, children),
}));

describe("result display guardrails", () => {
  it("keeps the default strict mode focused on candidates everyone can still attend", () => {
    render(<OrganizerDashboard detail={makeDemoEventDetail()} repositoryMode="demo" />);

    expect(screen.getByRole("tab", { name: "全員参加優先モード" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("最上位候補")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByText("Aki").length).toBeGreaterThan(0);

    const candidateHeadings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent ?? "");
    expect(candidateHeadings).toHaveLength(1);
    expect(candidateHeadings[0]).toMatch(/4\/18.*昼/u);
    expect(screen.getByText(/Soraさんの「微妙」を解消できると/u)).toBeInTheDocument();
  });

  it("keeps the maximize attendance mode sorted by fewer impossible votes and then by score", async () => {
    const user = userEvent.setup();
    render(<OrganizerDashboard detail={makeDemoEventDetail()} repositoryMode="demo" />);

    await user.click(screen.getByRole("tab", { name: "できるだけ全員参加モード" }));

    const candidateHeadings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent ?? "");
    expect(candidateHeadings).toHaveLength(4);
    expect(candidateHeadings[0]).toMatch(/4\/18.*昼/u);
    expect(candidateHeadings[1]).toMatch(/4\/19.*昼/u);
    expect(candidateHeadings[2]).toMatch(/4\/18.*夜/u);
    expect(candidateHeadings[3]).toMatch(/4\/20.*一日中/u);

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

    expect(screen.getByText(/選択日: 5\/12.*5\/14/u)).toBeInTheDocument();
    expect(screen.getByText(/日付ごとの時間帯: 5\/16.*昼/u)).toBeInTheDocument();
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
    expect(screen.getByText(/回答スコア 1\.0 \/ コメント補正 \+10 \/ 合計 11\.0/u)).toBeInTheDocument();
    expect(screen.getAllByText((_, element) => (element?.textContent ?? "").includes("Aki 05/16 昼 → 条件付きで参加可能 (+10)")).length).toBeGreaterThan(0);
    expect(screen.getAllByText((_, element) => (element?.textContent ?? "").includes("Aki 金曜 → できれば避けたい (-30)")).length).toBeGreaterThan(0);
  });
});
