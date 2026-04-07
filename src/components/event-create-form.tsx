"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TIME_SLOT_OPTIONS, timeSlotLabelMap } from "@/lib/config";

type CandidateDraft = {
  id: string;
  date: string;
  timeSlotKey: string;
};

function buildDateString(offset: number) {
  const date = new Date();
  date.setDate(date.getDate() + offset);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function buildInitialCandidates(): CandidateDraft[] {
  return [
    { id: crypto.randomUUID(), date: buildDateString(7), timeSlotKey: "day" },
    { id: crypto.randomUUID(), date: buildDateString(7), timeSlotKey: "night" },
    { id: crypto.randomUUID(), date: buildDateString(8), timeSlotKey: "day" },
  ];
}

export function EventCreateForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [candidates, setCandidates] = useState<CandidateDraft[]>(() => buildInitialCandidates());
  const [feedback, setFeedback] = useState<{ tone: "error" | "success"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const isSubmittable = useMemo(
    () => title.trim().length > 0 && candidates.length > 0 && candidates.every((candidate) => candidate.date),
    [candidates, title],
  );

  function updateCandidate(id: string, patch: Partial<CandidateDraft>) {
    setCandidates((current) => current.map((candidate) => (candidate.id === id ? { ...candidate, ...patch } : candidate)));
  }

  function addCandidate() {
    setCandidates((current) => [
      ...current,
      { id: crypto.randomUUID(), date: buildDateString(9 + current.length), timeSlotKey: "night" },
    ]);
  }

  function removeCandidate(id: string) {
    setCandidates((current) => current.filter((candidate) => candidate.id !== id));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    if (!isSubmittable) {
      setFeedback({ tone: "error", message: "イベント名と候補日を入力してください。" });
      return;
    }

    const deduped = new Set<string>();
    for (const candidate of candidates) {
      const signature = `${candidate.date}:${candidate.timeSlotKey}`;
      if (deduped.has(signature)) {
        setFeedback({ tone: "error", message: "同じ日付と時間帯の候補が重複しています。" });
        return;
      }
      deduped.add(signature);
    }

    const response = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        candidates: candidates.map((candidate) => ({
          date: candidate.date,
          timeSlotKey: candidate.timeSlotKey,
        })),
      }),
    });

    const result = (await response.json()) as { event?: { id: string }; error?: string };

    if (!response.ok || !result.event) {
      setFeedback({ tone: "error", message: result.error ?? "イベントを作成できませんでした。" });
      return;
    }

    setFeedback({ tone: "success", message: "イベントを作成しました。主催者ページに移動します。" });
    startTransition(() => {
      router.push(`/events/${result.event?.id}/organizer`);
    });
  }

  return (
    <form className="form-grid" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="event-title">イベント名</label>
        <input
          className="input"
          id="event-title"
          maxLength={120}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="例: 4月ごはん会"
          value={title}
        />
      </div>

      <div className="candidate-form-list">
        {candidates.map((candidate, index) => (
          <div className="candidate-row" key={candidate.id}>
            <div className="field">
              <label htmlFor={`candidate-date-${candidate.id}`}>候補 {index + 1} 日付</label>
              <input
                className="input"
                id={`candidate-date-${candidate.id}`}
                onChange={(event) => updateCandidate(candidate.id, { date: event.target.value })}
                type="date"
                value={candidate.date}
              />
            </div>
            <div className="field">
              <label htmlFor={`candidate-slot-${candidate.id}`}>時間帯</label>
              <select
                className="select"
                id={`candidate-slot-${candidate.id}`}
                onChange={(event) => updateCandidate(candidate.id, { timeSlotKey: event.target.value })}
                value={candidate.timeSlotKey}
              >
                {TIME_SLOT_OPTIONS.map((slot) => (
                  <option key={slot.key} value={slot.key}>
                    {slot.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              className="button button--danger"
              disabled={candidates.length <= 1}
              onClick={() => removeCandidate(candidate.id)}
              type="button"
            >
              削除
            </button>
          </div>
        ))}
      </div>

      <div className="form-actions">
        <button className="button button--ghost" onClick={addCandidate} type="button">
          候補日を追加
        </button>
        <span className="helper-text">
          現在の候補:{" "}
          {candidates.map((candidate) => `${candidate.date} ${timeSlotLabelMap[candidate.timeSlotKey]}`).join(" / ")}
        </span>
      </div>

      {feedback ? (
        <div className="feedback" data-tone={feedback.tone}>
          {feedback.message}
        </div>
      ) : null}

      <button className="button button--primary button--block" disabled={!isSubmittable || isPending} type="submit">
        {isPending ? "作成中..." : "イベントを作成する"}
      </button>
    </form>
  );
}
