/**
 * This test protects existing scheduling behavior. Do not weaken or rewrite it unless the product specification explicitly changes.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EventCreateForm } from "@/components/event-create-form";

const routerPushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
}));

describe("schedule selection guardrails", () => {
  it("keeps date candidates and time slot selection visible and updatable", async () => {
    render(<EventCreateForm />);

    const dateInputs = screen.getAllByLabelText(/候補 \d+ 日付/u);
    const timeSlotSelects = screen.getAllByLabelText("時間帯");

    expect(dateInputs).toHaveLength(3);
    expect(timeSlotSelects).toHaveLength(3);

    const firstSelect = timeSlotSelects[0] as HTMLSelectElement;
    expect(within(firstSelect).getByRole("option", { name: "昼" })).toBeInTheDocument();
    expect(within(firstSelect).getByRole("option", { name: "夜" })).toBeInTheDocument();
    expect(within(firstSelect).getByRole("option", { name: "オール" })).toBeInTheDocument();

    fireEvent.change(dateInputs[0], { target: { value: "2026-05-01" } });
    fireEvent.change(firstSelect, { target: { value: "night" } });

    expect(dateInputs[0]).toHaveValue("2026-05-01");
    expect(firstSelect).toHaveValue("night");
    expect(screen.getByText(/2026-05-01 夜/u)).toBeInTheDocument();

    fireEvent.change(dateInputs[0], { target: { value: "2026-05-02" } });
    fireEvent.change(firstSelect, { target: { value: "all_day" } });

    expect(dateInputs[0]).toHaveValue("2026-05-02");
    expect(firstSelect).toHaveValue("all_day");
    expect(screen.getByText(/2026-05-02 オール/u)).toBeInTheDocument();
    expect(screen.queryByText(/2026-05-01 夜/u)).not.toBeInTheDocument();
  });

  it("keeps the create flow blocked on duplicate date and time slot combinations", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<EventCreateForm />);

    fireEvent.change(screen.getByLabelText("イベント名"), { target: { value: "重複チェック会" } });

    const dateInputs = screen.getAllByLabelText(/候補 \d+ 日付/u);
    const timeSlotSelects = screen.getAllByLabelText("時間帯");

    fireEvent.change(dateInputs[0], { target: { value: "2026-05-10" } });
    fireEvent.change(timeSlotSelects[0], { target: { value: "night" } });
    fireEvent.change(dateInputs[1], { target: { value: "2026-05-10" } });
    fireEvent.change(timeSlotSelects[1], { target: { value: "night" } });

    fireEvent.click(screen.getByRole("button", { name: "イベントを作成する" }));

    expect(screen.getByText("同じ日付と時間帯の候補が重複しています。")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("keeps the minimum schedule input flow able to proceed to organizer view", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        event: {
          id: "created-event",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<EventCreateForm />);

    fireEvent.change(screen.getByLabelText("イベント名"), { target: { value: "4月MVP確認会" } });

    const dateInputs = screen.getAllByLabelText(/候補 \d+ 日付/u);
    const timeSlotSelects = screen.getAllByLabelText("時間帯");

    fireEvent.change(dateInputs[0], { target: { value: "2026-05-01" } });
    fireEvent.change(timeSlotSelects[0], { target: { value: "night" } });

    fireEvent.click(screen.getByRole("button", { name: "候補日を追加" }));
    expect(screen.getAllByLabelText(/候補 \d+ 日付/u)).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: "イベントを作成する" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const request = fetchMock.mock.calls[0];
    const body = JSON.parse(String(request[1]?.body)) as {
      title: string;
      candidates: Array<{ date: string; timeSlotKey: string }>;
    };

    expect(body.title).toBe("4月MVP確認会");
    expect(body.candidates[0]).toEqual({ date: "2026-05-01", timeSlotKey: "night" });

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith("/events/created-event/organizer");
    });
  });
});
