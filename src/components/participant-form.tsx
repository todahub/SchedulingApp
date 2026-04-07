"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AVAILABILITY_LEVELS } from "@/lib/config";
import type { EventDetail, RepositoryMode } from "@/lib/domain";
import { formatCandidateLabel } from "@/lib/utils";

type ParticipantFormProps = {
  detail: EventDetail;
  repositoryMode: RepositoryMode;
};

export function ParticipantForm({ detail, repositoryMode }: ParticipantFormProps) {
  const router = useRouter();
  const [participantName, setParticipantName] = useState("");
  const [note, setNote] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ tone: "error" | "success"; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const unansweredCount = useMemo(
    () => detail.candidates.filter((candidate) => !answers[candidate.id]).length,
    [answers, detail.candidates],
  );

  function choose(candidateId: string, availabilityKey: string) {
    setAnswers((current) => ({ ...current, [candidateId]: availabilityKey }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    if (!participantName.trim()) {
      setFeedback({ tone: "error", message: "名前を入力してください。" });
      return;
    }

    if (unansweredCount > 0) {
      setFeedback({ tone: "error", message: "すべての候補日に回答してください。" });
      return;
    }

    setIsSubmitting(true);

    const response = await fetch(`/api/events/${detail.event.id}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantName,
        note,
        answers: detail.candidates.map((candidate) => ({
          candidateId: candidate.id,
          availabilityKey: answers[candidate.id],
        })),
      }),
    });

    const result = (await response.json()) as { error?: string };
    setIsSubmitting(false);

    if (!response.ok) {
      setFeedback({ tone: "error", message: result.error ?? "回答の送信に失敗しました。" });
      return;
    }

    setFeedback({
      tone: "success",
      message: "回答を保存しました。同じ名前で再送すると上書きされます。",
    });
    router.refresh();
  }

  return (
    <div className="split-layout">
      <section className="hero-card">
        <div className="eyebrow">Join Event</div>
        <h1>{detail.event.title}</h1>
        <p className="lead">
          候補 {detail.candidates.length}件に対して、「行ける / 微妙 / 無理」の3段階で回答してください。
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
          <p className="section-copy">MVPでは時間帯は固定プリセットです。将来的には追加しやすい設計にしてあります。</p>
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
            {detail.candidates.map((candidate) => (
              <article className="candidate-card" key={candidate.id}>
                <div className="candidate-card__header">
                  <div>
                    <h3>{formatCandidateLabel(candidate)}</h3>
                    <p className="status-note">まだ選択していない場合は送信できません。</p>
                  </div>
                </div>
                <div className="status-selector">
                  {AVAILABILITY_LEVELS.map((level) => {
                    const isSelected = answers[candidate.id] === level.key;
                    return (
                      <button
                        className={`status-option ${isSelected ? "is-selected" : ""}`}
                        data-tone={level.tone}
                        key={level.key}
                        onClick={() => choose(candidate.id, level.key)}
                        type="button"
                      >
                        <strong>{level.label}</strong>
                        <div>{level.weight.toFixed(1)}</div>
                      </button>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>

          {feedback ? (
            <div className="feedback" data-tone={feedback.tone}>
              {feedback.message}
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
