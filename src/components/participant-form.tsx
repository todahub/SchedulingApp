"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { InlineDateCalendar } from "@/components/inline-date-calendar";
import { formatParsedConstraintLabel } from "@/lib/comment-parser";
import { AVAILABILITY_LEVELS, CANDIDATE_TIME_PREFERENCE_OPTIONS } from "@/lib/config";
import type { EventDetail, ParsedCommentConstraint, ParticipantAnswerRecord, RepositoryMode } from "@/lib/domain";
import {
  formatCandidateLabel,
  formatCandidateTypeSummary,
  formatDate,
  getCandidateDateValues,
  getTimeSlotByKey,
  isAnswerComplete,
  normalizeCandidate,
} from "@/lib/utils";
import { parseSubmitResponsePayload } from "@/lib/validation";

type ParticipantFormProps = {
  detail: EventDetail;
  repositoryMode: RepositoryMode;
};

type AnswerDraft = ParticipantAnswerRecord;
type CalendarPickMode = "single" | "range";

type CalendarDraft = {
  mode: CalendarPickMode;
  rangeAnchor: string | null;
};

function buildEmptyAnswer(candidateId: string): AnswerDraft {
  return {
    candidateId,
    availabilityKey: "",
    selectedDates: [],
    preferredTimeSlotKey: null,
    dateTimePreferences: {},
    availableStartTime: null,
    availableEndTime: null,
  };
}

function buildEmptyCalendarDraft(): CalendarDraft {
  return {
    mode: "single",
    rangeAnchor: null,
  };
}

