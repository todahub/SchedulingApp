"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { InlineDateCalendar } from "@/components/inline-date-calendar";
import { formatParsedConstraintLabel } from "@/lib/comment-parser";
import type { EventDetail, ParsedCommentConstraint, RepositoryMode } from "@/lib/domain";
import { formatCandidateLabel, formatCandidateTypeSummary, formatDate, formatSelectedDatesLabel, getCandidateDateValues } from "@/lib/utils";
import { parseSubmitResponsePayload } from "@/lib/validation";

type ParticipantFormProps = {
  detail: EventDetail;
  repositoryMode: RepositoryMode;
};

type CalendarMode = "single" | "range";

type CommentDateDraft = {
  selectedDates: string[];
  rangeAnchor: string | null;
  calendarMode: CalendarMode;
};

type SubmitInterpretation = {
  constraints: ParsedCommentConstraint[];
  defaultReason: "empty" | "unparsed" | null;
};

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

function formatCommentPrefix(date: string) {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}は `;
}

function buildInitialDraft(candidate: EventDetail["candidates"][number]): CommentDateDraft {
  return {
    selectedDates: [],
    rangeAnchor: null,
    calendarMode: getCandidateDateValues(candidate).length > 1 && candidate.selectionMode === "range" ? "range" : "single",
  };
}

export function ParticipantForm({ detail, repositoryMode }: ParticipantFormProps) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [participantName, setParticipantName] = useState("");
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<{ tone: "error" | "success"; message: string } | null>(null);
  const [submittedInterpretation, setSubmittedInterpretation] = useState<SubmitInterpretation | null>(null);
  const [dateDrafts, setDateDrafts] = useState<Record<string, CommentDateDraft>>(() =>
    Object.fromEntries(detail.candidates.map((candidate) => [candidate.id, buildInitialDraft(candidate)])),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const interpretationLines = useMemo(() => {
    if (!submittedInterpretation) {
      return [];
    }

    if (submittedInterpretation.constraints.length === 0) {
      return [
        submittedInterpretation.defaultReason === "unparsed"
          ? "全日 → 参加可能（解釈できなかったためデフォルト）"
          : "全日 → 参加可能（コメント未入力のためデフォルト）",
      ];
    }

    return submittedInterpretation.constraints.map((constraint) => formatParsedConstraintLabel(constraint));
  }, [submittedInterpretation]);

  function focusNoteField() {
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const length = textareaRef.current?.value.length ?? 0;
      textareaRef.current?.setSelectionRange(length, length);
    });
  }

  function appendDatePrefix(date: string) {
    const prefix = formatCommentPrefix(date);
    const marker = prefix.trimEnd();

    setNote((current) => {
      if (current.includes(marker)) {
        return current;
      }

      const trimmed = current.trimEnd();
      return trimmed ? `${trimmed}\n${prefix}` : prefix;
    });

    focusNoteField();
  }

  function updateDraft(candidateId: string, patch: Partial<CommentDateDraft>) {
    setDateDrafts((current) => ({
      ...current,
      [candidateId]: {
        ...current[candidateId],
        ...patch,
      },
    }));
  }

  function handleDateSelect(candidateId: string, date: string) {
    const candidate = detail.candidates.find((item) => item.id === candidateId);

    if (!candidate) {
      return;
    }

    const allowedDateSet = new Set(getCandidateDateValues(candidate));
    const draft = dateDrafts[candidateId] ?? buildInitialDraft(candidate);
    let nextDraft: CommentDateDraft;
    let shouldAppendPrefix = false;

    if (draft.calendarMode === "single") {
      const isSelected = draft.selectedDates.includes(date);
      nextDraft = {
        ...draft,
        selectedDates: isSelected ? draft.selectedDates.filter((value) => value !== date) : sortDateValues([...draft.selectedDates, date]),
        rangeAnchor: null,
      };
      shouldAppendPrefix = !isSelected;
    } else if (draft.selectedDates.includes(date)) {
      nextDraft = {
        ...draft,
        selectedDates: draft.selectedDates.filter((value) => value !== date),
        rangeAnchor: draft.rangeAnchor === date ? null : draft.rangeAnchor,
      };
    } else if (!draft.rangeAnchor) {
      nextDraft = {
        ...draft,
        rangeAnchor: date,
      };
      shouldAppendPrefix = true;
    } else {
      nextDraft = {
        ...draft,
        selectedDates: sortDateValues([...draft.selectedDates, ...getRangeDates(draft.rangeAnchor, date).filter((value) => allowedDateSet.has(value))]),
        rangeAnchor: null,
      };
      shouldAppendPrefix = true;
    }

    setDateDrafts((current) => ({
      ...current,
      [candidateId]: nextDraft,
    }));

    if (shouldAppendPrefix) {
      appendDatePrefix(date);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    setSubmittedInterpretation(null);

    if (!participantName.trim()) {
      setFeedback({ tone: "error", message: "名前を入力してください。" });
      return;
    }

    const rawPayload = {
      participantName,
      note,
      answers: [],
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

    const result = (await response.json()) as {
      error?: string;
      response?: { parsedConstraints?: ParsedCommentConstraint[] };
      interpretation?: { defaultReason?: "empty" | "unparsed" | null };
    };
    setIsSubmitting(false);

    if (!response.ok) {
      setFeedback({ tone: "error", message: result.error ?? "回答の送信に失敗しました。" });
      return;
    }

    setFeedback({
      tone: "success",
      message: "回答を保存しました。同じ名前で再送すると上書きされます。",
    });
    setSubmittedInterpretation({
      constraints: result.response?.parsedConstraints ?? [],
      defaultReason: result.interpretation?.defaultReason ?? null,
    });
    router.refresh();
  }

  return (
    <div className="split-layout">
      <section className="hero-card">
        <div className="eyebrow">Join Event</div>
        <h1>{detail.event.title}</h1>
        <p className="lead">
          カレンダーはコメントしたい日付を指定するための補助です。参加可否や時間帯の意味づけは、コメントの内容から判断します。
        </p>
        <div className="inline-list">
          <span className="mode-chip">保存先: {repositoryMode === "supabase" ? "Supabase" : "デモモード"}</span>
          <span className="mode-chip">既存回答: {detail.responses.length}人</span>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <div className="eyebrow">Comment Helper</div>
            <h2>コメントしたい日付を選ぶ</h2>
          </div>
          <p className="section-copy">
            日付をタップするとコメント欄に「4/23は 」のように入ります。参加可否や条件はコメントから解釈され、日付を選んだだけでは参加可能扱いになりません。
          </p>
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

          <div className="candidate-list">
            {detail.candidates.map((candidate) => {
              const allowedDates = getCandidateDateValues(candidate);
              const draft = dateDrafts[candidate.id] ?? buildInitialDraft(candidate);

              return (
                <article className="candidate-card" key={candidate.id}>
                  <div className="candidate-card__header">
                    <div>
                      <h3>{formatCandidateLabel(candidate)}</h3>
                      <p className="status-note">{formatCandidateTypeSummary(candidate)}</p>
                    </div>
                  </div>

                  {allowedDates.length > 1 ? (
                    <div className="field">
                      <div className="calendar-toolbar">
                        <span className="fieldset-label">日付の指定方法</span>
                        <span className="helper-text">
                          {draft.selectedDates.length > 0 ? `${draft.selectedDates.length}日をコメント補助として選択中` : "未選択"}
                        </span>
                      </div>
                      <div className="toggle-chip-row">
                        <button
                          aria-pressed={draft.calendarMode === "range"}
                          className={`option-chip ${draft.calendarMode === "range" ? "is-selected" : ""}`}
                          onClick={() => updateDraft(candidate.id, { calendarMode: "range", rangeAnchor: null })}
                          type="button"
                        >
                          範囲選択
                        </button>
                        <button
                          aria-pressed={draft.calendarMode === "single"}
                          className={`option-chip ${draft.calendarMode === "single" ? "is-selected" : ""}`}
                          onClick={() => updateDraft(candidate.id, { calendarMode: "single", rangeAnchor: null })}
                          type="button"
                        >
                          個別選択
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="calendar-toolbar">
                      <span className="fieldset-label">コメントしたい日付を選ぶ</span>
                      <span className="helper-text">{draft.selectedDates.length > 0 ? "コメント補助として選択中" : "未選択"}</span>
                    </div>
                  )}

                  <InlineDateCalendar
                    allowedDates={allowedDates}
                    initialMonth={allowedDates[0]}
                    mode={draft.calendarMode}
                    onSelectDate={(date) => handleDateSelect(candidate.id, date)}
                    rangeAnchor={draft.rangeAnchor}
                    selectedDates={draft.selectedDates}
                  />

                  <p className="helper-text">
                    {draft.calendarMode === "range"
                      ? draft.rangeAnchor
                        ? `開始日 ${formatDate(draft.rangeAnchor)} を選択中です。次のクリックで範囲指定できます。`
                        : "範囲選択モードです。1回目で開始日、2回目で終了日を指定します。"
                      : "個別選択モードです。日にちをクリックするとコメント用の日付を追加・解除できます。"}
                  </p>
                  <p className="status-note">
                    {draft.selectedDates.length > 0
                      ? `コメント補助として選択中: ${formatSelectedDatesLabel(draft.selectedDates)}`
                      : "日付を選ぶとコメント欄に日付が自動で入ります。"}
                  </p>
                </article>
              );
            })}
          </div>

          <div className="field">
            <label htmlFor="participant-note">コメント（任意）</label>
            <textarea
              ref={textareaRef}
              className="textarea"
              id="participant-note"
              maxLength={240}
              onChange={(event) => setNote(event.target.value)}
              placeholder="例: 4/23は夜ならいける、金曜はできれば避けたい"
              value={note}
            />
          </div>

          {feedback ? (
            <div className="feedback" data-tone={feedback.tone}>
              {feedback.message}
            </div>
          ) : null}

          {feedback?.tone === "success" ? (
            <div className="info-note">
              <strong>以下のように解釈しました</strong>
              <div className="card-list" style={{ marginTop: 10 }}>
                {interpretationLines.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="form-actions">
            <span className="helper-text">コメントが空なら全日参加扱いになります。入力があるのに解釈できない場合も、今回は全日参加として扱います。</span>
            <button className="button button--primary" disabled={isSubmitting} type="submit">
              {isSubmitting ? "送信中..." : "回答を送信する"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
