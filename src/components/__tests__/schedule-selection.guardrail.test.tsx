/**
 * This test protects existing scheduling behavior. Do not weaken or rewrite it unless the product specification explicitly changes.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventCreateForm } from "@/components/event-create-form";

const routerPushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
}));

function getCandidateEditor(index: number) {
  return screen.getByText(`候補 ${index}`).closest(".candidate-editor");
}

describe("schedule selection guardrails", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T09:00:00+09:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    routerPushMock.mockReset();
  });

  it("keeps the top-page candidate selector as an always-visible inline calendar", () => {
    render(<EventCreateForm />);

    const firstEditor = getCandidateEditor(1);
    expect(firstEditor).not.toBeNull();

    expect(within(firstEditor!).getByRole("button", { name: "期間で聞く" })).toHaveAttribute("aria-pressed", "true");
    expect(firstEditor!.querySelector('input[type="date"]')).toBeNull();
    expect(within(firstEditor!).getAllByText("2026年5月").length).toBeGreaterThan(0);
    expect(within(firstEditor!).queryByText("2026年6月")).not.toBeInTheDocument();
    expect(within(firstEditor!).getByRole("button", { name: "前の月" })).toBeInTheDocument();
    expect(within(firstEditor!).getByRole("button", { name: "次の月" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "候補を追加" })).not.toBeInTheDocument();
  });

  it("keeps range selection interactive and allows reverse-order range clicks without breaking the preview", () => {
    render(<EventCreateForm />);

    const firstEditor = getCandidateEditor(1);
    expect(firstEditor).not.toBeNull();

    fireEvent.click(within(firstEditor!).getByRole("button", { name: /5\/25/u }));
    expect(within(firstEditor!).getByText(/開始日 2026-05-25 を選択中です/u)).toBeInTheDocument();

    fireEvent.click(within(firstEditor!).getByRole("button", { name: /5\/20/u }));
    fireEvent.change(within(firstEditor!).getByLabelText("聞きたい時間帯"), { target: { value: "night" } });

    expect(within(firstEditor!).getByText(/5\/20.*5\/25.*夜/u)).toBeInTheDocument();
  });

  it("keeps selected dates editable with inline range selection plus individual add and remove, then posts the exact set once", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        event: {
          id: "created-inline-calendar-event",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<EventCreateForm />);

    fireEvent.change(screen.getByLabelText("イベント名"), { target: { value: "カレンダーUI確認会" } });

    const firstEditor = getCandidateEditor(1);
    expect(firstEditor).not.toBeNull();

    fireEvent.click(within(firstEditor!).getByRole("button", { name: /5\/25/u }));
    fireEvent.click(within(firstEditor!).getByRole("button", { name: /5\/20/u }));

    fireEvent.click(within(firstEditor!).getByRole("button", { name: "個別に聞く" }));
    fireEvent.click(within(firstEditor!).getByRole("button", { name: /5\/27/u }));
    fireEvent.click(within(firstEditor!).getByRole("button", { name: /5\/22/u }));
    fireEvent.click(within(firstEditor!).getByRole("button", { name: /5\/27/u }));
    fireEvent.click(within(firstEditor!).getByRole("button", { name: /5\/27/u }));

    fireEvent.change(within(firstEditor!).getByLabelText("聞きたい時間帯"), { target: { value: "day" } });

    fireEvent.click(screen.getByRole("button", { name: "イベントを作成する" }));

    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const request = fetchMock.mock.calls[0];
    const body = JSON.parse(String(request[1]?.body)) as {
      title: string;
      candidates: Array<{
        selectionMode: string;
        dateType: string;
        startDate: string;
        endDate: string;
        selectedDates: string[];
        timeSlotKey: string;
      }>;
    };

    expect(body.title).toBe("カレンダーUI確認会");
    expect(body.candidates[0]).toMatchObject({
      selectionMode: "discrete",
      dateType: "range",
      startDate: "2026-05-20",
      endDate: "2026-05-27",
      selectedDates: ["2026-05-20", "2026-05-21", "2026-05-23", "2026-05-24", "2026-05-25", "2026-05-27"],
      timeSlotKey: "day",
    });
    expect(new Set(body.candidates[0].selectedDates).size).toBe(body.candidates[0].selectedDates.length);

    await vi.runAllTimersAsync();
    expect(routerPushMock).toHaveBeenCalledWith("/events/created-inline-calendar-event/join?created=1");
  });
});
