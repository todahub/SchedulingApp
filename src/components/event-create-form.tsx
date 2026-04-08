"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CANDIDATE_SELECTION_MODE_OPTIONS,
  CANDIDATE_TIME_PREFERENCE_OPTIONS,
} from "@/lib/config";
import type { CandidateSelectionMode, EventCandidateRecord } from "@/lib/domain";
import { InlineDateCalendar } from "@/components/inline-date-calendar";
import { formatCandidateLabel, formatCandidateTypeSummary, getTimeSlotByKey } from "@/lib/utils";
import { parseCreateEventPayload } from "@/lib/validation";

type CandidateDraft = {
  id: string;
  selectionMode: CandidateSelectionMode;
  selectedDates: string[];
  rangeAnchor: string | null;
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

function addDays(value: string, diff: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + diff);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getRangeDates(start: string, end: string) {
  const [from, to] = start <= end ? [start, end] : [end, start];
  const values: string[] = [];
  let current = from;

  while (current <= to) {
    values.push(current);
    current = addDays(current, 1);
  }

  return values;
}

function sortDateValues(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function isContiguousDates(values: string[]) {
  return values.every((value, index) => index === 0 || value === addDays(values[index - 1]!, 1));
}

function buildInitialCandidate(): CandidateDraft {
  return {
    id: crypto.randomUUID(),
    selectionMode: "range",
    selectedDates: [],
    rangeAnchor: null,
    timeSlotKey: "unspecified",
  };
}

function getCandidatePayloadDraft(candidate: CandidateDraft) {
  const selectedDates = sortDateValues(candidate.selectedDates);
  const startDate = selectedDates[0] ?? "";
  const endDate = selectedDates[selectedDates.length - 1] ?? "";
  const useRangeMode = candidate.selectionMode === "range" && selectedDates.length > 0 && isContiguousDates(selectedDates);

  return {
    selectionMode: useRangeMode ? "range" : "discrete",
    startDate: useRangeMode ? startDate : null,
    endDate: useRangeMode ? endDate : null,
    selectedDates: useRangeMode ? [] : selectedDates,
    timeSlotKey: candidate.timeSlotKey,
  } as const;
}

function buildPreviewCandidate(candidate: CandidateDraft, sortOrder: number): EventCandidateRecord {
  const slot = getTimeSlotByKey(candidate.timeSlotKey);
  const payloadDraft = getCandidatePayloadDraft(candidate);
  const selectedDates = sortDateValues(candidate.selectedDates);
  const startDate = selectedDates[0] ?? "";
  const endDate = selectedDates[selectedDates.length - 1] ?? startDate;
  const timeType = candidate.timeSlotKey === "all_day" ? "all_day" : candidate.timeSlotKey === "unspecified" ? "unspecified" : "fixed";

  return {
    id: candidate.id,
    eventId: "preview",
    date: startDate,
    timeSlotKey: candidate.timeSlotKey,
    selectionMode: payloadDraft.selectionMode,
    dateType: startDate && endDate && startDate !== endDate ? "range" : "single",
    startDate,
    endDate,
    selectedDates: payloadDraft.selectionMode === "discrete" ? selectedDates : [],
    timeType,
    startTime: timeType === "fixed" ? slot.startsAt : null,
    endTime: timeType === "fixed" ? slot.endsAt : null,
    note: null,
    sortOrder,
  };
}

export function EventCreateForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [candidates, setCandidates] = useState<CandidateDraft[]>(() => [buildInitialCandidate()]);
  const [feedback, setFeedback] = useState<{ tone: "error" | "success"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const isSubmittable = useMemo(
    () => title.trim().length > 0 && candidates.length > 0 && candidates.every((candidate) => candidate.selectedDates.length > 0),
    [candidates, title],
  );

  function updateCandidate(id: string, patch: Partial<CandidateDraft>) {
    setCandidates((current) => current.map((candidate) => (candidate.id === id ? { ...candidate, ...patch } : candidate)));
  }

  function addCandidate() {
    setCandidates((current) => [...current, buildInitialCandidate()]);
  }

  function removeCandidate(id: string) {
    setCandidates((current) => current.filter((candidate) => candidate.id !== id));
  }

  function selectCandidateDate(candidateId: string, date: string) {
    setCandidates((current) =>
      current.map((candidate) => {
        if (candidate.id !== candidateId) {
          return candidate;
        }

        if (candidate.selectionMode === "discrete") {
          const nextDates = candidate.selectedDates.includes(date)
            ? candidate.selectedDates.filter((value) => value !== date)
            : sortDateValues([...candidate.selectedDates, date]);

          return {
            ...candidate,
            selectedDates: nextDates,
            rangeAnchor: null,
          };
        }

        if (candidate.selectedDates.includes(date)) {
          return {
            ...candidate,
            selectedDates: candidate.selectedDates.filter((value) => value !== date),
            rangeAnchor: candidate.rangeAnchor === date ? null : candidate.rangeAnchor,
          };
        }

        if (!candidate.rangeAnchor) {
          return {
            ...candidate,
            rangeAnchor: date,
          };
        }

        return {
          ...candidate,
          selectedDates: sortDateValues([...candidate.selectedDates, ...getRangeDates(candidate.rangeAnchor, date)]),
          rangeAnchor: null,
        };
      }),
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    if (!isSubmittable) {
      setFeedback({ tone: "error", message: "イベント名と候補日を入力してください。" });
      return;
    }

    let normalizedPayload;

    try {
      normalizedPayload = parseCreateEventPayload({
        title,
        candidates: candidates.map((candidate) => getCandidatePayloadDraft(candidate)),
      });
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : "候補日の入力を確認してください。" });
      return;
    }

    const deduped = new Set<string>();
    for (const candidate of normalizedPayload.candidates) {
      const signature = [
        candidate.selectionMode,
        candidate.startDate,
        candidate.endDate,
        candidate.selectedDates.join(","),
        candidate.timeSlotKey,
      ].join(":");

      if (deduped.has(signature)) {
        setFeedback({ tone: "error", message: "同じ候補内容が重複しています。" });
        return;
      }
      deduped.add(signature);
    }

    const response = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalizedPayload),
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
          placeholder="例: 4月の遊ぶ日相談"
          value={title}
        />
      </div>

      <div className="candidate-form-list">
        {candidates.map((candidate, index) => {
          const previewCandidate = buildPreviewCandidate(candidate, (index + 1) * 10);
          const selectionModeDescription = CANDIDATE_SELECTION_MODE_OPTIONS.find(
            (option) => option.key === candidate.selectionMode,
          )?.description;
          const timeDescription = CANDIDATE_TIME_PREFERENCE_OPTIONS.find((option) => option.key === candidate.timeSlotKey)?.description;

          return (
            <div className="candidate-editor" key={candidate.id}>
              <div className="candidate-editor__header">
                <div>
                  <strong>{`候補 ${index + 1}`}</strong>
                  <p className="helper-text">
                    {previewCandidate.date
                      ? formatCandidateTypeSummary(previewCandidate)
                      : `${candidate.selectionMode === "range" ? "期間候補" : "個別日候補"} / ${getTimeSlotByKey(candidate.timeSlotKey).label}`}
                  </p>
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

              <div className="field">
                <span className="fieldset-label">候補の選び方</span>
                <div className="toggle-chip-row">
                  {CANDIDATE_SELECTION_MODE_OPTIONS.map((option) => (
                    <button
                      aria-pressed={candidate.selectionMode === option.key}
                      className={`option-chip ${candidate.selectionMode === option.key ? "is-selected" : ""}`}
                      key={option.key}
                      onClick={() =>
                        updateCandidate(candidate.id, {
                          selectionMode: option.key,
                          rangeAnchor: null,
                        })
                      }
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="helper-text">{selectionModeDescription}</p>
              </div>

              <div className="field">
                <div className="calendar-toolbar">
                  <span className="fieldset-label">{`候補 ${index + 1} 日付を選ぶ`}</span>
                  <span className="helper-text">{candidate.selectedDates.length > 0 ? `${candidate.selectedDates.length}日を選択中` : "未選択"}</span>
                </div>

                <InlineDateCalendar
                  initialMonth={candidate.selectedDates[0] ?? buildDateString(7)}
                  mode={candidate.selectionMode === "range" ? "range" : "single"}
                  onSelectDate={(date) => selectCandidateDate(candidate.id, date)}
                  rangeAnchor={candidate.rangeAnchor}
                  selectedDates={candidate.selectedDates}
                />

                <p className="helper-text">
                  {candidate.selectionMode === "range"
                    ? candidate.rangeAnchor
                      ? `開始日 ${candidate.rangeAnchor} を選択中です。次のクリックで範囲を追加できます。選択済み日を押すと個別に外せます。`
                      : "範囲選択モードです。1回目で開始日、2回目で終了日を選びます。"
                    : "個別選択モードです。日にちをクリックすると追加・解除できます。"}
                </p>
              </div>

              <div className="field">
                <label htmlFor={`candidate-time-slot-${candidate.id}`}>聞きたい時間帯</label>
                <select
                  className="select"
                  id={`candidate-time-slot-${candidate.id}`}
                  onChange={(event) => updateCandidate(candidate.id, { timeSlotKey: event.target.value })}
                  value={candidate.timeSlotKey}
                >
                  {CANDIDATE_TIME_PREFERENCE_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="helper-text">{timeDescription}</p>
              </div>

              {candidate.timeSlotKey === "unspecified" ? (
                <div className="info-note">指定なしを選ぶと、参加者は「昼なら行ける」などのざっくり時間帯で答えられます。</div>
              ) : null}

              {previewCandidate.date ? (
                <div className="pill-row">
                  <span className="pill">{formatCandidateLabel(previewCandidate)}</span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="toolbar">
        <button className="button button--secondary" onClick={addCandidate} type="button">
          候補を追加
        </button>
        <span className="helper-text">まずは1つの期間候補から始めて、必要なら追加するのがおすすめです。</span>
      </div>

      {feedback ? (
        <div className="feedback" data-tone={feedback.tone}>
          {feedback.message}
        </div>
      ) : null}

      <div className="form-actions">
        <span className="helper-text">候補 {candidates.length}件</span>
        <button className="button button--primary" disabled={!isSubmittable || isPending} type="submit">
          {isPending ? "作成中..." : "イベントを作成する"}
        </button>
      </div>
    </form>
  );
}