function sortDateValues(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function getRangeDates(allowedDates: string[], start: string, end: string) {
  const [from, to] = start <= end ? [start, end] : [end, start];
  return allowedDates.filter((date) => from <= date && date <= to);
}

export function ParticipantForm({ detail, repositoryMode }: ParticipantFormProps) {
  const router = useRouter();
  const [participantName, setParticipantName] = useState("");
  const [note, setNote] = useState("");
  const [answers, setAnswers] = useState<Record<string, AnswerDraft>>({});
  const [calendarDrafts, setCalendarDrafts] = useState<Record<string, CalendarDraft>>({});
  const [feedback, setFeedback] = useState<{ tone: "error" | "success"; message: string } | null>(null);
  const [submittedConstraints, setSubmittedConstraints] = useState<ParsedCommentConstraint[] | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const unansweredCount = useMemo(
    () => detail.candidates.filter((candidate) => !isAnswerComplete(candidate, answers[candidate.id])).length,
    [answers, detail.candidates],
  );

  function getAnswer(candidateId: string): AnswerDraft {
    return answers[candidateId] ?? buildEmptyAnswer(candidateId);
  }

  function getCalendarDraft(candidateId: string): CalendarDraft {
    return calendarDrafts[candidateId] ?? buildEmptyCalendarDraft();
  }

  function setCalendarDraft(candidateId: string, patch: Partial<CalendarDraft>) {
    setCalendarDrafts((current) => ({
      ...current,
      [candidateId]: {
        ...getCalendarDraft(candidateId),
        ...patch,
      },
    }));
  }

  function updateAnswer(candidateId: string, patch: Partial<AnswerDraft>) {
    setAnswers((current) => ({
      ...current,
      [candidateId]: {
        ...getAnswer(candidateId),
        ...patch,
      },
    }));
  }

  function choose(candidateId: string, availabilityKey: string, candidateDates: string[]) {
    setAnswers((current) => {
      const currentAnswer = current[candidateId] ?? buildEmptyAnswer(candidateId);
      const autoSelectedDates =
        availabilityKey === "no"
          ? []
          : currentAnswer.selectedDates.length > 0
            ? currentAnswer.selectedDates
            : candidateDates.length === 1
              ? [candidateDates[0]]
              : [];

      const nextDateTimePreferences =
        availabilityKey === "no"
          ? {}
          : Object.fromEntries(
              Object.entries(currentAnswer.dateTimePreferences).filter(([date]) => autoSelectedDates.includes(date)),
            );

      return {
        ...current,
        [candidateId]: {
          ...currentAnswer,
          availabilityKey,
          selectedDates: autoSelectedDates,
          preferredTimeSlotKey: availabilityKey === "no" ? null : currentAnswer.preferredTimeSlotKey,
          dateTimePreferences: nextDateTimePreferences,
          availableStartTime: availabilityKey === "no" ? null : currentAnswer.availableStartTime,
          availableEndTime: availabilityKey === "no" ? null : currentAnswer.availableEndTime,
        },
      };
    });

    if (availabilityKey === "no") {
      setCalendarDraft(candidateId, { rangeAnchor: null });
    }
  }

  function selectDate(candidateId: string, candidateDates: string[], date: string) {
    const draft = getCalendarDraft(candidateId);
    const currentAnswer = getAnswer(candidateId);

    if (draft.mode === "single") {
      const nextDates = currentAnswer.selectedDates.includes(date)
        ? currentAnswer.selectedDates.filter((value) => value !== date)
        : sortDateValues([...currentAnswer.selectedDates, date]);

      updateAnswer(candidateId, {
        selectedDates: nextDates,
        dateTimePreferences: Object.fromEntries(
          Object.entries(currentAnswer.dateTimePreferences).filter(([key]) => nextDates.includes(key)),
        ),
      });
      return;
    }

    if (!draft.rangeAnchor) {
      setCalendarDraft(candidateId, { rangeAnchor: date });
      return;
    }

    const rangeDates = getRangeDates(candidateDates, draft.rangeAnchor, date);
    const nextDates = sortDateValues([...currentAnswer.selectedDates, ...rangeDates]);
    updateAnswer(candidateId, {
      selectedDates: nextDates,
      dateTimePreferences: Object.fromEntries(
        Object.entries(currentAnswer.dateTimePreferences).filter(([key]) => nextDates.includes(key)),
      ),
    });
    setCalendarDraft(candidateId, { rangeAnchor: null });
  }

  function setDateTimePreference(candidateId: string, date: string, timeSlotKey: string) {
    updateAnswer(candidateId, {
      dateTimePreferences: {
        ...getAnswer(candidateId).dateTimePreferences,
        [date]: timeSlotKey,
      },
    });
  }

  function updateAvailableTime(candidateId: string, field: "availableStartTime" | "availableEndTime", value: string) {
    updateAnswer(candidateId, { [field]: value || null });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    setSubmittedConstraints(null);

    if (!participantName.trim()) {
      setFeedback({ tone: "error", message: "名前を入力してください。" });
      return;
    }

    const rawPayload = {
      participantName,
      note,
      answers: detail.candidates.map((candidate) => {
        const answer = getAnswer(candidate.id);

        return {
          candidateId: candidate.id,
          availabilityKey: answer.availabilityKey,
          selectedDates: answer.selectedDates,
          preferredTimeSlotKey: answer.preferredTimeSlotKey,
          dateTimePreferences: answer.dateTimePreferences,
          availableStartTime: answer.availableStartTime,
          availableEndTime: answer.availableEndTime,
        };
      }),
    };

    let normalizedPayload;

    try {
      normalizedPayload = parseSubmitResponsePayload(rawPayload, detail.candidates);
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : "回答内容を確認してください。" });
      return;
    }

    setIsSubmitting(true);

    const response = await fetch(`/api/events/${detail.event.id}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalizedPayload),
    });

    const result = (await response.json()) as { error?: string; response?: { parsedConstraints?: ParsedCommentConstraint[] } };
    setIsSubmitting(false);

    if (!response.ok) {
      setFeedback({ tone: "error", message: result.error ?? "回答の送信に失敗しました。" });
      return;
    }

    setFeedback({
      tone: "success",
      message: "回答を保存しました。同じ名前で再送すると上書きされます。",
    });
    setSubmittedConstraints(result.response?.parsedConstraints ?? []);
    router.refresh();
  }

  return (
    <div className="split-layout">
      <section className="hero-card">
        <div className="eyebrow">Join Event</div>
        <h1>{detail.event.title}</h1>
        <p className="lead">
          候補 {detail.candidates.length}件に対して、「行ける / 微妙 / 無理」の3段階で回答してください。日付は最初から表示され、個別選択と範囲選択を切り替えながら選べます。
        </p>
        <div className="inline-list">
          <span className="mode-chip">保存先: {repositoryMode === "supabase" ? "Supabase" : "デモモード"}</span>
          <span className="mode-chip">既存回答: {detail.responses.length}人</span>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <div className="eyebrow">Availability</div>
            <h2>参加可否を入力する</h2>
          </div>
          <p className="section-copy">日にちをクリックして選びます。範囲選択モードでは1回目のクリックで開始日、2回目で終了日を選べます。</p>
        </div>

        <form className="participant-grid" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="participant-name">名前</label>
            <input
              className="input"
              id="participant-name"
              maxLength={48}
              onChange={(event) => setParticipantName(event.target.value)}
              placeholder="例: 田中"
              value={participantName}
            />
          </div>

          <div className="field">
            <label htmlFor="participant-note">メモ（任意）</label>
            <textarea
              className="textarea"
              id="participant-note"
              maxLength={240}
              onChange={(event) => setNote(event.target.value)}
              placeholder="例: 夜なら少し遅れるかも"
              value={note}
            />
          </div>

          <div className="subtle-divider" />

          <div className="candidate-list">
            {detail.candidates.map((candidate) => {
              const normalizedCandidate = normalizeCandidate(candidate);
              const answer = getAnswer(candidate.id);
              const candidateDates = getCandidateDateValues(candidate);
              const calendarDraft = getCalendarDraft(candidate.id);
              const rangeAnchor = calendarDraft.rangeAnchor;

              return (
                <article className="candidate-card" key={candidate.id}>
                  <div className="candidate-card__header">
                    <div>
                      <h3>{formatCandidateLabel(candidate)}</h3>
                      <p className="status-note">{formatCandidateTypeSummary(candidate)}</p>
                    </div>
                  </div>

                  <div className="status-selector">
                    {AVAILABILITY_LEVELS.map((level) => {
                      const isSelected = answer.availabilityKey === level.key;
                      return (
                        <button
                          className={`status-option ${isSelected ? "is-selected" : ""}`}
                          data-tone={level.tone}
                          key={level.key}
                          onClick={() => choose(candidate.id, level.key, candidateDates)}
                          type="button"
                        >
                          <strong>{level.label}</strong>
                          <div>{level.weight.toFixed(1)}</div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="field">
                    <div className="calendar-toolbar">
                      <span className="fieldset-label">日付を選ぶ</span>
                      <div className="toggle-chip-row">
                        <button
                          aria-pressed={calendarDraft.mode === "single"}
                          className={`option-chip ${calendarDraft.mode === "single" ? "is-selected" : ""}`}
                          onClick={() => setCalendarDraft(candidate.id, { mode: "single", rangeAnchor: null })}
                          type="button"
                        >
                          個別選択
                        </button>
                        <button
                          aria-pressed={calendarDraft.mode === "range"}
                          className={`option-chip ${calendarDraft.mode === "range" ? "is-selected" : ""}`}
                          onClick={() => setCalendarDraft(candidate.id, { mode: "range", rangeAnchor: null })}
                          type="button"
                        >
                          範囲選択
                        </button>
                      </div>
                    </div>

                    <InlineDateCalendar
                      allowedDates={candidateDates}
                      initialMonth={candidateDates[0]}
                      mode={calendarDraft.mode}
                      onSelectDate={(date) => selectDate(candidate.id, candidateDates, date)}
                      rangeAnchor={rangeAnchor}
                      selectedDates={answer.selectedDates}
                    />

                    <p className="helper-text">
                      {calendarDraft.mode === "range"
                        ? rangeAnchor
                          ? `開始日 ${formatDate(rangeAnchor)} を選択中です。終了日をクリックすると範囲が追加されます。`
                          : "範囲選択モードです。開始日をクリックしてください。"
                        : "個別選択モードです。日にちをクリックすると追加・解除できます。"}
                    </p>
                  </div>

                  {normalizedCandidate.timeType === "unspecified" ? (
                    <div className="field">
                      <span className="fieldset-label">選んだ日ごとの時間帯</span>
                      {answer.selectedDates.length === 0 ? (
                        <p className="helper-text">先に日付を選ぶと、その日ごとの時間帯を選べます。</p>
                      ) : (
                        <div className="date-time-preference-list">
                          {answer.selectedDates.map((date) => (
                            <div className="date-time-preference-card" key={`${candidate.id}-${date}`}>
                              <strong>{formatDate(date)}</strong>
                              <div className="option-chip-list">
                                {CANDIDATE_TIME_PREFERENCE_OPTIONS.map((option) => {
                                  const isSelected = answer.dateTimePreferences[date] === option.key;
                                  return (
                                    <button
                                      className={`option-chip ${isSelected ? "is-selected" : ""}`}
                                      key={`${date}-${option.key}`}
                                      onClick={() => setDateTimePreference(candidate.id, date, option.key)}
                                      type="button"
                                    >
                                      {option.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="helper-text">{`主催者の希望時間帯: ${getTimeSlotByKey(candidate.timeSlotKey).label}`}</div>
                  )}

                  {normalizedCandidate.timeType === "unspecified" ? (
                    <div className="time-input-row">
                      <div className="field">
                        <label htmlFor={`available-start-${candidate.id}`}>参加可能 開始時刻</label>
                        <input
                          className="input"
                          disabled={answer.availabilityKey === "no"}
                          id={`available-start-${candidate.id}`}
                          onChange={(event) => updateAvailableTime(candidate.id, "availableStartTime", event.target.value)}
                          type="time"
                          value={answer.availableStartTime ?? ""}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`available-end-${candidate.id}`}>参加可能 終了時刻</label>
                        <input
                          className="input"
                          disabled={answer.availabilityKey === "no"}
                          id={`available-end-${candidate.id}`}
                          onChange={(event) => updateAvailableTime(candidate.id, "availableEndTime", event.target.value)}
                          type="time"
                          value={answer.availableEndTime ?? ""}
                        />
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>

          {feedback ? (
            <div className="feedback" data-tone={feedback.tone}>
              {feedback.message}
            </div>
          ) : null}

          {feedback?.tone === "success" && note.trim() ? (
            <div className="info-note">
              <strong>以下のように解釈しました</strong>
              {submittedConstraints && submittedConstraints.length > 0 ? (
                <div className="card-list" style={{ marginTop: 10 }}>
                  {submittedConstraints.map((constraint) => (
                    <div key={`${constraint.targetType}-${constraint.targetValue}-${constraint.level}`}>{formatParsedConstraintLabel(constraint)}</div>
                  ))}
                </div>
              ) : (
                <p className="helper-text" style={{ marginTop: 8 }}>
                  解釈できる条件は見つかりませんでした。
                </p>
              )}
            </div>
          ) : null}

          <div className="form-actions">
            <span className="helper-text">未回答の候補: {unansweredCount}件</span>
            <button className="button button--primary" disabled={isSubmitting} type="submit">
              {isSubmitting ? "送信中..." : "回答を送信する"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
