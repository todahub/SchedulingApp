"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { InlineDateCalendar } from "@/components/inline-date-calendar";
import type { AutoInterpretationResult, AutoInterpretationRule, EventDetail, RepositoryMode } from "@/lib/domain";
import { formatAutoInterpretationPreference } from "@/lib/availability-comment-interpretation";
import { formatCandidateLabel, formatCandidateTypeSummary, formatSelectedDatesLabel, getCandidateDateValues } from "@/lib/utils";
import { parseSubmitResponsePayload } from "@/lib/validation";

type ParticipantFormProps = {
  detail: EventDetail;
  repositoryMode: RepositoryMode;
  sharePromptPath?: string | null;
};

type CommentDateDraft = {
  selectedDates: string[];
};

type SubmitInterpretation = {
  usedDefault: boolean;
  defaultReason: "empty" | "unparsed" | null;
  autoInterpretation: AutoInterpretationResult | null;
};

function sortDateValues(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function formatCommentPrefix(date: string) {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}は `;
}

function formatCommentDateKey(date: string) {
  return `${date.slice(5, 7)}/${date.slice(8, 10)}`;
}

function extractCommentDateKey(line: string) {
  const match = line.match(/^(\d{1,2})\/(\d{1,2})は(?:.*)?$/u);

  if (!match) {
    return null;
  }

  const month = match[1]?.padStart(2, "0");
  const day = match[2]?.padStart(2, "0");

  if (!month || !day) {
    return null;
  }

  return `${month}/${day}`;
}

function isHelperPrefixOnlyLine(line: string) {
  return /^(\d{1,2})\/(\d{1,2})は\s*$/u.test(line);
}

function collectSelectedHelperDates(drafts: Record<string, CommentDateDraft>) {
  return sortDateValues(Object.values(drafts).flatMap((draft) => draft.selectedDates));
}

function buildSortedCommentWithSelectedDates(currentNote: string, selectedDates: string[]) {
  const selectedDateKeys = new Set(selectedDates.map(formatCommentDateKey));
  const existingLinesByDateKey = new Map<string, string[]>();
  const remainingLines: string[] = [];
  const currentLines = currentNote.length > 0 ? currentNote.split("\n") : [];

  for (const line of currentLines) {
    const dateKey = extractCommentDateKey(line);

    if (dateKey && selectedDateKeys.has(dateKey)) {
      existingLinesByDateKey.set(dateKey, [...(existingLinesByDateKey.get(dateKey) ?? []), line]);
      continue;
    }

    remainingLines.push(line);
  }

  const orderedSelectedLines = selectedDates.flatMap((date) => {
    const existingLines = existingLinesByDateKey.get(formatCommentDateKey(date));
    return existingLines && existingLines.length > 0 ? existingLines : [formatCommentPrefix(date)];
  });

  const nextLines = [...orderedSelectedLines, ...remainingLines];
  const lastIndex = nextLines.length - 1;

  return nextLines
    .map((line, index) => (index !== lastIndex && isHelperPrefixOnlyLine(line) ? line.trimEnd() : line))
    .join("\n");
}

function buildInitialDraft(): CommentDateDraft {
  return {
    selectedDates: [],
  };
}

function formatAutoInterpretationTarget(rule: AutoInterpretationRule) {
  return rule.targetText;
}

function formatAutoInterpretationAvailability(rule: AutoInterpretationRule) {
  const modifierTexts = [...new Set(rule.modifierTexts.map((text) => text.trim()).filter(Boolean))];

  return modifierTexts.length > 0 ? `${modifierTexts.join(" ")} ${rule.availabilityText}` : rule.availabilityText;
}

function formatDefaultHandling(defaultReason: SubmitInterpretation["defaultReason"]) {
  return defaultReason === "empty"
    ? "コメント未入力のため、今回は全候補を参加可能として扱います。"
    : "安全に候補へ反映できなかったため、今回は全候補を参加可能として扱います。";
}

export function ParticipantForm({ detail, repositoryMode, sharePromptPath = null }: ParticipantFormProps) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [participantName, setParticipantName] = useState("");
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<{ tone: "error" | "success"; message: string } | null>(null);
  const [submittedInterpretation, setSubmittedInterpretation] = useState<SubmitInterpretation | null>(null);
  const [shareFeedback, setShareFeedback] = useState<"idle" | "copied" | "error">("idle");
  const [dateDrafts, setDateDrafts] = useState<Record<string, CommentDateDraft>>(() =>
    Object.fromEntries(detail.candidates.map((candidate) => [candidate.id, buildInitialDraft()])),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  function focusNoteField() {
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const length = textareaRef.current?.value.length ?? 0;
      textareaRef.current?.setSelectionRange(length, length);
    });
  }

  async function handleCopyShareUrl() {
    if (!sharePromptPath || typeof window === "undefined" || !navigator.clipboard) {
      setShareFeedback("error");
      return;
    }

    try {
      await navigator.clipboard.writeText(new URL(sharePromptPath, window.location.origin).toString());
      setShareFeedback("copied");
    } catch {
      setShareFeedback("error");
    }
  }

  function handleDateSelect(candidateId: string, date: string) {
    const candidate = detail.candidates.find((item) => item.id === candidateId);

    if (!candidate) {
      return;
    }

    const draft = dateDrafts[candidateId] ?? buildInitialDraft();
    const isSelected = draft.selectedDates.includes(date);
    const nextDraft: CommentDateDraft = {
      selectedDates: isSelected
        ? draft.selectedDates.filter((value) => value !== date)
        : sortDateValues([...draft.selectedDates, date]),
    };
    const nextDateDrafts = {
      ...dateDrafts,
      [candidateId]: nextDraft,
    };

    setDateDrafts(nextDateDrafts);
    setNote((current) => buildSortedCommentWithSelectedDates(current, collectSelectedHelperDates(nextDateDrafts)));

    if (!isSelected) {
      focusNoteField();
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
      interpretation?: { usedDefault?: boolean; defaultReason?: "empty" | "unparsed" | null };
      autoInterpretation?: AutoInterpretationResult;
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
      usedDefault: result.interpretation?.usedDefault ?? false,
      defaultReason: result.interpretation?.defaultReason ?? null,
      autoInterpretation: result.autoInterpretation ?? null,
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
        {sharePromptPath ? (
          <div className="info-note" style={{ marginTop: 18 }}>
            <strong>参加者ページを共有</strong>
            <div className="table-note" style={{ marginTop: 6 }}>
              このURLを参加者に送ってください。
            </div>
            <div className="button-row" style={{ marginTop: 12 }}>
              <span className="mode-chip">{sharePromptPath}</span>
              <button className="button button--primary" onClick={handleCopyShareUrl} type="button">
                URLをコピー
              </button>
            </div>
            {shareFeedback === "copied" ? <div className="table-note" style={{ marginTop: 8 }}>URLをコピーしました。</div> : null}
            {shareFeedback === "error" ? (
              <div className="table-note" style={{ marginTop: 8 }}>URLをコピーできませんでした。表示中のURLを共有してください。</div>
            ) : null}
          </div>
        ) : null}
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
              const draft = dateDrafts[candidate.id] ?? buildInitialDraft();

              return (
                <article className="candidate-card" key={candidate.id}>
                  <div className="candidate-card__header">
                    <div>
                      <h3>{formatCandidateLabel(candidate)}</h3>
                      <p className="status-note">{formatCandidateTypeSummary(candidate)}</p>
                    </div>
                  </div>

                  <div className="calendar-toolbar">
                    <span className="fieldset-label">コメントしたい日付を選ぶ</span>
                    <span className="helper-text">{draft.selectedDates.length > 0 ? "コメント補助として選択中" : "未選択"}</span>
                  </div>

                  <InlineDateCalendar
                    allowedDates={allowedDates}
                    highlightedDates={allowedDates}
                    initialMonth={allowedDates[0]}
                    mode="single"
                    onSelectDate={(date) => handleDateSelect(candidate.id, date)}
                    rangeAnchor={null}
                    selectedDates={draft.selectedDates}
                  />

                  <p className="helper-text">日にちをクリックすると、コメント補助として複数日を選択・解除できます。</p>
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
            <>
              {submittedInterpretation?.autoInterpretation ? (
                <div className="info-note">
                  <strong>解釈結果</strong>
                  {submittedInterpretation.autoInterpretation.status === "success" ? (
                    <div className="card-list" style={{ marginTop: 10 }}>
                      {submittedInterpretation.autoInterpretation.rules.map((rule) => (
                        <article
                          className="rule-card"
                          key={`${rule.targetTokenIndexes.join("-")}-${rule.availabilityTokenIndexes.join("-")}`}
                        >
                          <strong>{formatAutoInterpretationTarget(rule)}</strong>
                          <div className="table-note">可否: {formatAutoInterpretationAvailability(rule)}</div>
                          {rule.notes.map((note) => (
                            <div className="table-note" key={note}>
                              補足: {note}
                            </div>
                          ))}
                        </article>
                      ))}
                      {(submittedInterpretation.autoInterpretation.preferences ?? []).map((preference) => (
                        <article
                          className="rule-card"
                          key={`preference-${preference.targetTokenIndexes.join("-")}-${preference.markerTokenIndexes.join("-")}`}
                        >
                          <strong>{preference.targetText}</strong>
                          <div className="table-note">希望: {formatAutoInterpretationPreference(preference)}</div>
                        </article>
                      ))}
                      {submittedInterpretation.autoInterpretation.ambiguities.map((ambiguity) => (
                        <div className="table-note" key={ambiguity}>
                          曖昧さ: {ambiguity}
                        </div>
                      ))}
                      {process.env.NODE_ENV !== "production" && submittedInterpretation.autoInterpretation.debugGraphJson ? (
                        <details>
                          <summary>開発用: relation graph JSON</summary>
                          <pre style={{ whiteSpace: "pre-wrap", marginTop: 10 }}>
                            {submittedInterpretation.autoInterpretation.debugGraphJson}
                          </pre>
                        </details>
                      ) : null}
                      {submittedInterpretation.usedDefault ? (
                        <div className="table-note">{formatDefaultHandling(submittedInterpretation.defaultReason)}</div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="card-list" style={{ marginTop: 10 }}>
                      <div>
                        {submittedInterpretation.autoInterpretation.status === "skipped"
                          ? "自動解釈はスキップされました。"
                          : "自動解釈できませんでした。"}
                      </div>
                      {submittedInterpretation.autoInterpretation.failureReason ? (
                        <div className="table-note">{submittedInterpretation.autoInterpretation.failureReason}</div>
                      ) : null}
                      {submittedInterpretation.usedDefault ? (
                        <div className="table-note">{formatDefaultHandling(submittedInterpretation.defaultReason)}</div>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}
            </>
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
